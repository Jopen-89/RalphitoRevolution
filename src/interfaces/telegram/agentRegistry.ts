import path from 'path';
import { AgentRegistryService, type AgentRegistryRecord } from '../../core/services/AgentRegistry.js';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  rolePath: string;
  aliases: string[];
  provider?: string;
  model?: string;
  providerProfile?: string;
  toolMode?: string;
  allowedTools?: string[];
}

interface AgentMentionMatch {
  agent: AgentInfo;
  matchedText: string;
  index: number;
}

export interface AgentMentionAnalysis {
  matches: AgentInfo[];
  leadingMatch: {
    agent: AgentInfo;
    instruction: string;
  } | null;
}

const AGENT_ALIASES: Record<string, string[]> = {
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
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function humanizeRole(rawRole: string) {
  return rawRole
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function parseRoleStem(stem: string, rolePath: string, provider?: string | null, model?: string | null, providerProfile?: string | null, toolMode?: string | null, allowedTools?: string[] | null): AgentInfo | null {
  const match = stem.match(/^(.*?)\(([^)]+)\)$/);
  if (!match) return null;

  const rawRole = match[1];
  const rawName = match[2];
  if (!rawRole || !rawName) return null;
  const name = rawName.trim();
  const id = name.toLowerCase();
  const aliases = [...new Set([id, name.toLowerCase(), ...(AGENT_ALIASES[id] || [])])];

  return {
    id,
    name,
    role: humanizeRole(rawRole),
    rolePath,
    aliases,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(providerProfile ? { providerProfile } : {}),
    ...(toolMode ? { toolMode } : {}),
    ...(allowedTools ? { allowedTools } : {}),
  };
}

export function loadAgentRegistry(): AgentInfo[] {
  const activeAgents = AgentRegistryService.getAllActive();

  return activeAgents
    .filter((record) => record.agent_id !== 'default')
    .map((record: AgentRegistryRecord) => {
      const rolePath = path.join(process.cwd(), record.role_file_path);
      const stem = path.basename(record.role_file_path, '.md');
      const allowedTools = record.allowed_tools_json ? JSON.parse(record.allowed_tools_json) as string[] : [];

      return parseRoleStem(
        stem,
        rolePath,
        record.primary_provider || record.provider,
        record.model,
        record.provider_profile,
        record.tool_mode,
        allowedTools,
      );
    })
    .filter((agent): agent is AgentInfo => Boolean(agent))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAgentById(agents: AgentInfo[], agentId: string) {
  const normalized = agentId.trim().toLowerCase();
  return agents.find((agent) => agent.id === normalized) || null;
}

export function resolveAgentReference(agents: AgentInfo[], reference: string) {
  const normalized = reference.trim().toLowerCase();
  return agents.find((agent) => agent.aliases.includes(normalized) || agent.name.toLowerCase() === normalized) || null;
}

function findMentionMatches(agents: AgentInfo[], text: string): AgentMentionMatch[] {
  const normalizedText = text.toLowerCase();
  const matches: AgentMentionMatch[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    let bestIndex = -1;
    let bestAlias = '';

    for (const alias of agent.aliases) {
      const regex = new RegExp(`(^|[^a-z0-9_])(${escapeRegex(alias)})(?=$|[^a-z0-9_])`, 'i');
      const match = normalizedText.match(regex);
      if (!match || typeof match.index !== 'number') continue;
      const aliasIndex = match.index + (match[1]?.length || 0);
      if (bestIndex === -1 || aliasIndex < bestIndex) {
        bestIndex = aliasIndex;
        bestAlias = match[2] || alias;
      }
    }

    if (bestIndex === -1 || seen.has(agent.id)) continue;
    seen.add(agent.id);
    matches.push({ agent, matchedText: bestAlias, index: bestIndex });
  }

  return matches.sort((a, b) => a.index - b.index);
}

function buildLeadingMatch(matches: AgentMentionMatch[], text: string): AgentMentionAnalysis['leadingMatch'] {
  const first = matches[0];
  if (!first) return null;
  if (first.index > 0) return null;

  const consumed = text.slice(first.matchedText.length).replace(/^[\s,:;.-]+/, '');
  return {
    agent: first.agent,
    instruction: consumed.trim(),
  };
}

export function analyzeAgentMentions(agents: AgentInfo[], text: string): AgentMentionAnalysis {
  const matches = findMentionMatches(agents, text);

  return {
    matches: matches.map((match) => match.agent),
    leadingMatch: buildLeadingMatch(matches, text.trim()),
  };
}

export function extractMultiAgentInstruction(targetAgents: AgentInfo[], text: string) {
  let instruction = text;

  for (const agent of targetAgents) {
    for (const alias of agent.aliases) {
      instruction = instruction.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`, 'ig'), ' ');
    }
  }

  return instruction.replace(/[,:;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
