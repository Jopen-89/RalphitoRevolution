import type { AgentConfig, Provider } from '../core/domain/gateway.types.js';
import { readRuntimeSessionFile } from '../core/engine/runtimeFiles.js';
import { ProjectService } from '../core/services/ProjectService.js';
import { DEFAULT_MODEL_BY_PROVIDER } from './agentConfigService.js';

export interface RuntimeResolvedAgentConfig {
  agentConfig: AgentConfig;
  resolvedAgentId: string;
  source: 'runtime_snapshot';
  resolvedAt: string | null;
}

export function resolveRuntimeAgentConfig(worktreePath: string): RuntimeResolvedAgentConfig | null {
  const sessionFile = readRuntimeSessionFile(worktreePath);
  const snapshot = sessionFile?.agentConfigSnapshot;
  if (!sessionFile || !snapshot) return null;

  const project = ProjectService.resolve(sessionFile.projectId);
  const resolvedAgentId = snapshot.agentId || sessionFile.agentConfigId || project.agentConfigId;
  const primaryProvider = (snapshot.primaryProvider || project.provider || 'gemini') as Provider;

  return {
    agentConfig: {
      agentId: resolvedAgentId,
      primaryProvider,
      model: snapshot.model || project.model || DEFAULT_MODEL_BY_PROVIDER[primaryProvider],
      ...(snapshot.providerProfile ? { providerProfile: snapshot.providerProfile } : {}),
      executionHarness: snapshot.executionHarness,
      toolMode: snapshot.toolMode,
      allowedTools: [...snapshot.allowedTools],
      fallbacks: [...snapshot.fallbacks],
    },
    resolvedAgentId,
    source: 'runtime_snapshot',
    resolvedAt: snapshot.resolvedAt || null,
  };
}
