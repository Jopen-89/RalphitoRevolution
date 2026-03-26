import { getAgentById, type AgentInfo } from './agentRegistry.js';

export const ACTIVE_AGENT_WINDOW_MS = 15 * 60 * 1000;

export type TelegramRoutingDecision = {
  agent: AgentInfo;
  reason: 'reply' | 'active-agent' | 'raymon-entry' | 'explicit-raymon';
};

type ResolveTelegramRoutingInput = {
  agents: AgentInfo[];
  text: string;
  replyAgentId?: string | null | undefined;
  activeAgentId?: string | null | undefined;
};

export function resolveTelegramRouting(input: ResolveTelegramRoutingInput): TelegramRoutingDecision | null {
  const normalizedText = input.text.trim();
  if (!normalizedText) return null;

  const raymon = getAgentById(input.agents, 'raymon');
  if (!raymon) return null;

  const explicitRaymonPattern = new RegExp(`^(?:${[raymon.id, ...(raymon.aliases || [])]
    .map((alias) => alias.trim())
    .filter(Boolean)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?:\b|\s*[:,])`, 'i');
  if (explicitRaymonPattern.test(normalizedText)) {
    return { agent: raymon, reason: 'explicit-raymon' };
  }

  const replyAgent = input.replyAgentId ? getAgentById(input.agents, input.replyAgentId) : null;
  if (replyAgent) {
    return { agent: replyAgent, reason: 'reply' };
  }

  const activeAgent = input.activeAgentId ? getAgentById(input.agents, input.activeAgentId) : null;
  if (activeAgent) {
    return { agent: activeAgent, reason: 'active-agent' };
  }

  return { agent: raymon, reason: 'raymon-entry' };
}
