import { mkdir } from 'fs/promises';
import path from 'path';
import { getEngineNotificationRepository } from '../engine/engineNotifications.js';
import { getEngineSessionsStatus } from '../engine/status.js';
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

const BACKUP_DIR = path.join(process.cwd(), 'ops', 'runtime', 'backups', 'ralphito');
const STUCK_TASK_MAX_AGE_HOURS = 6;

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

async function getOrphanSessionCount() {
  const db = getRalphitoDatabase();
  const runtimeSessions = await getEngineSessionsStatus();
  const activeSessionIds = new Set(runtimeSessions.filter((session) => session.alive).map((session) => session.id));
  const rows = db
    .prepare(
      `
        SELECT runtime_session_id AS runtimeSessionId
        FROM agent_sessions
        WHERE status IN ('queued', 'running')
      `,
    )
    .all() as Array<{ runtimeSessionId: string }>;

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
  }));
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

  const engineHealth = await getEngineSessionsStatus()
    .then((sessions) => ({ ok: true, sessionCount: sessions.length }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const stuckTasks = getStuckTasks();
  const orphanSessions = await getOrphanSessionCount();
  const notificationSummary = getEngineNotificationRepository().getSummary();

  return {
    health: {
      db: dbHealth,
      engine: engineHealth,
      searchIndex: { ok: true, documentCount: getDocumentCount() },
    },
    metrics: {
      failedQueries: getFailedQueryCount(),
      averageRetrievalMs: getAverageRetrievalMs(),
      orphanSessions,
      stuckTasks: stuckTasks.length,
      summaries: getSummaryCount(),
      notificationOutbox: notificationSummary,
    },
    stuckTasks,
    recentEvents: getRecentEvents(),
    backup: {
      databasePath: getRalphitoDatabasePath(),
      backupDir: BACKUP_DIR,
    },
  };
}

export async function backupRalphitoDatabase() {
  const db = getRalphitoDatabase();
  await mkdir(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `ralphito-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(backupPath);
  recordSystemEvent('sqlite_backup', 'ok', { backupPath });
  return backupPath;
}
