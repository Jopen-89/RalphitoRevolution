import os from 'os';
import path from 'path';
import type { AgentFallbackRoute, ExecutionHarness, Provider, ToolMode } from '../domain/gateway.types.js';
import { DEFAULT_RALPHITO_HOME_DIRNAME, ENGINE_WORKTREE_ROOT } from '../domain/constants.js';
import { AgentRegistryService } from './AgentRegistry.js';
import { getRalphitoRepositories } from '../../infrastructure/persistence/db/index.js';

const FALLBACK_PROVIDER: Provider = 'opencode';
const FALLBACK_MODEL = 'minimax-m2.7';
const DEFAULT_RULES_FILE = 'AGENTS.md';
const DEFAULT_EXECUTION_AGENT = 'opencode';
const DEFAULT_BRANCH = process.env.RALPHITO_DEFAULT_BRANCH?.trim() || 'master';

const PROJECT_ALIASES: Record<string, string> = {
  'backend-team': 'system',
  'frontend-team': 'system',
  'devops-team': 'system',
};

const PROJECT_AGENT_ALIASES: Record<string, string> = {
  'backend-team': 'default',
  'frontend-team': 'default',
  'devops-team': 'default',
};

export interface EngineProjectConfig {
  id: string;
  name: string;
  canonicalId: string;
  aliases: string[];
  sessionPrefix: string;
  path: string;
  worktreeRoot: string;
  defaultBranch: string;
  agentRulesFile: string | null;
  agent: ExecutionHarness;
  provider: Provider | null;
  model: string | null;
  providerProfile?: string;
  toolMode: ToolMode;
  allowedTools: string[];
  fallbacks: AgentFallbackRoute[];
}

function normalizeProjectId(projectId: string) {
  return projectId.trim().toLowerCase();
}

function deriveSessionPrefix(projectId: string) {
  const compact = projectId.replace(/[^a-z0-9]/gi, '');
  return (compact.slice(0, 2) || 'ag').toLowerCase();
}

function resolveRepoRoot() {
  const configured = process.env.RALPHITO_REPO_ROOT?.trim();
  return path.resolve(configured || process.cwd());
}

function resolveRalphitoHomeRoot() {
  const configured = process.env.RALPHITO_HOME?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), DEFAULT_RALPHITO_HOME_DIRNAME);
}

function resolveBaseWorktreeRoot() {
  const configured = process.env.RALPHITO_WORKTREE_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveRalphitoHomeRoot(), ENGINE_WORKTREE_ROOT);
}

function listAliasesFor(canonicalId: string) {
  return Object.entries(PROJECT_ALIASES)
    .filter(([, target]) => target === canonicalId)
    .map(([alias]) => alias);
}

function safeResolveProjectRow(canonicalId: string) {
  try {
    return getRalphitoRepositories().projects.getById(canonicalId);
  } catch {
    return null;
  }
}

function safeResolveAgentRow(agentConfigId: string) {
  try {
    return AgentRegistryService.getById(agentConfigId);
  } catch {
    return null;
  }
}

function safeResolveAgentConfig(agentConfigId: string) {
  try {
    return AgentRegistryService.getAgentConfig(agentConfigId);
  } catch {
    return null;
  }
}

export class ProjectService {
  static resolve(projectId: string): EngineProjectConfig {
    const normalizedId = normalizeProjectId(projectId);
    const canonicalId = PROJECT_ALIASES[normalizedId] || normalizedId;
    const agentConfigId = PROJECT_AGENT_ALIASES[normalizedId] || canonicalId;
    const project = safeResolveProjectRow(canonicalId);
    const agentRecord = safeResolveAgentRow(agentConfigId);
    const agentConfig = safeResolveAgentConfig(agentConfigId);
    const repoRoot = project?.repoPath || resolveRepoRoot();
    const worktreeRoot = project?.worktreeRoot || resolveBaseWorktreeRoot();
    const defaultBranch = project?.defaultBranch || DEFAULT_BRANCH;
    const agentRulesFile = project?.agentRulesFile || DEFAULT_RULES_FILE;

    if (!agentRecord || !agentConfig) {
      return {
        id: normalizedId,
        name: project?.name || projectId,
        canonicalId,
        aliases: listAliasesFor(canonicalId),
        sessionPrefix: deriveSessionPrefix(normalizedId),
        path: repoRoot,
        worktreeRoot,
        defaultBranch,
        agentRulesFile,
        agent: DEFAULT_EXECUTION_AGENT,
        provider: FALLBACK_PROVIDER,
        model: FALLBACK_MODEL,
        toolMode: 'none',
        allowedTools: [],
        fallbacks: [],
      };
    }

    return {
      id: normalizedId,
      name: normalizedId === canonicalId ? (project?.name || agentRecord.name) : projectId,
      canonicalId,
      aliases: listAliasesFor(canonicalId),
      sessionPrefix: agentRecord.session_prefix || deriveSessionPrefix(canonicalId),
      path: repoRoot,
      worktreeRoot,
      defaultBranch,
      agentRulesFile,
      agent: agentConfig.executionHarness || DEFAULT_EXECUTION_AGENT,
      provider: agentConfig.primaryProvider || FALLBACK_PROVIDER,
      model: agentConfig.model || FALLBACK_MODEL,
      ...(agentConfig.providerProfile ? { providerProfile: agentConfig.providerProfile } : {}),
      toolMode: agentConfig.toolMode || 'none',
      allowedTools: agentConfig.allowedTools || [],
      fallbacks: agentConfig.fallbacks || [],
    };
  }

  static resolveWorktreePath(projectId: string, runtimeSessionId: string) {
    return path.join(this.resolve(projectId).worktreeRoot, runtimeSessionId);
  }
}
