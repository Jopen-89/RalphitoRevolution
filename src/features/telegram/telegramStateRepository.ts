import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { getRalphitoDatabase } from '../persistence/db/index.js';

interface LegacyConversationEntry {
  sessionId: string;
  updatedAt: string;
}

interface LegacyActiveAgentEntry {
  agentId: string;
  updatedAt: string;
}

interface LegacyRecentMessageEntry {
  fingerprint: string;
  updatedAt: string;
}

interface LegacyChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

interface LegacyTelegramConversationState {
  conversations: Record<string, LegacyConversationEntry>;
  messageRoutes: Record<string, Record<string, string>>;
  activeAgents: Record<string, LegacyActiveAgentEntry>;
  recentMessages: Record<string, LegacyRecentMessageEntry>;
  chatHistories?: Record<string, LegacyChatMessage[]>;
}

interface ThreadRow {
  id: number;
}

interface ActiveAgentRow {
  agentId: string;
  updatedAt: string;
}

interface FingerprintRow {
  fingerprint: string;
  updatedAt: string;
}

interface SessionBindingRow {
  runtimeSessionId: string;
}

interface HistoryRow {
  senderName: string | null;
  rawText: string;
}

interface CountRow {
  count: number;
}

export interface AddHistoryMessageInput {
  externalMessageId?: string;
  senderType?: string;
  senderId?: string;
  senderName?: string;
  role?: string;
  createdAt?: string;
}

const TELEGRAM_CHANNEL = 'telegram';
const LEGACY_STATE_PATH = path.join(process.cwd(), 'ops', 'runtime', 'telegram', 'state.json');
const MAX_MESSAGE_ROUTES = 100;
const MAX_FINGERPRINTS = 300;
const RECENT_HISTORY_LIMIT = 10;

let legacyStateImported = false;

function normalizeText(text: string) {
  return text.replace(/\r\n/g, '\n').trim();
}

function parseLegacyState(): LegacyTelegramConversationState | null {
  if (!existsSync(LEGACY_STATE_PATH)) return null;

  try {
    return JSON.parse(readFileSync(LEGACY_STATE_PATH, 'utf8')) as LegacyTelegramConversationState;
  } catch {
    return null;
  }
}

function inferSenderType(sender: string) {
  return sender.toLowerCase() === 'usuario' ? 'user' : 'agent';
}

export class TelegramStateRepository {
  private readonly db = getRalphitoDatabase();

  importLegacyStateIfNeeded() {
    if (legacyStateImported) return;

    legacyStateImported = true;

    const hasTelegramThreads = (this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM threads WHERE channel = ?',
      )
      .get(TELEGRAM_CHANNEL) as CountRow).count > 0;

    if (hasTelegramThreads) return;

    const legacyState = parseLegacyState();
    if (!legacyState) return;

    const importTransaction = this.db.transaction(() => {
      for (const [chatId, history] of Object.entries(legacyState.chatHistories || {})) {
        for (const entry of history) {
          this.addMessageToHistory(chatId, entry.sender, entry.text, {
            createdAt: new Date(entry.timestamp).toISOString(),
            senderType: inferSenderType(entry.sender),
            senderName: entry.sender,
            role: inferSenderType(entry.sender) === 'user' ? 'user' : 'assistant',
          });
        }
      }

      for (const [conversationKey, entry] of Object.entries(legacyState.conversations || {})) {
        const separatorIndex = conversationKey.lastIndexOf(':');
        if (separatorIndex === -1) continue;

        const chatId = conversationKey.slice(0, separatorIndex);
        const agentId = conversationKey.slice(separatorIndex + 1);
        this.setConversationSessionId(chatId, agentId, entry.sessionId, entry.updatedAt);
      }

      for (const [chatId, routes] of Object.entries(legacyState.messageRoutes || {})) {
        for (const [messageId, agentId] of Object.entries(routes)) {
          this.setMessageAgentRoute(chatId, Number(messageId), agentId);
        }
      }

      for (const [chatId, entry] of Object.entries(legacyState.activeAgents || {})) {
        this.setActiveAgent(chatId, entry.agentId, entry.updatedAt);
      }

      for (const [key, entry] of Object.entries(legacyState.recentMessages || {})) {
        const separatorIndex = key.lastIndexOf(':');
        if (separatorIndex === -1) continue;

        const chatId = key.slice(0, separatorIndex);
        const userId = key.slice(separatorIndex + 1);
        this.rememberRecentMessage(chatId, userId, entry.fingerprint, entry.updatedAt);
      }
    });

    importTransaction();
  }

  getConversationSessionId(chatId: string, agentId: string) {
    const threadId = this.getThreadId(chatId);
    if (!threadId) return null;

    const row = this.db
      .prepare(
        `
          SELECT runtime_session_id AS runtimeSessionId
          FROM agent_sessions
          WHERE thread_id = ? AND agent_id = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(threadId, agentId) as SessionBindingRow | undefined;

    return row?.runtimeSessionId || null;
  }

  setConversationSessionId(chatId: string, agentId: string, sessionId: string, baseCommitHash?: string, updatedAt?: string) {
    const threadId = this.ensureThread(chatId);
    const timestamp = updatedAt || new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO agent_sessions (
            thread_id,
            agent_id,
            runtime_session_id,
            status,
            base_commit_hash,
            started_at,
            heartbeat_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(runtime_session_id)
          DO UPDATE SET
            thread_id = excluded.thread_id,
            agent_id = excluded.agent_id,
            runtime_session_id = excluded.runtime_session_id,
            status = excluded.status,
            base_commit_hash = excluded.base_commit_hash,
            started_at = excluded.started_at,
            heartbeat_at = excluded.heartbeat_at,
            finished_at = NULL,
            failure_kind = NULL,
            failure_summary = NULL,
            failure_log_tail = NULL,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(threadId, agentId, sessionId, 'running', baseCommitHash || null, timestamp, timestamp, timestamp, timestamp);
  }

  setMessageAgentRoute(chatId: string, messageId: number, agentId: string, updatedAt?: string) {
    const threadId = this.ensureThread(chatId);
    const timestamp = updatedAt || new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO message_routes (thread_id, message_id, agent_id, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(thread_id, message_id)
          DO UPDATE SET
            agent_id = excluded.agent_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(threadId, messageId, agentId, timestamp);

    this.db.prepare(
      `
        DELETE FROM message_routes
        WHERE thread_id = ?
          AND id NOT IN (
            SELECT id FROM message_routes WHERE thread_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
          )
      `,
    ).run(threadId, threadId, MAX_MESSAGE_ROUTES);
  }

  getAgentRouteForMessage(chatId: string, messageId: number) {
    const threadId = this.getThreadId(chatId);
    if (!threadId) return null;

    const row = this.db
      .prepare('SELECT agent_id AS agentId FROM message_routes WHERE thread_id = ? AND message_id = ?')
      .get(threadId, messageId) as { agentId: string } | undefined;

    return row?.agentId || null;
  }

  setActiveAgent(chatId: string, agentId: string, updatedAt?: string) {
    const threadId = this.ensureThread(chatId);
    const timestamp = updatedAt || new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO active_agents (thread_id, agent_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(thread_id)
          DO UPDATE SET
            agent_id = excluded.agent_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(threadId, agentId, timestamp);
  }

  getRecentActiveAgent(chatId: string, maxAgeMs: number) {
    const threadId = this.getThreadId(chatId);
    if (!threadId) return null;

    const row = this.db
      .prepare('SELECT agent_id AS agentId, updated_at AS updatedAt FROM active_agents WHERE thread_id = ?')
      .get(threadId) as ActiveAgentRow | undefined;

    if (!row) return null;

    const updatedAt = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedAt)) return null;
    if (Date.now() - updatedAt > maxAgeMs) return null;

    return row.agentId;
  }

  rememberRecentMessage(chatId: string, userId: string, fingerprint: string, updatedAt?: string) {
    const threadId = this.ensureThread(chatId);
    const timestamp = updatedAt || new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO message_fingerprints (thread_id, user_id, fingerprint, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(thread_id, user_id)
          DO UPDATE SET
            fingerprint = excluded.fingerprint,
            updated_at = excluded.updated_at
        `,
      )
      .run(threadId, userId, fingerprint, timestamp);

    this.db.prepare(
      `
        DELETE FROM message_fingerprints
        WHERE id NOT IN (
          SELECT id FROM message_fingerprints ORDER BY updated_at DESC, id DESC LIMIT ?
        )
      `,
    ).run(MAX_FINGERPRINTS);
  }

  isRecentDuplicateMessage(chatId: string, userId: string, fingerprint: string, maxAgeMs: number) {
    const threadId = this.getThreadId(chatId);
    if (!threadId) return false;

    const row = this.db
      .prepare(
        'SELECT fingerprint, updated_at AS updatedAt FROM message_fingerprints WHERE thread_id = ? AND user_id = ?',
      )
      .get(threadId, userId) as FingerprintRow | undefined;

    if (!row) return false;
    if (row.fingerprint !== fingerprint) return false;

    const updatedAt = Date.parse(row.updatedAt);
    if (!Number.isFinite(updatedAt)) return false;

    return Date.now() - updatedAt <= maxAgeMs;
  }

  addMessageToHistory(chatId: string, sender: string, text: string, input: AddHistoryMessageInput = {}) {
    if (!text.trim()) return;

    const threadId = this.ensureThread(chatId);
    const normalizedText = normalizeText(text);
    const senderType = input.senderType || inferSenderType(sender);
    const senderName = input.senderName || sender;
    const role = input.role || (senderType === 'user' ? 'user' : 'assistant');
    const createdAt = input.createdAt || new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO messages (
            thread_id,
            external_message_id,
            sender_type,
            sender_id,
            sender_name,
            role,
            raw_text,
            normalized_text,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        threadId,
        input.externalMessageId || null,
        senderType,
        input.senderId || null,
        senderName,
        role,
        text,
        normalizedText,
        null,
        createdAt,
      );
  }

  getRecentChatHistory(chatId: string) {
    const threadId = this.getThreadId(chatId);
    if (!threadId) return '';

    const rows = this.db
      .prepare(
        `
          SELECT sender_name AS senderName, raw_text AS rawText
          FROM messages
          WHERE thread_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(threadId, RECENT_HISTORY_LIMIT) as HistoryRow[];

    return rows
      .reverse()
      .map((row) => `${row.senderName || 'Sistema'}: ${row.rawText}`)
      .join('\n');
  }

  private ensureThread(chatId: string) {
    const existingThreadId = this.getThreadId(chatId);
    if (existingThreadId) return existingThreadId;

    this.db
      .prepare(
        'INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(TELEGRAM_CHANNEL, chatId, null, new Date().toISOString(), new Date().toISOString());

    return this.getThreadId(chatId)!;
  }

  private getThreadId(chatId: string) {
    const row = this.db
      .prepare('SELECT id FROM threads WHERE channel = ? AND external_chat_id = ?')
      .get(TELEGRAM_CHANNEL, chatId) as ThreadRow | undefined;

    return row?.id || null;
  }
}

let repository: TelegramStateRepository | null = null;

export function getTelegramStateRepository() {
  if (repository) return repository;

  repository = new TelegramStateRepository();
  repository.importLegacyStateIfNeeded();

  return repository;
}
