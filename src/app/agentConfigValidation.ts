import type { AgentFallbackRoute, ExecutionHarness, Provider } from '../core/domain/gateway.types.js';
import { PROVIDER_MATRIX } from '../gateway/providers/providerCatalog.js';
import { listConfiguredCodexProfiles } from '../gateway/providers/providerProfiles.js';
import { createAllToolDefinitions } from '../gateway/tools/toolCatalog.js';
import { isRaymonToolName } from '../gateway/tools/raymonTools.js';

export interface AgentConfigApiError {
  field: string;
  error: string;
  details?: string;
}

export function buildAgentConfigApiMetadata() {
  const codexProfiles = listConfiguredCodexProfiles(process.env);

  return {
    providers: Object.keys(PROVIDER_MATRIX).sort() as Provider[],
    executionHarnesses: ['opencode', 'codex'] as const satisfies readonly ExecutionHarness[],
    toolModes: ['none', 'allowed'] as const,
    toolNames: createAllToolDefinitions().map((tool) => tool.name).sort(),
    providerModels: Object.fromEntries(
      Object.entries(PROVIDER_MATRIX).map(([provider, entry]) => [provider, entry.officialModels]),
    ) as Record<Provider, string[]>,
    providerProfiles: {
      codex: codexProfiles,
    },
    executionProfiles: {
      codex: codexProfiles,
    },
  };
}

export function validateExecutionHarness(harness: ExecutionHarness): AgentConfigApiError | null {
  if (harness === 'opencode' || harness === 'codex') {
    return null;
  }

  return {
    field: 'executionHarness',
    error: `Unknown executionHarness ${harness}`,
  };
}

export function validateProviderModel(provider: Provider, model: string): AgentConfigApiError | null {
  const officialModels = PROVIDER_MATRIX[provider]?.officialModels || [];
  if (!model.trim()) {
    return { field: 'model', error: 'Invalid model' };
  }

  if (officialModels.length > 0 && !officialModels.includes(model.trim())) {
    return {
      field: 'model',
      error: `Model ${model.trim()} is not supported for provider ${provider}`,
      details: `Use one of: ${officialModels.join(', ')}`,
    };
  }

  return null;
}

export function validateProviderProfile(provider: Provider, profile: string | null): AgentConfigApiError | null {
  if (!profile) return null;

  if (provider !== 'codex') {
    return {
      field: 'providerProfile',
      error: `Provider ${provider} does not support providerProfile`,
    };
  }

  const configuredProfiles = listConfiguredCodexProfiles(process.env);
  if (configuredProfiles.length > 0 && !configuredProfiles.includes(profile)) {
    return {
      field: 'providerProfile',
      error: `Unknown codex providerProfile ${profile}`,
      details: `Configured profiles: ${configuredProfiles.join(', ')}`,
    };
  }

  return null;
}

export function validateExecutionProfile(harness: ExecutionHarness, profile: string | null): AgentConfigApiError | null {
  if (!profile) return null;

  if (harness !== 'codex') {
    return {
      field: 'executionProfile',
      error: `Execution harness ${harness} does not support executionProfile`,
    };
  }

  const configuredProfiles = listConfiguredCodexProfiles(process.env);
  if (configuredProfiles.length > 0 && !configuredProfiles.includes(profile)) {
    return {
      field: 'executionProfile',
      error: `Unknown codex executionProfile ${profile}`,
      details: `Configured profiles: ${configuredProfiles.join(', ')}`,
    };
  }

  return null;
}

export function validateAllowedTools(agentId: string, tools: string[]): AgentConfigApiError | null {
  const validNames = new Set(createAllToolDefinitions().map((tool) => tool.name));

  for (const toolName of tools) {
    if (!validNames.has(toolName)) {
      return { field: 'allowedTools', error: `Unknown tool ${toolName}` };
    }
    if (isRaymonToolName(toolName) && agentId !== 'raymon') {
      return { field: 'allowedTools', error: `Tool ${toolName} is reserved for Raymon` };
    }
  }

  return null;
}

export function validateFallbacks(fallbacks: AgentFallbackRoute[]): AgentConfigApiError | null {
  for (const fallback of fallbacks) {
    const modelError = validateProviderModel(fallback.provider, fallback.model);
    if (modelError) {
      return { ...modelError, field: 'fallbacks' };
    }

    const profileError = validateProviderProfile(fallback.provider, fallback.providerProfile || null);
    if (profileError) {
      return { ...profileError, field: 'fallbacks' };
    }
  }

  return null;
}
