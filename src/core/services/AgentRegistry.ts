import * as fs from 'fs';
import * as path from 'path';
import type { AgentConfig, AgentFallbackRoute, Provider, ToolMode } from '../domain/gateway.types.js';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';

export interface AgentRegistryRecord {
  agent_id: string;
  name: string;
  role_file_path: string;
  session_prefix: string;
  provider: string | null;
  model: string | null;
  tool_mode: string;
  allowed_tools_json: string | null;
  primary_provider: string | null;
  provider_profile: string | null;
  fallbacks_json: string | null;
  capabilities_json: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface AgentSeedProfile {
  name: string;
  roleFilePath: string | null;
  sessionPrefix: string;
  primaryProvider: Provider;
  model: string;
  providerProfile?: string;
  toolMode: ToolMode;
  allowedTools: string[];
  fallbacks: AgentFallbackRoute[];
}

const DEFAULT_PROVIDER: Provider = 'gemini';
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

const AGENT_SEED_PROFILES: Record<string, Omit<AgentSeedProfile, 'name' | 'roleFilePath' | 'sessionPrefix'>> = {
  default: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: [
      'execute_bash',
      'read_file_raw',
      'write_file_raw',
      'read_workspace_file',
      'inspect_workspace_path',
      'git_status',
      'git_diff',
      'git_add',
      'git_commit',
      'finish_task',
    ],
    fallbacks: [],
  },
  ralphito: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: [
      'execute_bash',
      'read_file_raw',
      'write_file_raw',
      'read_workspace_file',
      'inspect_workspace_path',
      'git_status',
      'git_diff',
      'git_add',
      'git_commit',
      'finish_task',
    ],
    fallbacks: [],
  },
  raymon: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: [
      'spawn_executor',
      'check_status',
      'resume_executor',
      'run_divergence_phase',
      'summon_agent_to_chat',
      'cancel_executor',
      'cleanup_zombies',
      'read_workspace_file',
      'inspect_workspace_path',
    ],
    fallbacks: [],
  },
  moncho: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: ['write_spec_document', 'inspect_workspace_path'],
    fallbacks: [],
  },
  poncho: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: [
      'read_workspace_file',
      'write_spec_document',
      'write_bead_document',
      'inspect_workspace_path',
    ],
    fallbacks: [],
  },
  lola: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: ['write_spec_document', 'inspect_workspace_path'],
    fallbacks: [],
  },
  mapito: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: ['write_spec_document', 'inspect_workspace_path'],
    fallbacks: [],
  },
  martapepis: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'allowed',
    allowedTools: ['write_spec_document', 'inspect_workspace_path'],
    fallbacks: [],
  },
  juez: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  },
  tracker: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  },
  ricky: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  },
  miron: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  },
  relleno: {
    primaryProvider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  },
};

function normalizeAgentId(value: string) {
  return value.trim().toLowerCase();
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function buildSeedProfile(agentId: string, name: string, roleFilePath: string | null): AgentSeedProfile {
  const normalizedAgentId = normalizeAgentId(agentId);
  const preset = AGENT_SEED_PROFILES[normalizedAgentId];
  const sessionPrefix = normalizedAgentId.slice(0, 2) || 'ag';

  return {
    name,
    roleFilePath,
    sessionPrefix,
    primaryProvider: preset?.primaryProvider || DEFAULT_PROVIDER,
    model: preset?.model || DEFAULT_MODEL,
    toolMode: preset?.toolMode || 'none',
    allowedTools: preset?.allowedTools || [],
    fallbacks: preset?.fallbacks || [],
  };
}

function recordToAgentConfig(record: AgentRegistryRecord): AgentConfig {
  const primaryProvider = (record.primary_provider || record.provider || DEFAULT_PROVIDER) as Provider;

  return {
    agentId: record.agent_id,
    primaryProvider,
    model: record.model || DEFAULT_MODEL,
    ...(record.provider_profile ? { providerProfile: record.provider_profile } : {}),
    fallbacks: safeJsonParse(record.fallbacks_json, [] as AgentFallbackRoute[]),
    toolMode: (record.tool_mode as ToolMode) || 'none',
    allowedTools: safeJsonParse(record.allowed_tools_json, [] as string[]),
  };
}

export class AgentRegistryService {
  private static ROLES_PATH = path.join(process.cwd(), 'src', 'core', 'prompt', 'roles');

  /**
   * Scans the roles directory and syncs with the database.
   */
  static sync() {
    console.log(`[AgentRegistryService] Scanning roles in ${this.ROLES_PATH}...`);
    
    if (!fs.existsSync(this.ROLES_PATH)) {
      console.warn(`[AgentRegistryService] Roles path does not exist: ${this.ROLES_PATH}`);
      return;
    }

    const files = fs.readdirSync(this.ROLES_PATH).filter((f) => f.endsWith('.md'));
    const db = getRalphitoDatabase();

    const now = new Date().toISOString();

    const upsert = db.prepare(`
      INSERT INTO agent_registry (
        agent_id,
        name,
        role_file_path,
        session_prefix,
        provider,
        model,
        tool_mode,
        allowed_tools_json,
        primary_provider,
        provider_profile,
        fallbacks_json,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name,
        role_file_path = excluded.role_file_path,
        session_prefix = excluded.session_prefix,
        provider = COALESCE(agent_registry.provider, excluded.provider),
        model = COALESCE(agent_registry.model, excluded.model),
        tool_mode = CASE
          WHEN agent_registry.tool_mode IS NULL OR agent_registry.tool_mode = '' OR agent_registry.tool_mode = 'none'
            THEN excluded.tool_mode
          ELSE agent_registry.tool_mode
        END,
        allowed_tools_json = CASE
          WHEN agent_registry.allowed_tools_json IS NULL OR agent_registry.allowed_tools_json = ''
            THEN excluded.allowed_tools_json
          ELSE agent_registry.allowed_tools_json
        END,
        primary_provider = COALESCE(agent_registry.primary_provider, excluded.primary_provider),
        provider_profile = COALESCE(agent_registry.provider_profile, excluded.provider_profile),
        fallbacks_json = COALESCE(agent_registry.fallbacks_json, excluded.fallbacks_json),
        is_active = 1,
        updated_at = excluded.updated_at
    `);

    for (const file of files) {
      const match = file.match(/\(([^)]+)\)/);
      const name = match?.[1] || file.replace('.md', '');
      const agentId = normalizeAgentId(name);
      const roleFilePath = path.join('src', 'core', 'prompt', 'roles', file);
      const seed = buildSeedProfile(agentId, name, roleFilePath);

      upsert.run(
        agentId,
        seed.name,
        seed.roleFilePath,
        seed.sessionPrefix,
        seed.primaryProvider,
        seed.model,
        seed.toolMode,
        JSON.stringify(seed.allowedTools),
        seed.primaryProvider,
        seed.providerProfile || null,
        JSON.stringify(seed.fallbacks),
        now,
        now,
      );
    }

    const defaultRolePath = path.join('src', 'core', 'prompt', 'roles', 'ProjectPlanner(Raymon).md');
    const defaultSeed = buildSeedProfile('default', 'default', defaultRolePath);
    upsert.run(
      'default',
      defaultSeed.name,
      defaultSeed.roleFilePath,
      defaultSeed.sessionPrefix,
      defaultSeed.primaryProvider,
      defaultSeed.model,
      defaultSeed.toolMode,
      JSON.stringify(defaultSeed.allowedTools),
      defaultSeed.primaryProvider,
      defaultSeed.providerProfile || null,
      JSON.stringify(defaultSeed.fallbacks),
      now,
      now,
    );

    const dbAgents = db.prepare('SELECT agent_id, role_file_path FROM agent_registry WHERE is_active = 1').all() as any[];
    for (const agent of dbAgents) {
      if (!agent.role_file_path) continue;
      const fullPath = path.join(process.cwd(), agent.role_file_path);
      if (!fs.existsSync(fullPath)) {
        db.prepare('UPDATE agent_registry SET is_active = 0, updated_at = ? WHERE agent_id = ?').run(now, agent.agent_id);
        console.log(`[AgentRegistryService] Deactivated agent (file missing): ${agent.agent_id}`);
      }
    }
  }

  static getAllActive(): AgentRegistryRecord[] {
    const db = getRalphitoDatabase();
    return db.prepare('SELECT * FROM agent_registry WHERE is_active = 1').all() as AgentRegistryRecord[];
  }

  static getById(agentId: string): AgentRegistryRecord | undefined {
    const db = getRalphitoDatabase();
    const id = normalizeAgentId(agentId);
    return db.prepare('SELECT * FROM agent_registry WHERE agent_id = ?').get(id) as AgentRegistryRecord;
  }

  static getAgentConfig(agentId: string): AgentConfig | undefined {
    const record = this.getById(agentId);
    return record ? recordToAgentConfig(record) : undefined;
  }

  static updateAgentConfig(agentId: string, config: Partial<AgentRegistryRecord>) {
    const db = getRalphitoDatabase();
    const id = normalizeAgentId(agentId);
    const now = new Date().toISOString();

    const fields = Object.keys(config).filter(k => k !== 'agent_id' && k !== 'created_at' && k !== 'updated_at');
    if (fields.length === 0) return;

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (config as any)[f]);
    values.push(now, id);

    db.prepare(`UPDATE agent_registry SET ${sets}, updated_at = ? WHERE agent_id = ?`).run(...values);
  }
}
