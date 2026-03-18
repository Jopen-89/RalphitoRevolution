import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateGoogle } from '../auth/google-oauth.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type { Provider, Message, AgentConfig, GatewayConfig, ChatRequest, ChatResponse } from '../interfaces/gateway.types.js';
import { initializeRalphitoDatabase } from '../../persistence/db/index.js';
import { renderDashboardPage } from '../../dashboard/dashboardPage.js';
import {
  getUnifiedDashboardSessionDetail,
  getUnifiedDashboardSessions,
  updateDashboardTaskStatus,
} from '../../dashboard/dashboardService.js';
import { backupRalphitoDatabase, getOperationalStatus, recordSystemEvent } from '../../ops/observabilityService.js';
import { searchIndexedDocuments } from '../../search/codeIndexService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initializeRalphitoDatabase();

const app = express();
app.use(express.json());

// Variable global para mantener el cliente OAuth autenticado
let googleAuthClient: any = null;

// Cargar configuración de agentes
const getConfig = (): GatewayConfig => {
  try {
    const configPath = path.join(__dirname, '..', 'gateway.config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('❌ Error al cargar gateway.config.json:', error);
    return { agents: [] };
  }
};

app.post('/v1/chat', async (req, res) => {
  const { agentId = 'default', messages } = req.body as ChatRequest;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Faltan parámetros messages (debe ser un array)' });
  }

  const config = getConfig();
  const agentConfig = config.agents.find(a => a.agentId === agentId) || config.agents.find(a => a.agentId === 'default');

  if (!agentConfig) {
    return res.status(404).json({ error: `Configuración no encontrada para el agente: ${agentId}` });
  }

  // Lista de intentos (primario + fallbacks)
  const attempts = [
    { provider: agentConfig.primaryProvider, model: agentConfig.model },
    ...agentConfig.fallbacks
  ];

  let lastError: any = null;

  for (const attempt of attempts) {
    try {
      console.log(`[Gateway] Intentando con ${attempt.provider} (${attempt.model})...`);
      
      const auth = {
        ...(googleAuthClient ? { googleAuthClient } : {}),
        ...(process.env.OPENAI_API_KEY ? { openAiKey: process.env.OPENAI_API_KEY } : {}),
        ...(process.env.MINIMAX_API_KEY ? { minimaxKey: process.env.MINIMAX_API_KEY } : {}),
      };

      const llmProvider = ProviderFactory.create(attempt.provider, attempt.model, auth);
      const responseText = await llmProvider.generateResponse(messages);

      const successResponse: ChatResponse = {
        response: responseText,
        providerUsed: attempt.provider,
        modelUsed: attempt.model
      };

      return res.json(successResponse);

    } catch (error) {
      console.warn(`⚠️ Falló ${attempt.provider} (${attempt.model}):`, error instanceof Error ? error.message : String(error));
      lastError = error;
      // Continuar al siguiente fallback
    }
  }

  // Si llegamos aquí, todos los intentos fallaron
  console.error('❌ Todos los proveedores fallaron:', lastError);
  res.status(502).json({ 
    error: 'ALL_PROVIDERS_UNAVAILABLE', 
    details: lastError instanceof Error ? lastError.message : String(lastError) 
  });
});

app.get('/dashboard', (_req, res) => {
  res.type('html').send(renderDashboardPage());
});

app.get('/api/dashboard/sessions', async (_req, res) => {
  try {
    const sessions = await getUnifiedDashboardSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load dashboard sessions' });
  }
});

app.get('/api/dashboard/sessions/:id', async (req, res) => {
  try {
    const detail = await getUnifiedDashboardSessionDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load dashboard detail' });
  }
});

app.post('/api/dashboard/tasks/:id/status', async (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== 'blocked' && status !== 'cancelled') {
    res.status(400).json({ error: 'Unsupported task status transition' });
    return;
  }

  try {
    const updated = await updateDashboardTaskStatus(req.params.id, status);
    if (!updated) {
      res.status(404).json({ error: 'Task not found or missing source spec path' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update task status' });
  }
});

app.get('/api/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Number(req.query.limit || 8);

  if (!query) {
    res.status(400).json({ error: 'Missing q query parameter' });
    return;
  }

  try {
    const startedAt = Date.now();
    const results = searchIndexedDocuments(query, Number.isFinite(limit) ? limit : 8);
    recordSystemEvent('search_query', 'ok', {
      query,
      resultCount: results.length,
      durationMs: Date.now() - startedAt,
    });
    res.json({ query, results });
  } catch (error) {
    recordSystemEvent('search_query', 'error', {
      query,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Search failed' });
  }
});

app.get('/health', async (_req, res) => {
  const status = await getOperationalStatus();
  const ok = status.health.db.ok && status.health.ao.ok && status.health.searchIndex.ok;
  res.status(ok ? 200 : 503).json({ ok, health: status.health });
});

app.get('/api/ops/status', async (_req, res) => {
  try {
    const status = await getOperationalStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build ops status' });
  }
});

app.post('/api/ops/backup', async (_req, res) => {
  try {
    const backupPath = await backupRalphitoDatabase();
    res.json({ success: true, backupPath });
  } catch (error) {
    recordSystemEvent('sqlite_backup', 'error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Backup failed' });
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;

// Iniciamos la autenticación ANTES de levantar el servidor
console.log('🔄 Iniciando secuencia de arranque del Gateway...');
authenticateGoogle()
  .then((client) => {
    googleAuthClient = client;
    app.listen(PORT, () => {
      console.log(`🚀 LLM Gateway escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Error fatal al autenticar con Google:', err.message);
    process.exit(1);
  });
