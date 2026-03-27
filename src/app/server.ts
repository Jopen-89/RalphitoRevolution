import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProviderFactory } from '../gateway/providers/provider.factory.js';
import type { Provider, Message, AgentConfig, AgentFallbackRoute, GatewayConfig, ChatRequest, ChatResponse } from '../core/domain/gateway.types.js';
import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';
import { renderDashboardPage } from '../interfaces/dashboard/dashboardPage.js';
import {
  getUnifiedDashboardSessionDetail,
  getUnifiedDashboardSessions,
  updateDashboardTaskStatus,
} from '../interfaces/dashboard/dashboardService.js';
import { backupRalphitoDatabase, getOperationalStatus, recordSystemEvent } from '../infrastructure/logging/observabilityService.js';
import { searchIndexedDocuments } from '../core/services/codeIndexService.js';
import { executeToolCallLoop } from '../gateway/tools/toolCallingExecutor.js';
import { createAllToolImplementations, resolveAllowedToolDefinitions } from '../gateway/tools/toolCatalog.js';
import type { IToolCallingProvider } from '../core/domain/gateway.types.js';
import { RUNTIME_LLM_WAITING_FILE_NAME } from '../core/domain/constants.js';

import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import type { AgentRegistryRecord } from '../core/services/AgentRegistry.js';
import { buildProviderCapabilityHealth, getProviderCatalogStatus, PROVIDER_MATRIX } from '../gateway/providers/providerCatalog.js';
import { createAttemptDiagnostic, formatAttemptSummary, toDiagnosticErrorMessage } from '../gateway/providers/providerDiagnostics.js';
import { listConfiguredCodexProfiles } from '../gateway/providers/providerProfiles.js';
import { buildToolCallingUnsupportedMessage, splitToolCallingAttempts } from '../gateway/providers/providerRouting.js';
import { traceOutput } from '../core/services/outputTrace.js';
import {
  buildAgentConfigApiMetadata,
  validateAllowedTools,
  validateExecutionHarness,
  validateFallbacks as validateFallbackRoutes,
  validateProviderModel,
  validateProviderProfile,
} from './agentConfigValidation.js';
import { assertRequiredToolCalls, resolveRequiredToolNames } from './chatToolRequirements.js';
import { validateManagedWorktreeHeader } from './worktreeHeaderValidation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
initializeRalphitoDatabase();
AgentRegistryService.sync();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-ralphito-worktree-path');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use((req, res, next) => {
  console.log(`[Gateway] ${req.method} ${req.url}`);
  next();
});

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
  moncho: ['moncho', 'product-team'],
  poncho: ['poncho', 'architecture-team'],
  martapepis: ['martapepis', 'marta', 'marta pepis', 'research-team'],
  lola: ['lola', 'design-team'],
  mapito: ['mapito', 'security-team'],
  juez: ['juez'],
  tracker: ['tracker'],
  ricky: ['ricky', 'qa-team'],
  miron: ['miron', 'visual-qa-team'],
  relleno: ['relleno', 'automation-team'],
  ralphito: ['ralphito', 'backend-team', 'frontend-team', 'devops-team'],
};

const VALID_PROVIDERS = new Set<Provider>(['gemini', 'openai', 'opencode', 'codex']);
const VALID_TOOL_MODES = new Set(['none', 'allowed']);

function normalizeAgentId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveAgentConfigRecord(agentId: string): AgentConfig | undefined {
  return AgentRegistryService.getAgentConfig(agentId);
}

function readEnvValue(name: string) {
  const value = process.env[name];
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}

function buildProviderAuth() {
  return {
    ...(googleAuthClient ? { googleAuthClient } : {}),
    ...(readEnvValue('OPENAI_API_KEY') ? { openAiKey: readEnvValue('OPENAI_API_KEY')! } : {}),
    ...(readEnvValue('MINIMAX_API_KEY') ? { minimaxKey: readEnvValue('MINIMAX_API_KEY')! } : {}),
  };
}

function parseJsonArray<T>(raw: string | null, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function serializeAgentRecord(record: AgentRegistryRecord) {
  const primaryProvider = (record.primary_provider || record.provider || DEFAULT_MODEL_BY_PROVIDER.gemini) as Provider;
  return {
    agentId: record.agent_id,
    name: record.name,
    roleFilePath: record.role_file_path,
    aliases: AGENT_ALIASES[record.agent_id] || [record.agent_id],
    isActive: Boolean(record.is_active),
    primaryProvider,
    model: record.model || DEFAULT_MODEL_BY_PROVIDER[primaryProvider],
    providerProfile: record.provider_profile,
    executionHarness: record.execution_harness || 'opencode',
    toolMode: record.tool_calling_mode || record.tool_mode || 'none',
    allowedTools: parseJsonArray<string>(record.allowed_tools_json, []),
    fallbacks: parseJsonArray<AgentFallbackRoute>(record.fallbacks_json, []),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function parseProviderProfile(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function extractHandoffAgentId(toolCalls: ChatResponse['toolCalls'], toolResults: ChatResponse['toolResults']) {
  if (!toolCalls || !toolResults) return undefined;

  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    const result = toolResults[index];
    if (call?.name !== 'summon_agent_to_chat' || !result?.ok) continue;

    const output = result.payload?.output as { agentId?: unknown } | undefined;
    if (typeof output?.agentId === 'string' && output.agentId.trim()) {
      return output.agentId;
    }
  }

  return undefined;
}

function parseProvider(value: unknown): Provider | null {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as Provider) ? (value as Provider) : null;
}

function parseToolMode(value: unknown): 'none' | 'allowed' | null {
  return typeof value === 'string' && VALID_TOOL_MODES.has(value) ? (value as 'none' | 'allowed') : null;
}

function parseExecutionHarness(value: unknown) {
  return value === 'opencode' || value === 'codex' ? value : null;
}

function parseFallbacks(value: unknown) {
  if (!Array.isArray(value)) return null;

  const fallbacks: AgentFallbackRoute[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    const provider = parseProvider(entry.provider);
    const modelValue = entry.model;
    const model = typeof modelValue === 'string' ? modelValue.trim() : '';
    const providerProfile = 'providerProfile' in entry ? parseProviderProfile(entry.providerProfile) : undefined;
    if (!provider || !model) return null;
    fallbacks.push({ provider, model, ...(providerProfile ? { providerProfile } : {}) });
  }

  return fallbacks;
}

function buildSmokePrompt(provider: Provider, model: string) {
  return [{ role: 'user', content: `Smoke test de provider ${provider} con modelo ${model}. Responde solo OK.` }];
}

// Cargar configuración de agentes dinámicamente desde la DB
const resolveAgentConfigFromDb = (rawAgentId: string) => {
  const requestedId = normalizeAgentId(rawAgentId || 'default');
  console.log(`[Gateway] Resolviendo config dinamicamente para agentId: "${rawAgentId}" (normalized: "${requestedId}")`);
  
  const agent = resolveAgentConfigRecord(requestedId);
  if (agent) {
    console.log(`[Gateway] Encontrado config directa para "${requestedId}"`);
    return { 
      agentConfig: agent,
      resolvedAgentId: agent.agentId,
      requestedId 
    };
  }

  // Check aliases from AGENT_ALIASES
  for (const [canonicalId, aliases] of Object.entries(AGENT_ALIASES)) {
    if (!aliases.map(normalizeAgentId).includes(requestedId)) continue;
    const aliasAgent = resolveAgentConfigRecord(canonicalId);
    if (aliasAgent) {
      console.log(`[Gateway] Encontrado config via alias: "${requestedId}" -> "${canonicalId}"`);
      return { 
        agentConfig: aliasAgent,
        resolvedAgentId: canonicalId, 
        requestedId 
      };
    }
  }

  console.log(`[Gateway] No se encontró config para "${requestedId}", usando fallback "default"`);
  const fallbackAgent = resolveAgentConfigRecord('default');
  if (fallbackAgent) {
    return { 
      agentConfig: fallbackAgent,
      resolvedAgentId: 'default', 
      requestedId 
    };
  }

  return { agentConfig: undefined, resolvedAgentId: undefined, requestedId };
};

app.post('/v1/chat/completions', async (req, res) => {
  const { model: modelInput, messages, stream } = req.body;
  const isStream = stream === true;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Faltan parámetros messages (debe ser un array)' });
  }

  const rawModelInput = String(modelInput || '').trim();
  const cleanModel = (modelInput || '').replace(/^[a-z]+\//i, '');
  const provider = rawModelInput.startsWith('minimax/')
    ? 'opencode'
    : rawModelInput.startsWith('google/')
      ? 'gemini'
      : rawModelInput.startsWith('codex/')
        ? 'codex'
        : cleanModel.toLowerCase().includes('minimax')
          ? 'opencode'
          : cleanModel.toLowerCase().includes('gpt')
            ? 'openai'
            : 'gemini';

  const auth = buildProviderAuth();

  try {
    const llmProvider = ProviderFactory.create(provider as Provider, cleanModel, auth);
    const responseText = await llmProvider.generateResponse(messages);

    const openAIResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: cleanModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: responseText },
        finish_reason: 'stop',
      }],
    };

    if (isStream) {
      console.warn('[Gateway] Petición stream detectada: envolviendo respuesta completa en SSE falso.');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const chunk = {
        id: openAIResponse.id,
        object: 'chat.completion.chunk',
        choices: [{ delta: { role: 'assistant', content: responseText } }],
      };

      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json(openAIResponse);
    }
  } catch (error) {
    const details = toDiagnosticErrorMessage(error);
    console.error(`[Gateway] Error en /v1/chat/completions:`, details);
    res.status(502).json({
      error: 'PROVIDER_ERROR',
      message: details,
      details,
    });
  }
});

app.post('/v1/chat', async (req, res) => {
  const { agentId = 'default', provider, model, providerProfile, messages, originChatId, originThreadId } = req.body as ChatRequest;
  const rawWorktreePath = req.headers['x-ralphito-worktree-path'] as string | undefined;
  const validatedWorktree = validateManagedWorktreeHeader(rawWorktreePath);
  if (!validatedWorktree.ok) {
    return res.status(400).json({
      error: 'INVALID_WORKTREE_HEADER',
      message: validatedWorktree.error,
    });
  }

  const worktreePath = validatedWorktree.worktreePath;
  const waitingFilePath = worktreePath ? path.join(worktreePath, RUNTIME_LLM_WAITING_FILE_NAME) : null;

  const cleanupWaitingFile = () => {
    if (waitingFilePath && fs.existsSync(waitingFilePath)) {
      try {
        fs.unlinkSync(waitingFilePath);
      } catch {
        // noop
      }
    }
  };

  if (waitingFilePath) {
    try {
      fs.writeFileSync(waitingFilePath, new Date().toISOString(), 'utf8');
    } catch (error) {
      console.warn(`[Gateway] No pude escribir marker de espera en ${waitingFilePath}:`, error);
    }
  }

  try {
    if (!messages || !Array.isArray(messages)) {
      cleanupWaitingFile();
      return res.status(400).json({ error: 'Faltan parámetros messages (debe ser un array)' });
    }

  const { agentConfig, resolvedAgentId, requestedId } = resolveAgentConfigFromDb(agentId);

  if (!agentConfig && !provider) {
    return res.status(404).json({
      error: 'AGENT_CONFIG_NOT_FOUND',
      message: `No encuentro configuración para el agente '${agentId}'.`,
      requestedAgentId: agentId,
      normalizedAgentId: requestedId,
    });
  }

  const attempts = provider
    ? [{ provider, model: model || DEFAULT_MODEL_BY_PROVIDER[provider], ...(providerProfile ? { providerProfile } : {}) }]
    : [
        {
          provider: agentConfig!.primaryProvider,
          model: agentConfig!.model || DEFAULT_MODEL_BY_PROVIDER[agentConfig!.primaryProvider],
          ...(agentConfig!.providerProfile ? { providerProfile: agentConfig!.providerProfile } : {}),
        },
        ...agentConfig!.fallbacks.map((fallback) => ({
          provider: fallback.provider,
          model: fallback.model || DEFAULT_MODEL_BY_PROVIDER[fallback.provider],
          ...(fallback.providerProfile ? { providerProfile: fallback.providerProfile } : {}),
        })),
      ];

  const { allowed: allowedToolDefinitions, unknownNames } = resolveAllowedToolDefinitions(agentConfig);
  console.log(`[Gateway] Tools permitidas para "${resolvedAgentId}":`, allowedToolDefinitions.map(d => d.name));
  const requiredToolNames = resolveRequiredToolNames({
    agentId: resolvedAgentId,
    messages,
    allowedToolNames: allowedToolDefinitions.map((definition) => definition.name),
  });
  const useToolCalling = allowedToolDefinitions.length > 0;
  if (useToolCalling) {
    const { supported: toolCallingAttempts, unsupported: unsupportedToolCallingAttempts } = splitToolCallingAttempts(attempts);
    const failedAttempts = unsupportedToolCallingAttempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      capability: 'tool-calling' as const,
      success: false,
      reason: 'tool-calling unsupported for configured provider',
    })) as Array<ReturnType<typeof createAttemptDiagnostic>>;

    if (toolCallingAttempts.length === 0) {
      return res.status(400).json({
        error: 'TOOL_CALLING_UNSUPPORTED',
        message: buildToolCallingUnsupportedMessage(unsupportedToolCallingAttempts),
        attempts: failedAttempts,
        details: formatAttemptSummary(failedAttempts),
      });
    }

    if (unknownNames.length > 0) {
      console.warn(`[Gateway] Tools desconocidas para '${resolvedAgentId}': ${unknownNames.join(', ')}`);
    }
    if (unsupportedToolCallingAttempts.length > 0) {
      console.warn(
        `[Gateway] Omitiendo providers sin tool-calling para '${resolvedAgentId}': ${unsupportedToolCallingAttempts.map((attempt) => `${attempt.provider} (${attempt.model})`).join(', ')}`,
      );
    }
    const allTools = createAllToolImplementations({
      ...(typeof originThreadId === 'number' ? { originThreadId } : {}),
      ...(typeof originChatId === 'string' && originChatId.trim() ? { notificationChatId: originChatId } : {}),
      ...(worktreePath ? { worktreePath } : {}),
      ...(resolvedAgentId ? { currentAgentId: resolvedAgentId } : {}),
    });
    let lastToolCallingError: unknown = null;

    for (const attempt of toolCallingAttempts) {
      try {
        console.log(`[Gateway] Tool-calling con ${attempt.provider} (${attempt.model})...`);

        const llmProvider = ProviderFactory.create(
          attempt.provider,
          attempt.model,
          buildProviderAuth(),
          attempt.providerProfile,
        ) as IToolCallingProvider;

        const { text, toolCalls, toolResults } = await executeToolCallLoop(
          messages,
          allowedToolDefinitions,
          allTools,
          llmProvider,
          {
            ...(worktreePath ? { worktreePath } : {}),
            ...(requiredToolNames.length > 0 ? { requiredToolNames } : {}),
          },
        );
        assertRequiredToolCalls(requiredToolNames, toolCalls);

        const handoffAgentId = extractHandoffAgentId(toolCalls, toolResults);
        traceOutput({
          stage: 'gateway.response.toolCalling',
          text,
          provider: attempt.provider,
          model: attempt.model,
          ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
          ...(handoffAgentId ? { handoffAgentId } : {}),
          toolCallCount: toolCalls.length,
        });
        const successResponse: ChatResponse = {
          response: text,
          providerUsed: attempt.provider,
          modelUsed: attempt.model,
          ...(handoffAgentId ? { handoffAgentId } : {}),
          toolCalls,
          toolResults,
        };

        return res.json(successResponse);
      } catch (error) {
        const details = toDiagnosticErrorMessage(error);
        console.warn(`⚠️ Falló tool-calling con ${attempt.provider}:`, details);
        failedAttempts.push(createAttemptDiagnostic(attempt.provider, attempt.model, 'tool-calling', error));
        lastToolCallingError = error;
        continue;
      }
    }

    return res.status(502).json({
      error: 'TOOL_CALLING_FAILED',
      message: 'Todos los providers con soporte de tool-calling fallaron.',
      ...(lastToolCallingError ? { details: formatAttemptSummary(failedAttempts) } : {}),
      attempts: failedAttempts,
    });
  }

  let lastError: unknown = null;
  const failedAttempts = [] as Array<ReturnType<typeof createAttemptDiagnostic>>;

  for (const attempt of attempts) {
    try {
      console.log(`[Gateway] Intentando con ${attempt.provider} (${attempt.model})...`);

      const llmProvider = ProviderFactory.create(attempt.provider, attempt.model, buildProviderAuth(), attempt.providerProfile);
      const responseText = await llmProvider.generateResponse(messages);
      if (!responseText.trim()) {
        throw new Error(`Provider ${attempt.provider} (${attempt.model}) devolvió una respuesta vacía.`);
      }
      traceOutput({
        stage: 'gateway.response.chat',
        text: responseText,
        provider: attempt.provider,
        model: attempt.model,
        ...(resolvedAgentId ? { agentId: resolvedAgentId } : {}),
      });

      const successResponse: ChatResponse = {
        response: responseText,
        providerUsed: attempt.provider,
        modelUsed: attempt.model,
      };

      return res.json(successResponse);
    } catch (error) {
      const details = toDiagnosticErrorMessage(error);
      console.warn(`⚠️ Falló ${attempt.provider} (${attempt.model}):`, details);
      failedAttempts.push(createAttemptDiagnostic(attempt.provider, attempt.model, 'chat', error));
      lastError = error;
    }
  }

  console.error('❌ Todos los proveedores fallaron:', lastError);
  res.status(502).json({
    error: 'ALL_PROVIDERS_UNAVAILABLE',
    message: 'Todos los providers configurados fallaron para chat.',
    details: formatAttemptSummary(failedAttempts),
    attempts: failedAttempts,
  });
  } finally {
    cleanupWaitingFile();
  }
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
  const providerHealth = buildProviderCapabilityHealth(buildProviderAuth());
  const ok = status.health.db.ok
    && status.health.engine.ok
    && status.health.searchIndex.ok
    && providerHealth.chat.ok;
  res.status(ok ? 200 : 503).json({ ok, health: status.health, providers: providerHealth });
});

app.get('/api/ops/status', async (_req, res) => {
  try {
    const status = await getOperationalStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build ops status' });
  }
});

app.get('/api/providers/status', async (_req, res) => {
  const auth = buildProviderAuth();
  const providers = getProviderCatalogStatus(auth);
  const capabilityHealth = buildProviderCapabilityHealth(auth);

  res.json({
    defaults: DEFAULT_MODEL_BY_PROVIDER,
    providers,
    capabilityHealth,
    codexProfiles: listConfiguredCodexProfiles(process.env),
    routing: {
      gpt54: {
        directApiProvider: 'openai',
        cliSubscriptionProvider: 'codex',
        toolCallingProvider: 'openai',
      },
    },
  });
});

app.post('/api/providers/smoke', async (req, res) => {
  const requestedProvider = parseProvider(req.body?.provider);
  if (!requestedProvider) {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  const matrix = PROVIDER_MATRIX[requestedProvider];
  const model = typeof req.body?.model === 'string' && req.body.model.trim()
    ? req.body.model.trim()
    : matrix.officialModels[0];
  const requireToolCalling = req.body?.toolCalling === true;

  if (requireToolCalling && !matrix.toolCalling) {
    res.status(400).json({
      error: 'TOOL_CALLING_UNSUPPORTED',
      message: `Provider ${requestedProvider} no soporta tool-calling en smoke tests.`,
    });
    return;
  }

  try {
    const requestedProviderProfile = parseProviderProfile(req.body?.providerProfile);
    const provider = ProviderFactory.create(requestedProvider, model, buildProviderAuth(), requestedProviderProfile || undefined);
    const messages = buildSmokePrompt(requestedProvider, model);

    if (requireToolCalling && 'generateResponseWithTools' in provider) {
      const toolProvider = provider as IToolCallingProvider;
      const result = await toolProvider.generateResponseWithTools(messages, []);
      res.json({
        ok: true,
        provider: requestedProvider,
        model,
        toolCalling: true,
        responsePreview: result.text.slice(0, 200),
        toolCalls: result.toolCalls.length,
      });
      return;
    }

    const responseText = await provider.generateResponse(messages);
    res.json({
      ok: true,
      provider: requestedProvider,
      model,
      toolCalling: false,
      responsePreview: responseText.slice(0, 200),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      provider: requestedProvider,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get('/api/agents', (_req, res) => {
  const agents = AgentRegistryService.getAllActive()
    .filter((record) => record.agent_id !== 'default')
    .sort((a, b) => a.agent_id.localeCompare(b.agent_id))
    .map(serializeAgentRecord);

  res.json({ agents, defaults: DEFAULT_MODEL_BY_PROVIDER, meta: buildAgentConfigApiMetadata() });
});

app.get('/api/agents/:id', (req, res) => {
  const record = AgentRegistryService.getById(req.params.id);
  if (!record || !record.is_active) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  res.json({ agent: serializeAgentRecord(record) });
});

app.patch('/api/agents/:id', (req, res) => {
  const existing = AgentRegistryService.getById(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const updates: Partial<AgentRegistryRecord> = {};

  if ('primaryProvider' in body) {
    const provider = parseProvider(body.primaryProvider);
    if (!provider) {
      res.status(400).json({ error: 'Invalid primaryProvider' });
      return;
    }
    updates.primary_provider = provider;
    updates.provider = provider;
  }

  if ('providerProfile' in body) {
    if (body.providerProfile !== null && typeof body.providerProfile !== 'string') {
      res.status(400).json({ error: 'Invalid providerProfile' });
      return;
    }
    updates.provider_profile = parseProviderProfile(body.providerProfile);
  }

  if ('executionHarness' in body) {
    const executionHarness = parseExecutionHarness(body.executionHarness);
    if (!executionHarness) {
      res.status(400).json({ field: 'executionHarness', error: 'Invalid executionHarness' });
      return;
    }
    const harnessError = validateExecutionHarness(executionHarness);
    if (harnessError) {
      res.status(400).json(harnessError);
      return;
    }
    updates.execution_harness = executionHarness;
  }

  if ('model' in body) {
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) {
      res.status(400).json({ error: 'Invalid model' });
      return;
    }
    updates.model = model;
  }

  if ('toolMode' in body) {
    const toolMode = parseToolMode(body.toolMode);
    if (!toolMode) {
      res.status(400).json({ error: 'Invalid toolMode' });
      return;
    }
    updates.tool_calling_mode = toolMode;
  }

  if ('allowedTools' in body) {
    if (!Array.isArray(body.allowedTools) || body.allowedTools.some((tool) => typeof tool !== 'string')) {
      res.status(400).json({ field: 'allowedTools', error: 'Invalid allowedTools' });
      return;
    }
    const allowedTools = body.allowedTools.map((tool) => String(tool));
    const toolError = validateAllowedTools(req.params.id, allowedTools);
    if (toolError) {
      res.status(400).json(toolError);
      return;
    }
    updates.allowed_tools_json = JSON.stringify(allowedTools);
  }

  if ('fallbacks' in body) {
    const fallbacks = parseFallbacks(body.fallbacks);
    if (!fallbacks) {
      res.status(400).json({ field: 'fallbacks', error: 'Invalid fallbacks' });
      return;
    }
    const fallbackError = validateFallbackRoutes(fallbacks);
    if (fallbackError) {
      res.status(400).json(fallbackError);
      return;
    }
    updates.fallbacks_json = JSON.stringify(fallbacks);
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({ error: 'Invalid isActive' });
      return;
    }
    updates.is_active = body.isActive ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid agent fields provided' });
    return;
  }

  const effectiveProvider = (updates.primary_provider || existing.primary_provider || existing.provider || DEFAULT_MODEL_BY_PROVIDER.gemini) as Provider;
  const effectiveModel = updates.model || existing.model || DEFAULT_MODEL_BY_PROVIDER[effectiveProvider];
  const effectiveProviderProfile = 'provider_profile' in updates
    ? updates.provider_profile || null
    : existing.provider_profile || null;

  const modelError = validateProviderModel(effectiveProvider, effectiveModel);
  if (modelError) {
    res.status(400).json(modelError);
    return;
  }

  const profileError = validateProviderProfile(effectiveProvider, effectiveProviderProfile);
  if (profileError) {
    res.status(400).json(profileError);
    return;
  }

  AgentRegistryService.updateAgentConfig(req.params.id, updates);
  const refreshed = AgentRegistryService.getById(req.params.id);
  if (!refreshed) {
    res.status(404).json({ error: 'Agent not found after update' });
    return;
  }

  res.json({ success: true, agent: serializeAgentRecord(refreshed) });
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

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3006;

function bootstrap() {
  console.log('🔄 Iniciando secuencia de arranque del Gateway...');

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LLM Gateway escuchando en http://0.0.0.0:${PORT}`);

    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      import('../gateway/auth/google-oauth.js')
        .then(({ authenticateGoogle }) => authenticateGoogle())
        .then((client) => {
          googleAuthClient = client;
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`⚠️ Google OAuth no disponible. Gemini quedará deshabilitado hasta resolverlo: ${message}`);
        });
    } else {
      console.warn('⚠️ GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no configurados. Gemini quedará deshabilitado.');
    }
  });

  server.on('error', (error) => {
    console.error('❌ Error fatal en el socket del servidor Gateway:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

bootstrap();
