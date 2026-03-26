import type { AgentInfo } from './agentRegistry.js';
import * as convStore from './conversationStore.js';
import { executeAgentTask } from './chatExecutor.js';
import { publishAgentReply } from './agentMessenger.js';
import { sanitizeTelegramVisibleText } from './telegramSender.js';

export interface AgentInvocationInitiator {
  id: string;
  name: string;
}

export interface AgentInvocationInput {
  chatId: string;
  agent: AgentInfo;
  instruction: string;
  statusMessageId: number;
  initiator?: AgentInvocationInitiator;
}

export interface AgentInvocationResult {
  response: string;
  sessionId?: string;
  handoffAgentId?: string;
}

interface AgentInvocationDeps {
  executeAgentTask: typeof executeAgentTask;
  publishAgentReply: typeof publishAgentReply;
}

const defaultDeps: AgentInvocationDeps = {
  executeAgentTask,
  publishAgentReply,
};

export async function invokeAgentInChatThread(
  input: AgentInvocationInput,
  deps: AgentInvocationDeps = defaultDeps,
): Promise<AgentInvocationResult> {
  if (input.initiator) {
    convStore.addMessageToHistory(input.chatId, input.initiator.name, input.instruction, {
      senderType: 'agent',
      senderId: input.initiator.id,
      senderName: input.initiator.name,
      role: 'assistant',
    });
  }

  const result = await deps.executeAgentTask(input.chatId, input.agent, input.instruction);
  const sanitizedResponse = sanitizeTelegramVisibleText(result.response);

  if (result.sessionId) {
    convStore.setConversationSessionId(input.chatId, input.agent.id, result.sessionId);
  }

  await deps.publishAgentReply(input.chatId, input.statusMessageId, input.agent, sanitizedResponse);

  if (result.handoffAgentId) {
    convStore.setActiveAgent(input.chatId, result.handoffAgentId);
  }

  return {
    ...result,
    response: sanitizedResponse,
  };
}
