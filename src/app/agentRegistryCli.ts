import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';
import { buildAgentConfigUpdates, serializeAgentRecord } from './agentConfigService.js';

function printJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseCsv(raw: string) {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCliFallbacks(raw: string) {
  return parseCsv(raw).map((entry) => {
    const colonIndex = entry.indexOf(':');
    if (colonIndex <= 0 || colonIndex === entry.length - 1) {
      throw new Error('fallbacks usa provider:model o provider:model@profile');
    }

    const provider = entry.slice(0, colonIndex).trim();
    const modelAndProfile = entry.slice(colonIndex + 1).trim();
    const atIndex = modelAndProfile.indexOf('@');
    const model = (atIndex >= 0 ? modelAndProfile.slice(0, atIndex) : modelAndProfile).trim();
    const providerProfile = (atIndex >= 0 ? modelAndProfile.slice(atIndex + 1) : '').trim();
    if (!provider || !model) {
      throw new Error('fallbacks usa provider:model o provider:model@profile');
    }

    return {
      provider,
      model,
      ...(providerProfile ? { providerProfile } : {}),
    };
  });
}

function parseBoolean(raw: string) {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error('isActive espera true|false');
}

export function buildCliUpdateBody(args: string[]) {
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('Uso: set <agentId> <field> <value> [field value]');
  }

  const body: Record<string, unknown> = {};
  for (let index = 0; index < args.length; index += 2) {
    const field = args[index];
    const value = args[index + 1];
    if (field === undefined || value === undefined) {
      throw new Error('Uso: set <agentId> <field> <value> [field value]');
    }

    switch (field) {
      case 'primaryProvider':
      case 'model':
      case 'executionHarness':
      case 'toolMode':
        body[field] = value;
        break;
      case 'providerProfile':
      case 'executionProfile':
        body[field] = value.trim().toLowerCase() === 'null' ? null : value;
        break;
      case 'allowedTools':
        body[field] = parseCsv(value);
        break;
      case 'fallbacks':
        body[field] = parseCliFallbacks(value);
        break;
      case 'isActive':
        body[field] = parseBoolean(value);
        break;
      default:
        throw new Error(`Campo no soportado: ${field}`);
    }
  }

  return body;
}

export function listAgentsForCli() {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return AgentRegistryService.getAllActive()
    .sort((a, b) => a.agent_id.localeCompare(b.agent_id))
    .map((record) => serializeAgentRecord(record, [record.agent_id]));
}

export function getAgentForCli(agentId: string) {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  const record = AgentRegistryService.getById(agentId);
  if (!record) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  return serializeAgentRecord(record, [record.agent_id]);
}

export function setAgentForCli(agentId: string, args: string[]) {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  const existing = AgentRegistryService.getById(agentId);
  if (!existing) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const body = buildCliUpdateBody(args);
  const result = buildAgentConfigUpdates(agentId, existing, body);
  if ('error' in result) {
    throw new Error('field' in result.error ? `${result.error.field}: ${result.error.error}` : result.error.error);
  }

  AgentRegistryService.updateAgentConfig(agentId, result.updates);
  const refreshed = AgentRegistryService.getById(agentId);
  if (!refreshed) {
    throw new Error(`Agent not found after update: ${agentId}`);
  }

  return {
    success: true,
    appliesTo: 'new_sessions_only',
    agent: serializeAgentRecord(refreshed, [refreshed.agent_id]),
  };
}

export async function runAgentRegistryCli(args: string[]) {
  const [command, target, ...rest] = args;

  switch (command) {
    case 'list':
      printJson({ agents: listAgentsForCli() });
      return;
    case 'get':
      if (!target) throw new Error('Uso: get <agentId>');
      printJson({ agent: getAgentForCli(target) });
      return;
    case 'set':
      if (!target) throw new Error('Uso: set <agentId> <field> <value> [field value]');
      printJson(setAgentForCli(target, rest));
      return;
    default:
      throw new Error('Uso: list | get <agentId> | set <agentId> <field> <value> [field value]');
  }
}
