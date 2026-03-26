import type {
  AddHistoryMessageInput,
  ConversationSessionContext,
  SetConversationSessionInput,
} from '../telegramStateRepository.js';
import { getTelegramStateRepository } from '../telegramStateRepository.js';

export interface SessionRepository {
  getThreadId(chatId: string): number | null;
  getConversationSessionContext(chatId: string, agentId: string): ConversationSessionContext | null;
  getConversationSessionId(chatId: string, agentId: string): string | null;
  setConversationSessionId(chatId: string, agentId: string, input: SetConversationSessionInput): void;
  setMessageAgentRoute(chatId: string, messageId: number, agentId: string, updatedAt?: string): void;
  getAgentRouteForMessage(chatId: string, messageId: number): string | null;
  setActiveAgent(chatId: string, agentId: string, updatedAt?: string): void;
  getRecentActiveAgent(chatId: string, maxAgeMs: number): string | null;
  rememberRecentMessage(chatId: string, userId: string, fingerprint: string, updatedAt?: string): void;
  isRecentDuplicateMessage(chatId: string, userId: string, fingerprint: string, maxAgeMs: number): boolean;
  addMessageToHistory(chatId: string, sender: string, text: string, input?: AddHistoryMessageInput): void;
  getRecentChatHistory(chatId: string): string;
}

export class SQLiteSessionRepository implements SessionRepository {
  private readonly repository = getTelegramStateRepository();

  getThreadId(chatId: string) {
    return this.repository.getThreadId(chatId);
  }

  getConversationSessionId(chatId: string, agentId: string) {
    return this.repository.getConversationSessionId(chatId, agentId);
  }

  getConversationSessionContext(chatId: string, agentId: string) {
    return this.repository.getConversationSessionContext(chatId, agentId);
  }

  setConversationSessionId(chatId: string, agentId: string, input: SetConversationSessionInput) {
    this.repository.setConversationSessionId(chatId, agentId, input);
  }

  setMessageAgentRoute(chatId: string, messageId: number, agentId: string, updatedAt?: string) {
    this.repository.setMessageAgentRoute(chatId, messageId, agentId, updatedAt);
  }

  getAgentRouteForMessage(chatId: string, messageId: number) {
    return this.repository.getAgentRouteForMessage(chatId, messageId);
  }

  setActiveAgent(chatId: string, agentId: string, updatedAt?: string) {
    this.repository.setActiveAgent(chatId, agentId, updatedAt);
  }

  getRecentActiveAgent(chatId: string, maxAgeMs: number) {
    return this.repository.getRecentActiveAgent(chatId, maxAgeMs);
  }

  rememberRecentMessage(chatId: string, userId: string, fingerprint: string, updatedAt?: string) {
    this.repository.rememberRecentMessage(chatId, userId, fingerprint, updatedAt);
  }

  isRecentDuplicateMessage(chatId: string, userId: string, fingerprint: string, maxAgeMs: number) {
    return this.repository.isRecentDuplicateMessage(chatId, userId, fingerprint, maxAgeMs);
  }

  addMessageToHistory(chatId: string, sender: string, text: string, input?: AddHistoryMessageInput) {
    this.repository.addMessageToHistory(chatId, sender, text, input);
  }

  getRecentChatHistory(chatId: string) {
    return this.repository.getRecentChatHistory(chatId);
  }
}

let sessionRepository: SessionRepository | null = null;

export function getSessionRepository(): SessionRepository {
  if (sessionRepository) return sessionRepository;

  sessionRepository = new SQLiteSessionRepository();
  return sessionRepository;
}

export function resetSessionRepository() {
  sessionRepository = null;
}

export type { AddHistoryMessageInput, ConversationSessionContext, SetConversationSessionInput };
