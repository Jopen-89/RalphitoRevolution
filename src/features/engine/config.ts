import { readFileSync } from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { Provider } from '../llm-gateway/interfaces/gateway.types.js';

interface RawAgentConfig {
  provider?: Provider;
  model?: string;
}

interface RawProjectConfig {
  name?: string;
  sessionPrefix?: string;
  path?: string;
  defaultBranch?: string;
  agentRulesFile?: string;
  agent?: string;
  agentConfig?: RawAgentConfig;
}

interface RawEngineConfig {
  defaults?: {
    agent?: string;
    agentConfig?: RawAgentConfig;
  };
  projects?: Record<string, RawProjectConfig>;
}

export interface EngineProjectConfig {
  id: string;
  name: string;
  sessionPrefix: string;
  path: string;
  defaultBranch: string;
  agentRulesFile: string | null;
  agent: string;
  provider: Provider | null;
  model: string | null;
}

function getDefaultConfigPath() {
  return path.join(process.cwd(), 'ops', 'agent-orchestrator.yaml');
}

export function resolveEngineProjectConfig(projectId: string, configPath = getDefaultConfigPath()) {
  const rawConfig = YAML.parse(readFileSync(configPath, 'utf8')) as RawEngineConfig;
  const project = rawConfig.projects?.[projectId];

  if (!project?.path) {
    throw new Error(`Proyecto no encontrado en la config del engine: ${projectId}`);
  }

  const defaults = rawConfig.defaults || {};

  return {
    id: projectId,
    name: project.name || projectId,
    sessionPrefix: project.sessionPrefix || projectId.replace(/[^a-z0-9]+/gi, '').slice(0, 3) || 'rr',
    path: path.resolve(project.path),
    defaultBranch: project.defaultBranch || 'master',
    agentRulesFile: project.agentRulesFile || null,
    agent: project.agent || defaults.agent || 'opencode',
    provider: project.agentConfig?.provider || defaults.agentConfig?.provider || null,
    model: project.agentConfig?.model || defaults.agentConfig?.model || null,
  } satisfies EngineProjectConfig;
}
