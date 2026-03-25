import { mkdir } from 'fs/promises';
import path from 'path';
import {
  getEngineNotificationRepository,
  type EngineNotificationSummary,
} from '../../core/engine/engineNotifications.js';
import { getEngineSessionsStatus, type EngineStatusSession } from '../../core/engine/status.js';
import type { RuntimeSessionStatus } from '../../core/engine/runtimeSessionRepository.js';
import { getRalphitoDatabase, getRalphitoDatabasePath } from '../persistence/db/index.js';

interface EventCountRow {
  count: number;
}

interface RecentEventRow {
  id: number;
  eventType: string;
  status: string;
  payloadJson: string;
  createdAt: string;
}

interface CountRow {
  count: number;
}

interface StuckTaskRow {
  id: string;
  status: string;
  updatedAt: string;
  assignedAgent: string | null;
  runtimeSessionId: string | null;
}

export interface OperationalRecentEvent {
  id: number;
  eventType: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface OperationalCurrentSessions {
  totalRecent: number;
  active: number;
  alive: number;
  byStatus: Record<RuntimeSessionStatus, number>;
}

export interface OperationalNotificationBacklog {
  pending: number;
  delivering: number;
  pendingWithoutTarget: number;
  oldestOutstandingAt: string | null;
}

export interface OperationalHistoricalNotificationOutbox {
  total: number;
  delivered: number;
  failed: number;
  newestCreatedAt: string | null;
}

export interface OperationalHistoricalDebt {
  orphanSessions: number | null;
  stuckTaskCount: number;
  stuckTasks: StuckTaskRow[];
  notificationOutbox: OperationalHistoricalNotificationOutbox | null;
}

export interface OperationalStatus {
  health: {
    db: { ok: boolean; error?: string };
    engine: { ok: boolean; sessionCount?: number; error?: string };
    searchIndex: { ok: boolean; documentCount?: number; error?: string };
  };
  current: {
    sessions: OperationalCurrentSessions | null;
    notificationBacklog: OperationalNotificationBacklog | null;
  };
  historical: {
    retrieval: { failedQueries: number; averageRetrievalMs: number } | null;
    counters: { summaries: number } | null;
    debt: OperationalHistoricalDebt;
    recentEvents: OperationalRecentEvent[];
  };
  backup: {
    databasePath: string;
    backupDir: string;
  };
}

const BACKUP_DIR = path.join(process.cwd(), 'ops', 'runtime', 'backups', 'ralphito');
const STUCK_TASK_MAX_AGE_HOURS = 6;
const ACTIVE_RUNTIME_SESSION_STATUSES = ['queued', 'running', 'suspended_human_input'] as const satisfies RuntimeSessionStatus[];

export function recordSystemEvent(eventType: string, status: 'ok' | 'warn' | 'error', payload: Record<string, unknown>) {
  const db = getRalphitoDatabase();
  db.prepare(
    'INSERT INTO system_events (event_type, status, payload_json, created_at) VALUES (?, ?, ?, ?)',
  ).run(eventType, status, JSON.stringify(payload), new Date().toISOString());
}

function getFailedQueryCount() {
  const db = getRalphitoDatabase();
  return (
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM system_events
          WHERE event_type IN ('search_query', 'context_loader')
            AND status = 'error'
        `,
      )
      .get() as EventCountRow
  ).count;
}

function getAverageRetrievalMs() {
  const db = getRalphitoDatabase();
  const rows = db
    .prepare(
      `
        SELECT payload_json AS payloadJson
        FROM system_events
        WHERE event_type IN ('search_query', 'context_loader')
          AND status = 'ok'
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      `,
    )
    .all() as Array<{ payloadJson: string }>;

  if (rows.length === 0) return 0;

  const values = rows
    .map((row) => {
      try {
        const payload = JSON.parse(row.payloadJson) as { durationMs?: number };
        return typeof payload.durationMs === 'number' ? payload.durationMs : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is number => value !== null);

  if (values.length === 0) return 0;
  return Math.round(values.reduce((acc, value) => acc + value, 0) / values.length);
}

function createSessionStatusCounts(): Record<RuntimeSessionStatus, number> {
  return {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    stuck: 0,
    suspended_human_input: 0,
  };
}

function getCurrentSessions(runtimeSessions: EngineStatusSession[]) {
  const byStatus = createSessionStatusCounts();

  for (const session of runtimeSessions) {
    byStatus[session.status as RuntimeSessionStatus] += 1;
  }

  return {
    totalRecent: runtimeSessions.length,
    active: ACTIVE_RUNTIME_SESSION_STATUSES.reduce((count, status) => count + byStatus[status], 0),
    alive: runtimeSessions.filter((session) => session.alive).length,
    byStatus,
  } satisfies OperationalCurrentSessions;
}

function getNotificationBacklog(summary: EngineNotificationSummary) {
  return {
    pending: summary.pending,
    delivering: summary.delivering,
    pendingWithoutTarget: summary.pendingWithoutTarget,
    oldestOutstandingAt: summary.oldestOutstandingAt,
  } satisfies OperationalNotificationBacklog;
}

function getHistoricalNotificationOutbox(summary: EngineNotificationSummary) {
  return {
    total: summary.total,
    delivered: summary.delivered,
    failed: summary.failed,
    newestCreatedAt: summary.newestCreatedAt,
  } satisfies OperationalHistoricalNotificationOutbox;
}

async function getOrphanSessionCount(runtimeSessions: EngineStatusSession[]) {
  const db = getRalphitoDatabase();
  const activeSessionIds = new Set(runtimeSessions.filter((session) => session.alive).map((session) => session.id));
  const rows = db
    .prepare(
      `
        SELECT runtime_session_id AS runtimeSessionId
        FROM agent_sessions
        WHERE status IN (?, ?, ?)
      `,
    )
    .all(...ACTIVE_RUNTIME_SESSION_STATUSES) as Array<{ runtimeSessionId: string }>;

  return rows.filter((row) => row.runtimeSessionId && !activeSessionIds.has(row.runtimeSessionId)).length;
}

function getStuckTasks() {
  const db = getRalphitoDatabase();
  const threshold = new Date(Date.now() - STUCK_TASK_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `
        SELECT id, status, updated_at AS updatedAt, assigned_agent AS assignedAgent, runtime_session_id AS runtimeSessionId
        FROM tasks
        WHERE status IN ('pending', 'in_progress', 'blocked')
          AND updated_at < ?
        ORDER BY updated_at ASC, id ASC
      `,
    )
    .all(threshold) as StuckTaskRow[];
}

function getRecentEvents() {
  const db = getRalphitoDatabase();
  const rows = db
    .prepare(
      `
        SELECT id, event_type AS eventType, status, payload_json AS payloadJson, created_at AS createdAt
        FROM system_events
        ORDER BY created_at DESC, id DESC
        LIMIT 15
      `,
    )
    .all() as RecentEventRow[];

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    payload: JSON.parse(row.payloadJson),
    createdAt: row.createdAt,
  })) as OperationalRecentEvent[];
}

function getDocumentCount() {
  const db = getRalphitoDatabase();
  return (db.prepare('SELECT COUNT(*) AS count FROM documents').get() as CountRow).count;
}

function getSummaryCount() {
  const db = getRalphitoDatabase();
  return (db.prepare('SELECT COUNT(*) AS count FROM session_summaries').get() as CountRow).count;
}

export async function getOperationalStatus() {
  const db = getRalphitoDatabase();

  const dbHealth = (() => {
    try {
      db.prepare('SELECT 1').get();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })();

  if (!dbHealth.ok) {
    return {
      health: {
        db: dbHealth,
        engine: { ok: false, error: 'database unavailable' },
        searchIndex: { ok: false, error: 'database unavailable' },
      },
      current: {
        sessions: null,
        notificationBacklog: null,
      },
      historical: {
        retrieval: null,
        counters: null,
        debt: {
          orphanSessions: null,
          stuckTaskCount: 0,
          stuckTasks: [],
          notificationOutbox: null,
        },
        recentEvents: [],
      },
      backup: {
        databasePath: getRalphitoDatabasePath(),
        backupDir: BACKUP_DIR,
      },
    } satisfies OperationalStatus;
  }

  let runtimeSessions: EngineStatusSession[] | null = null;
  const engineHealth = await getEngineSessionsStatus()
    .then((sessions) => {
      runtimeSessions = sessions;
      return { ok: true, sessionCount: sessions.length } as const;
    })
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const stuckTasks = getStuckTasks();
  const notificationSummary = getEngineNotificationRepository().getSummary();
  const orphanSessions = runtimeSessions ? await getOrphanSessionCount(runtimeSessions) : null;

  return {
    health: {
      db: dbHealth,
      engine: engineHealth,
      searchIndex: { ok: true, documentCount: getDocumentCount() },
    },
    current: {
      sessions: runtimeSessions ? getCurrentSessions(runtimeSessions) : null,
      notificationBacklog: getNotificationBacklog(notificationSummary),
    },
    historical: {
      retrieval: {
        failedQueries: getFailedQueryCount(),
        averageRetrievalMs: getAverageRetrievalMs(),
      },
      counters: {
        summaries: getSummaryCount(),
      },
      debt: {
        orphanSessions,
        stuckTaskCount: stuckTasks.length,
        stuckTasks,
        notificationOutbox: getHistoricalNotificationOutbox(notificationSummary),
      },
      recentEvents: getRecentEvents(),
    },
    backup: {
      databasePath: getRalphitoDatabasePath(),
      backupDir: BACKUP_DIR,
    },
  } satisfies OperationalStatus;
}

export async function backupRalphitoDatabase() {
  const db = getRalphitoDatabase();
  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `ralphito-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(backupPath);
  recordSystemEvent('sqlite_backup', 'ok', { backupPath });
  return backupPath;
}
