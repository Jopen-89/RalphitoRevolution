import * as fs from 'fs';
import * as path from 'path';

interface ConversationEntry {
  sessionId: string;
  updatedAt: string;
}

interface ActiveAgentEntry {
  agentId: string;
  updatedAt: string;
}

interface RecentMessageEntry {
  fingerprint: string;
  updatedAt: string;
}

interface TelegramConversationState {
  conversations: Record<string, ConversationEntry>;
  messageRoutes: Record<string, Record<string, string>>;
  activeAgents: Record<string, ActiveAgentEntry>;
  recentMessages: Record<string, RecentMessageEntry>;
}

const STATE_PATH = path.join(process.cwd(), 'ops', 'runtime', 'telegram', 'state.json');

function ensureStateDir() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
}

function readState(): TelegramConversationState {
  ensureStateDir();

  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TelegramConversationState>;

    return {
      conversations: parsed.conversations || {},
      messageRoutes: parsed.messageRoutes || {},
      activeAgents: parsed.activeAgents || {},
      recentMessages: parsed.recentMessages || {},
    };
  } catch {
    return {
      conversations: {},
      messageRoutes: {},
      activeAgents: {},
      recentMessages: {},
    };
  }
}

function writeState(state: TelegramConversationState) {
  ensureStateDir();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function buildConversationKey(chatId: string, agentId: string) {
  return `${chatId}:${agentId}`;
}

export function getConversationSessionId(chatId: string, agentId: string) {
  const state = readState();
  return state.conversations[buildConversationKey(chatId, agentId)]?.sessionId;
}

export function setConversationSessionId(chatId: string, agentId: string, sessionId: string) {
  const state = readState();
  state.conversations[buildConversationKey(chatId, agentId)] = {
    sessionId,
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

export function setMessageAgentRoute(chatId: string, messageId: number, agentId: string) {
  const state = readState();
  const chatRoutes = state.messageRoutes[chatId] || {};

  chatRoutes[String(messageId)] = agentId;
  state.messageRoutes[chatId] = Object.fromEntries(Object.entries(chatRoutes).slice(-100));

  writeState(state);
}

export function getAgentRouteForMessage(chatId: string, messageId: number) {
  const state = readState();
  return state.messageRoutes[chatId]?.[String(messageId)];
}

export function setActiveAgent(chatId: string, agentId: string) {
  const state = readState();
  state.activeAgents[chatId] = {
    agentId,
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
}

export function getRecentActiveAgent(chatId: string, maxAgeMs: number) {
  const state = readState();
  const activeAgent = state.activeAgents[chatId];

  if (!activeAgent) return null;

  const updatedAt = Date.parse(activeAgent.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  if (Date.now() - updatedAt > maxAgeMs) return null;

  return activeAgent.agentId;
}

export function rememberRecentMessage(chatId: string, userId: string, fingerprint: string) {
  const state = readState();
  const key = `${chatId}:${userId}`;
  state.recentMessages[key] = {
    fingerprint,
    updatedAt: new Date().toISOString(),
  };
  state.recentMessages = Object.fromEntries(Object.entries(state.recentMessages).slice(-300));
  writeState(state);
}

export function isRecentDuplicateMessage(chatId: string, userId: string, fingerprint: string, maxAgeMs: number) {
  const state = readState();
  const key = `${chatId}:${userId}`;
  const message = state.recentMessages[key];

  if (!message) return false;
  if (message.fingerprint !== fingerprint) return false;

  const updatedAt = Date.parse(message.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;

  return Date.now() - updatedAt <= maxAgeMs;
}
