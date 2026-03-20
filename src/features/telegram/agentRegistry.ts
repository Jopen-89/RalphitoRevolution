import * as fs from 'fs';
import * as path from 'path';

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  rolePath: string;
  aliases: string[];
}

export interface AgentRoutingMatch {
  agent: AgentInfo;
  instruction: string;
}

export interface AgentMentionAnalysis {
  matches: AgentInfo[];
  leadingMatch: AgentRoutingMatch | null;
}

const AGENT_METADATA: Record<string, string> = {
  raymon: 'Agent Orchestrator',
  moncho: 'Feature PM',
  juez: 'Code Reviewer',
  ricky: 'Pre-Flight QA',
  miron: 'Visual QA',
  mapito: 'Security Auditor',
  poncho: 'Technical Architect',
  tracker: 'Error Learning Analyst',
};

function buildAliases(name: string, id: string) {
  return Array.from(new Set([id, name.toLowerCase()]));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLeadingText(text: string) {
  return text.trim().replace(/^[@¡!?,.\-\s]+/, '');
}

function stripVocativePrefix(text: string) {
  return text.replace(/^(?:oye|hey|hola|buenas|ey)\b[,:\s-]*/i, '').trim();
}

function buildAliasesPattern(agent: AgentInfo) {
  return agent.aliases.map((alias) => escapeRegex(alias)).join('|');
}

function startsWithAgentAlias(text: string, aliasesPattern: string) {
  const variants = [text, normalizeLeadingText(text), stripVocativePrefix(normalizeLeadingText(text))];

  for (const variant of variants) {
    const fullNameRegex = new RegExp(`^(?:${aliasesPattern})$`, 'i');
    if (fullNameRegex.test(variant)) {
      return { instruction: '' };
    }

    const namedRegex = new RegExp(`^(?:${aliasesPattern})(?:[,!?:\\s-]+)(.+)$`, 'i');
    const match = variant.match(namedRegex);
    if (match?.[1]) {
      return { instruction: match[1].trim() };
    }
  }

  return null;
}

export function loadAgentRegistry(): AgentInfo[] {
  const rolesPath = path.join(process.cwd(), 'agents', 'roles');

  try {
    return fs
      .readdirSync(rolesPath)
      .filter((file) => file.endsWith('.md'))
      .map((file) => {
        const match = file.match(/\(([^)]+)\)/);
        const name = match?.[1] ?? file.replace('.md', '');
        const id = name.toLowerCase();

        return {
          id,
          name,
          role: AGENT_METADATA[id] || 'Agente',
          rolePath: path.join(rolesPath, file),
          aliases: buildAliases(name, id),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function getAgentById(agents: AgentInfo[], agentId: string) {
  return agents.find((agent) => agent.id === agentId);
}

export function analyzeAgentMentions(agents: AgentInfo[], text: string): AgentMentionAnalysis {
  const trimmedText = text.trim();
  const matches: AgentInfo[] = [];
  let leadingMatch: AgentRoutingMatch | null = null;

  for (const agent of agents) {
    const aliasesPattern = buildAliasesPattern(agent);
    const mentionRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])(?:${aliasesPattern})(?=$|[^\\p{L}\\p{N}_])`, 'iu');

    if (mentionRegex.test(trimmedText)) {
      matches.push(agent);
    }

    if (!leadingMatch) {
      const leading = startsWithAgentAlias(trimmedText, aliasesPattern);
      if (leading) {
        leadingMatch = {
          agent,
          instruction: leading.instruction,
        };
      }
    }
  }

  return {
    matches,
    leadingMatch,
  };
}

export function resolveAgentByLeadingName(agents: AgentInfo[], text: string) {
  return analyzeAgentMentions(agents, text).leadingMatch;
}

export function extractMultiAgentInstruction(agents: AgentInfo[], text: string) {
  let remaining = stripVocativePrefix(normalizeLeadingText(text));

  const leadingNames = agents
    .slice()
    .sort((a, b) => b.name.length - a.name.length)
    .map((agent) => `(?:${buildAliasesPattern(agent)})`)
    .join('|');

  const leadingGroupRegex = new RegExp(
    `^(?:${leadingNames})(?:\\s*(?:y|,|&|e)\\s*(?:${leadingNames}))*[,:!?.\\s-]*`,
    'iu',
  );

  remaining = remaining.replace(leadingGroupRegex, '').trim();
  return remaining;
}
