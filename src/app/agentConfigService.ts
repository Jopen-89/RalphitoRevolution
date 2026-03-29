import type { AgentFallbackRoute, Provider } from '../core/domain/gateway.types.js';
import type { AgentRegistryRecord } from '../core/services/AgentRegistry.js';
import {
  validateAllowedTools,
  validateExecutionHarness,
  validateExecutionProfile,
  validateFallbacks,
  validateProviderModel,
  validateProviderProfile,
  type AgentConfigApiError,
} from './agentConfigValidation.js';

export const DEFAULT_MODEL_BY_PROVIDER: Record<Provider, string> = {
  gemini: 'gemini-3.1-pro-preview',
  openai: 'gpt-5.4',
  opencode: 'minimax-m2.7',
  codex: 'gpt-5.4',
};

const VALID_PROVIDERS = new Set<Provider>(['gemini', 'openai', 'opencode', 'codex']);
const VALID_TOOL_MODES = new Set(['none', 'allowed']);

export interface SerializedAgentRecord {
  agentId: string;
  name: string;
  roleFilePath: string;
  aliases: string[];
  isActive: boolean;
  primaryProvider: Provider;
  model: string;
  providerProfile: string | null;
  executionHarness: string;
  executionProfile: string | null;
  toolMode: string;
  allowedTools: string[];
  fallbacks: AgentFallbackRoute[];
  createdAt: string;
  updatedAt: string;
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

function parseProvider(value: unknown): Provider | null {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as Provider) ? (value as Provider) : null;
}

function parseProviderProfile(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
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
    fallbacks.push({
      provider,
      model,
      ...(providerProfile ? { providerProfile } : {}),
    });
  }

  return fallbacks;
}

export function serializeAgentRecord(record: AgentRegistryRecord, aliases: string[]) {
  const primaryProvider = (record.primary_provider || record.provider || DEFAULT_MODEL_BY_PROVIDER.gemini) as Provider;
  return {
    agentId: record.agent_id,
    name: record.name,
    roleFilePath: record.role_file_path,
    aliases,
    isActive: Boolean(record.is_active),
    primaryProvider,
    model: record.model || DEFAULT_MODEL_BY_PROVIDER[primaryProvider],
    providerProfile: record.provider_profile,
    executionHarness: record.execution_harness || 'opencode',
    executionProfile: record.execution_profile,
    toolMode: record.tool_calling_mode || record.tool_mode || 'none',
    allowedTools: parseJsonArray<string>(record.allowed_tools_json, []),
    fallbacks: parseJsonArray<AgentFallbackRoute>(record.fallbacks_json, []),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  } satisfies SerializedAgentRecord;
}

export function buildAgentConfigUpdates(
  agentId: string,
  existing: AgentRegistryRecord,
  body: Record<string, unknown>,
): { updates: Partial<AgentRegistryRecord> } | { error: AgentConfigApiError | { error: string } } {
  const updates: Partial<AgentRegistryRecord> = {};

  if ('primaryProvider' in body) {
    const provider = parseProvider(body.primaryProvider);
    if (!provider) {
      return { error: { error: 'Invalid primaryProvider' } };
    }
    updates.primary_provider = provider;
    updates.provider = provider;
  }

  if ('providerProfile' in body) {
    if (body.providerProfile !== null && typeof body.providerProfile !== 'string') {
      return { error: { error: 'Invalid providerProfile' } };
    }
    updates.provider_profile = parseProviderProfile(body.providerProfile);
  }

  if ('executionHarness' in body) {
    const executionHarness = parseExecutionHarness(body.executionHarness);
    if (!executionHarness) {
      return { error: { field: 'executionHarness', error: 'Invalid executionHarness' } };
    }
    const harnessError = validateExecutionHarness(executionHarness);
    if (harnessError) {
      return { error: harnessError };
    }
    updates.execution_harness = executionHarness;
  }

  if ('executionProfile' in body) {
    if (body.executionProfile !== null && typeof body.executionProfile !== 'string') {
      return { error: { error: 'Invalid executionProfile' } };
    }
    updates.execution_profile = parseProviderProfile(body.executionProfile);
  }

  if ('model' in body) {
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) {
      return { error: { error: 'Invalid model' } };
    }
    updates.model = model;
  }

  if ('toolMode' in body) {
    const toolMode = parseToolMode(body.toolMode);
    if (!toolMode) {
      return { error: { error: 'Invalid toolMode' } };
    }
    updates.tool_calling_mode = toolMode;
  }

  if ('allowedTools' in body) {
    if (!Array.isArray(body.allowedTools) || body.allowedTools.some((tool) => typeof tool !== 'string')) {
      return { error: { field: 'allowedTools', error: 'Invalid allowedTools' } };
    }
    const allowedTools = body.allowedTools.map((tool) => String(tool));
    const toolError = validateAllowedTools(agentId, allowedTools);
    if (toolError) {
      return { error: toolError };
    }
    updates.allowed_tools_json = JSON.stringify(allowedTools);
  }

  if ('fallbacks' in body) {
    const fallbacks = parseFallbacks(body.fallbacks);
    if (!fallbacks) {
      return { error: { field: 'fallbacks', error: 'Invalid fallbacks' } };
    }
    const fallbackError = validateFallbacks(fallbacks);
    if (fallbackError) {
      return { error: fallbackError };
    }
    updates.fallbacks_json = JSON.stringify(fallbacks);
  }

  if ('isActive' in body) {
    if (typeof body.isActive !== 'boolean') {
      return { error: { error: 'Invalid isActive' } };
    }
    updates.is_active = body.isActive ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return { error: { error: 'No valid agent fields provided' } };
  }

  const effectiveProvider = (updates.primary_provider || existing.primary_provider || existing.provider || DEFAULT_MODEL_BY_PROVIDER.gemini) as Provider;
  const effectiveModel = updates.model || existing.model || DEFAULT_MODEL_BY_PROVIDER[effectiveProvider];
  const effectiveExecutionHarness = (updates.execution_harness || existing.execution_harness) === 'codex' ? 'codex' : 'opencode';
  const effectiveProviderProfile = 'provider_profile' in updates
    ? updates.provider_profile || null
    : existing.provider_profile || null;
  const effectiveExecutionProfile = 'execution_profile' in updates
    ? updates.execution_profile || null
    : existing.execution_profile || null;

  const modelError = validateProviderModel(effectiveProvider, effectiveModel);
  if (modelError) {
    return { error: modelError };
  }

  if (effectiveExecutionHarness === 'codex') {
    const executionModelError = validateProviderModel('codex', effectiveModel);
    if (executionModelError) {
      return {
        error: {
          ...executionModelError,
          field: 'model',
          error: `Model ${effectiveModel} is not supported for executionHarness codex`,
        },
      };
    }
  }

  const profileError = validateProviderProfile(effectiveProvider, effectiveProviderProfile);
  if (profileError) {
    return { error: profileError };
  }

  const executionProfileError = validateExecutionProfile(effectiveExecutionHarness, effectiveExecutionProfile);
  if (executionProfileError) {
    return { error: executionProfileError };
  }

  return { updates };
}
