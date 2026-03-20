import { getSessionRepository, type AddHistoryMessageInput } from './persistence/sessionRepository.js';

function getRepository() {
  return getSessionRepository();
}

export function getConversationSessionId(chatId: string, agentId: string) {
  return getRepository().getConversationSessionId(chatId, agentId);
}

export function setConversationSessionId(chatId: string, agentId: string, sessionId: string) {
  getRepository().setConversationSessionId(chatId, agentId, sessionId);
}

export function setMessageAgentRoute(chatId: string, messageId: number, agentId: string) {
  getRepository().setMessageAgentRoute(chatId, messageId, agentId);
}

export function getAgentRouteForMessage(chatId: string, messageId: number) {
  return getRepository().getAgentRouteForMessage(chatId, messageId);
}

export function setActiveAgent(chatId: string, agentId: string) {
  getRepository().setActiveAgent(chatId, agentId);
}

export function getRecentActiveAgent(chatId: string, maxAgeMs: number) {
  return getRepository().getRecentActiveAgent(chatId, maxAgeMs);
}

export function rememberRecentMessage(chatId: string, userId: string, fingerprint: string) {
  getRepository().rememberRecentMessage(chatId, userId, fingerprint);
}

export function isRecentDuplicateMessage(chatId: string, userId: string, fingerprint: string, maxAgeMs: number) {
  return getRepository().isRecentDuplicateMessage(chatId, userId, fingerprint, maxAgeMs);
}

export function addMessageToHistory(chatId: string, sender: string, text: string, input?: AddHistoryMessageInput) {
  getRepository().addMessageToHistory(chatId, sender, text, input);
}

export function getRecentChatHistory(chatId: string) {
  return getRepository().getRecentChatHistory(chatId);
}
