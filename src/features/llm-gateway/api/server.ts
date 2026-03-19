import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateGoogle } from '../auth/google-oauth.js';
import { ProviderFactory } from '../providers/provider.factory.js';
import type {
  Provider,
  Message,
  AgentConfig,
  GatewayConfig,
  ChatRequest,
  ChatResponse,
  ToolExecutionEntry,
  ToolResult,
} from '../interfaces/gateway.types.js';
import { initializeRalphitoDatabase } from '../../persistence/db/index.js';
import { renderDashboardPage } from '../../dashboard/dashboardPage.js';
import {
  getUnifiedDashboardSessionDetail,
  getUnifiedDashboardSessions,
  updateDashboardTaskStatus,
} from '../../dashboard/dashboardService.js';
import { backupRalphitoDatabase, getOperationalStatus, recordSystemEvent } from '../../ops/observabilityService.js';
import { searchIndexedDocuments } from '../../search/codeIndexService.js';
import { ToolRegistry } from '../tools/toolRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initializeRalphitoDatabase();

const app = express();
app.use(express.json());

// Variable global para mantener el cliente OAuth autenticado
let googleAuthClient: any = null;

const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  gemini: 'gemini-3.1-pro-preview',
  openai: 'gpt-5.4',
  opencode: 'minimax-m2.7',
  codex: 'gpt-5.4',
};

const AGENT_ALIASES: Record<string, string[]> = {
  default: ['default', 'ralphito'],
  raymon: ['raymon', 'ramon', 'raimon', 'ray mond', 'rei mon'],
  moncho: ['moncho'],
  poncho: ['poncho'],
  martapepis: ['martapepis', 'marta', 'marta pepis'],
  lola: ['lola'],
  mapito: ['mapito'],
  juez: ['juez'],
  tracker: ['tracker'],
  ricky: ['ricky'],
  miron: ['miron'],
  relleno: ['relleno'],
  ralphito: ['ralphito'],
};

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

const normalizeAgentId = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/[\s_-]+/g, '');

const resolveAgentConfig = (config: GatewayConfig, rawAgentId: string) => {
  const requestedId = normalizeAgentId(rawAgentId || 'default');
  const configsById = new Map(config.agents.map((agent) => [normalizeAgentId(agent.agentId), agent]));

  const direct = configsById.get(requestedId);
  if (direct) {
    return { agentConfig: direct, resolvedAgentId: normalizeAgentId(direct.agentId), requestedId };
  }

  for (const [canonicalId, aliases] of Object.entries(AGENT_ALIASES)) {
    if (!aliases.map(normalizeAgentId).includes(requestedId)) continue;
    const aliasMatch = configsById.get(canonicalId);
    if (aliasMatch) {
      return { agentConfig: aliasMatch, resolvedAgentId: canonicalId, requestedId };
    }
  }

  const fallback = configsById.get('default');
  if (fallback) {
    return { agentConfig: fallback, resolvedAgentId: 'default', requestedId };
  }

  return { agentConfig: undefined, resolvedAgentId: undefined, requestedId };
};

app.post('/v1/chat', async (req, res) => {
  const { agentId = 'default', provider, model, messages, sessionId } = req.body as ChatRequest;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Faltan parámetros messages (debe ser un array)' });
  }

  const config = getConfig();
  const { agentConfig, resolvedAgentId, requestedId } = resolveAgentConfig(config, agentId);
  const effectiveAgentId = resolvedAgentId || normalizeAgentId(agentId);
  const toolRegistry = new ToolRegistry(googleAuthClient);
  const toolDefinitions = toolRegistry.getDefinitionsForAgent(effectiveAgentId);

  if (!agentConfig && !provider) {
    return res.status(404).json({
      error: 'AGENT_CONFIG_NOT_FOUND',
      message: `No encuentro configuración para el agente '${agentId}'.`,
      requestedAgentId: agentId,
      normalizedAgentId: requestedId,
    });
  }

  // Lista de intentos (primario + fallbacks)
  const attempts = provider
    ? [{ provider, model: model || DEFAULT_MODEL_BY_PROVIDER[provider] }]
    : [
        {
          provider: agentConfig!.primaryProvider,
          model: agentConfig!.model || DEFAULT_MODEL_BY_PROVIDER[agentConfig!.primaryProvider],
        },
        ...agentConfig!.fallbacks.map((fallback) => ({
          provider: fallback.provider,
          model: fallback.model || DEFAULT_MODEL_BY_PROVIDER[fallback.provider],
        })),
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
      let responseText = '';
      let toolExecutions: ToolExecutionEntry[] = [];

      if (toolDefinitions.length > 0) {
        if (!llmProvider.generateResponseWithTools) {
          throw new Error(`Provider ${attempt.provider} no soporta tool calling para el agente ${effectiveAgentId}.`);
        }

        const toolOutcome = await runToolLoop({
          llmProvider,
          messages,
          toolDefinitions,
          toolRegistry,
          agentId: effectiveAgentId,
          ...(sessionId ? { sessionId } : {}),
        });
        responseText = toolOutcome.responseText;
        toolExecutions = toolOutcome.toolExecutions;
      } else {
        responseText = await llmProvider.generateResponse(messages);
      }

      const successResponse: ChatResponse = {
        response: responseText,
        providerUsed: attempt.provider,
        modelUsed: attempt.model,
        ...(sessionId ? { sessionId } : {}),
      };

      recordSystemEvent('gateway_chat', 'ok', {
        agentId: effectiveAgentId,
        provider: attempt.provider,
        model: attempt.model,
        usedTools: toolExecutions.length > 0,
        toolExecutions,
      });

      return res.json(successResponse);

    } catch (error) {
      console.warn(`⚠️ Falló ${attempt.provider} (${attempt.model}):`, error instanceof Error ? error.message : String(error));
      lastError = error;
      // Continuar al siguiente fallback
    }
  }

  // Si llegamos aquí, todos los intentos fallaron
  console.error('❌ Todos los proveedores fallaron:', lastError);
  recordSystemEvent('gateway_chat', 'error', {
    agentId: effectiveAgentId,
    requestedProvider: provider || null,
    attemptedProviders: attempts.map((attempt) => `${attempt.provider}:${attempt.model}`),
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
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

async function runToolLoop({
  llmProvider,
  messages,
  toolDefinitions,
  toolRegistry,
  agentId,
  sessionId,
}: {
  llmProvider: ReturnType<typeof ProviderFactory.create>;
  messages: Message[];
  toolDefinitions: ReturnType<ToolRegistry['getDefinitionsForAgent']>;
  toolRegistry: ToolRegistry;
  agentId: string;
  sessionId?: string;
}) {
  let workingMessages = [...messages];
  const toolExecutions: ToolExecutionEntry[] = [];

  for (let iteration = 0; iteration < toolRegistry.getMaxIterations(); iteration += 1) {
    const llmResponse = await llmProvider.generateResponseWithTools!(workingMessages, { tools: toolDefinitions });

    if (llmResponse.type === 'final') {
      return {
        responseText: llmResponse.text,
        toolExecutions,
      };
    }

    if (llmResponse.toolCalls.length === 0) {
      throw new Error('El provider entro en modo tool calling pero no devolvio llamadas ni respuesta final.');
    }

    const toolResults: ToolResult[] = [];

    for (const toolCall of llmResponse.toolCalls) {
      try {
        const result = await toolRegistry.execute(toolCall.name, toolCall.input, { agentId, ...(sessionId ? { sessionId } : {}) });
        toolResults.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          ok: result.ok,
          content: result.content,
        });
        toolExecutions.push({ toolCallId: toolCall.id, toolName: toolCall.name, ok: result.ok });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolResults.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          ok: false,
          content: JSON.stringify({ error: message }),
        });
        toolExecutions.push({ toolCallId: toolCall.id, toolName: toolCall.name, ok: false });
      }
    }

    workingMessages = [
      ...workingMessages,
      {
        role: 'assistant',
        content: '',
        toolCalls: llmResponse.toolCalls,
      },
      ...toolResults.map((result) => ({
        role: 'tool' as const,
        content: result.content,
        toolCallId: result.toolCallId,
        toolName: result.name,
      })),
    ];
  }

  throw new Error(`Se supero el limite de ${toolRegistry.getMaxIterations()} iteraciones de tool calling.`);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;

async function bootstrap() {
  console.log('🔄 Iniciando secuencia de arranque del Gateway...');

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    try {
      googleAuthClient = await authenticateGoogle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Google OAuth no disponible. Gemini quedará deshabilitado hasta resolverlo: ${message}`);
    }
  } else {
    console.warn('⚠️ GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no configurados. Gemini quedará deshabilitado.');
  }

  app.listen(PORT, () => {
    console.log(`🚀 LLM Gateway escuchando en http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('❌ Error fatal al iniciar el Gateway:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
