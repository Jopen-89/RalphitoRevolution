import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import {
  DEFAULT_ENGINE_NOTIFICATION_DELIVERY_LEASE_MS,
  DEFAULT_ENGINE_NOTIFICATION_MAX_ATTEMPTS,
  DEFAULT_ENGINE_NOTIFICATION_RETRY_BASE_MS,
} from './constants.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export const ENGINE_NOTIFICATION_EVENT_TYPES = [
  'session.started',
  'session.spawn_failed',
  'session.timeout',
  'session.interactive_blocked',
  'session.guardrail_failed',
  'session.synced',
  'session.reaped',
  'session.suspended_human_input',
] as const;

export type EngineNotificationEventType = (typeof ENGINE_NOTIFICATION_EVENT_TYPES)[number];
export type EngineNotificationStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

export interface SessionStartedNotificationPayload {
  projectId: string;
  branchName: string;
  beadPath: string | null;
  workItemKey: string | null;
}

export interface SessionSpawnFailedNotificationPayload {
  projectId: string;
  branchName: string;
  beadPath: string | null;
  workItemKey: string | null;
  error: string;
}

export interface SessionTimeoutNotificationPayload {
  kind: 'max_wall_time_exceeded' | 'max_command_time_exceeded';
  summary: string;
  hint: string | null;
}

export interface SessionInteractiveBlockedNotificationPayload {
  kind: 'interactive_prompt_detected' | 'blocked_daemon_detected' | 'interactive_prompt_unresolved';
  summary: string;
  hint: string | null;
}

export interface SessionSuspendedHumanInputNotificationPayload {
  kind: 'credential_required' | 'human_timeout';
  summary: string;
  prompt: string | null;
  hint: string | null;
}

export interface SessionGuardrailFailedNotificationPayload {
  guardrail: string;
  beadId: string | null;
  title: string | null;
  summary: string | null;
  snippet: string | null;
}

export interface SessionSyncedNotificationPayload {
  beadId: string | null;
  title: string | null;
  branchName: string | null;
  prUrl: string | null;
}

export interface SessionReapedNotificationPayload {
  kind: string;
  reason: string;
}

export interface EngineNotificationPayloadMap {
  'session.started': SessionStartedNotificationPayload;
  'session.spawn_failed': SessionSpawnFailedNotificationPayload;
  'session.timeout': SessionTimeoutNotificationPayload;
  'session.interactive_blocked': SessionInteractiveBlockedNotificationPayload;
  'session.guardrail_failed': SessionGuardrailFailedNotificationPayload;
  'session.synced': SessionSyncedNotificationPayload;
  'session.reaped': SessionReapedNotificationPayload;
  'session.suspended_human_input': SessionSuspendedHumanInputNotificationPayload;
}

export type AnyEngineNotificationPayload = EngineNotificationPayloadMap[EngineNotificationEventType];

export interface EngineNotificationRecord<T extends EngineNotificationEventType = EngineNotificationEventType> {
  eventId: string;
  runtimeSessionId: string | null;
  eventType: T;
  payload: EngineNotificationPayloadMap[T];
  targetChatId: string | null;
  status: EngineNotificationStatus;
  attemptCount: number;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
}

export interface EngineNotificationSummary {
  total: number;
  pending: number;
  delivering: number;
  delivered: number;
  failed: number;
  pendingWithoutTarget: number;
  oldestOutstandingAt: string | null;
  newestCreatedAt: string | null;
}

export interface EnqueueEngineNotificationInput<T extends EngineNotificationEventType = EngineNotificationEventType> {
  eventId?: string;
  runtimeSessionId?: string | null;
  eventType: T;
  payload: EngineNotificationPayloadMap[T];
  targetChatId?: string | null;
  createdAt?: string;
  nextAttemptAt?: string;
}

export interface MarkEngineNotificationFailedInput {
  eventId: string;
  attemptCount: number;
  errorMessage: string;
  failedAt?: string;
  terminal?: boolean;
}

interface SessionTargetChatRow {
  notificationChatId: string | null;
  channel: string | null;
  externalChatId: string | null;
}

interface NotificationStatusCountRow {
  status: EngineNotificationStatus;
  count: number;
}

interface NotificationTimestampRow {
  createdAt: string;
}

const ENGINE_CLI_PATH = fileURLToPath(new URL('./cli.ts', import.meta.url));

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function isEngineNotificationEventType(value: string): value is EngineNotificationEventType {
  return ENGINE_NOTIFICATION_EVENT_TYPES.includes(value as EngineNotificationEventType);
}

function addMilliseconds(isoTimestamp: string, milliseconds: number) {
  return new Date(Date.parse(isoTimestamp) + milliseconds).toISOString();
}

function getRetryDelayMs(attemptCount: number) {
  return DEFAULT_ENGINE_NOTIFICATION_RETRY_BASE_MS * 2 ** Math.max(attemptCount - 1, 0);
}

function shouldKickNotificationDelivery() {
  if (process.env.RALPHITO_DISABLE_NOTIFICATION_KICK === '1') return false;
  if (process.env.RALPHITO_NOTIFICATION_DELIVERY_CHILD === '1') return false;
  return true;
}

function kickNotificationDelivery() {
  if (!shouldKickNotificationDelivery()) return;

  try {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', ENGINE_CLI_PATH, 'deliver-notifications', '20'],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          RALPHITO_NOTIFICATION_DELIVERY_CHILD: '1',
        },
      },
    );
    child.unref();
  } catch {
    // El poller del bot sigue siendo la red de seguridad.
  }
}

function mapNotificationRow(row: Record<string, unknown>) {
  const eventType = String(row.eventType || '');
  if (!isEngineNotificationEventType(eventType)) {
    throw new Error(`Engine notification type invalido: ${eventType}`);
  }

  return {
    eventId: String(row.eventId),
    runtimeSessionId: normalizeOptionalText(row.runtimeSessionId),
    eventType,
    payload: JSON.parse(String(row.payloadJson || '{}')) as EngineNotificationPayloadMap[typeof eventType],
    targetChatId: normalizeOptionalText(row.targetChatId),
    status: String(row.status) as EngineNotificationStatus,
    attemptCount: Number(row.attemptCount || 0),
    nextAttemptAt: String(row.nextAttemptAt),
    createdAt: String(row.createdAt),
    deliveredAt: normalizeOptionalText(row.deliveredAt),
    errorMessage: normalizeOptionalText(row.errorMessage),
  } satisfies EngineNotificationRecord<typeof eventType>;
}

export class EngineNotificationRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  private getByEventId<T extends EngineNotificationEventType>(eventId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            event_id AS eventId,
            runtime_session_id AS runtimeSessionId,
            event_type AS eventType,
            payload_json AS payloadJson,
            target_chat_id AS targetChatId,
            status,
            attempt_count AS attemptCount,
            next_attempt_at AS nextAttemptAt,
            created_at AS createdAt,
            delivered_at AS deliveredAt,
            error_message AS errorMessage
          FROM engine_notifications
          WHERE event_id = ?
          LIMIT 1
        `,
      )
      .get(eventId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return mapNotificationRow(row) as EngineNotificationRecord<T>;
  }

  resolveTargetChatId(runtimeSessionId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            agent_sessions.notification_chat_id AS notificationChatId,
            threads.channel AS channel,
            threads.external_chat_id AS externalChatId
          FROM agent_sessions
          LEFT JOIN threads ON threads.id = COALESCE(agent_sessions.origin_thread_id, agent_sessions.thread_id)
          WHERE agent_sessions.runtime_session_id = ?
          LIMIT 1
        `,
      )
      .get(runtimeSessionId) as SessionTargetChatRow | undefined;

    return (
      normalizeOptionalText(row?.notificationChatId) ??
      (row?.channel === 'telegram' ? normalizeOptionalText(row.externalChatId) : null) ??
      null
    );
  }

  enqueue<T extends EngineNotificationEventType>(input: EnqueueEngineNotificationInput<T>) {
    const createdAt = input.createdAt || new Date().toISOString();
    const eventId = input.eventId || randomUUID();
    const runtimeSessionId = normalizeOptionalText(input.runtimeSessionId);
    const targetChatId =
      normalizeOptionalText(input.targetChatId) ??
      (runtimeSessionId ? this.resolveTargetChatId(runtimeSessionId) : null);
    const nextAttemptAt = input.nextAttemptAt || createdAt;

    this.db
      .prepare(
        `
          INSERT INTO engine_notifications (
            event_id,
            runtime_session_id,
            event_type,
            payload_json,
            target_chat_id,
            status,
            attempt_count,
            next_attempt_at,
            created_at,
            delivered_at,
            error_message
          ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, NULL, NULL)
        `,
      )
      .run(
        eventId,
        runtimeSessionId,
        input.eventType,
        JSON.stringify(input.payload),
        targetChatId,
        nextAttemptAt,
        createdAt,
      );

    kickNotificationDelivery();
    return this.getByEventId<T>(eventId);
  }

  listDeliverable(nowIso = new Date().toISOString(), limit = 20) {
    return this.db
      .prepare(
        `
          SELECT
            event_id AS eventId,
            runtime_session_id AS runtimeSessionId,
            event_type AS eventType,
            payload_json AS payloadJson,
            target_chat_id AS targetChatId,
            status,
            attempt_count AS attemptCount,
            next_attempt_at AS nextAttemptAt,
            created_at AS createdAt,
            delivered_at AS deliveredAt,
            error_message AS errorMessage
          FROM engine_notifications
          WHERE status IN ('pending', 'delivering')
            AND next_attempt_at <= ?
          ORDER BY created_at ASC, event_id ASC
          LIMIT ?
        `,
      )
      .all(nowIso, limit)
      .map((row) => mapNotificationRow(row as Record<string, unknown>));
  }

  claim(eventId: string, claimAt = new Date().toISOString()) {
    const leaseUntil = addMilliseconds(claimAt, DEFAULT_ENGINE_NOTIFICATION_DELIVERY_LEASE_MS);
    const result = this.db
      .prepare(
        `
          UPDATE engine_notifications
          SET status = 'delivering',
              next_attempt_at = ?
          WHERE event_id = ?
            AND status IN ('pending', 'delivering')
            AND next_attempt_at <= ?
        `,
      )
      .run(leaseUntil, eventId, claimAt);

    if (result.changes === 0) return null;
    return this.getByEventId(eventId);
  }

  markDelivered(eventId: string, deliveredAt = new Date().toISOString()) {
    this.db
      .prepare(
        `
          UPDATE engine_notifications
          SET status = 'delivered',
              delivered_at = ?,
              next_attempt_at = ?,
              error_message = NULL
          WHERE event_id = ?
        `,
      )
      .run(deliveredAt, deliveredAt, eventId);

    return this.getByEventId(eventId);
  }

  markFailed(input: MarkEngineNotificationFailedInput) {
    const failedAt = input.failedAt || new Date().toISOString();
    const terminal =
      input.terminal ?? input.attemptCount >= DEFAULT_ENGINE_NOTIFICATION_MAX_ATTEMPTS;
    const nextAttemptAt = terminal
      ? failedAt
      : addMilliseconds(failedAt, getRetryDelayMs(input.attemptCount));

    this.db
      .prepare(
        `
          UPDATE engine_notifications
          SET status = ?,
              attempt_count = ?,
              next_attempt_at = ?,
              delivered_at = NULL,
              error_message = ?
          WHERE event_id = ?
        `,
      )
      .run(
        terminal ? 'failed' : 'pending',
        input.attemptCount,
        nextAttemptAt,
        input.errorMessage,
        input.eventId,
      );

    return this.getByEventId(input.eventId);
  }

  listAll() {
    return this.db
      .prepare(
        `
          SELECT
            event_id AS eventId,
            runtime_session_id AS runtimeSessionId,
            event_type AS eventType,
            payload_json AS payloadJson,
            target_chat_id AS targetChatId,
            status,
            attempt_count AS attemptCount,
            next_attempt_at AS nextAttemptAt,
            created_at AS createdAt,
            delivered_at AS deliveredAt,
            error_message AS errorMessage
          FROM engine_notifications
          ORDER BY created_at ASC, event_id ASC
        `,
      )
      .all()
      .map((row) => mapNotificationRow(row as Record<string, unknown>));
  }

  listRecent(limit = 20) {
    return this.db
      .prepare(
        `
          SELECT
            event_id AS eventId,
            runtime_session_id AS runtimeSessionId,
            event_type AS eventType,
            payload_json AS payloadJson,
            target_chat_id AS targetChatId,
            status,
            attempt_count AS attemptCount,
            next_attempt_at AS nextAttemptAt,
            created_at AS createdAt,
            delivered_at AS deliveredAt,
            error_message AS errorMessage
          FROM engine_notifications
          ORDER BY created_at DESC, event_id DESC
          LIMIT ?
        `,
      )
      .all(limit)
      .map((row) => mapNotificationRow(row as Record<string, unknown>));
  }

  getSummary() {
    const counts = new Map<EngineNotificationStatus, number>([
      ['pending', 0],
      ['delivering', 0],
      ['delivered', 0],
      ['failed', 0],
    ]);

    const statusRows = this.db
      .prepare(
        `
          SELECT status, COUNT(*) AS count
          FROM engine_notifications
          GROUP BY status
        `,
      )
      .all() as NotificationStatusCountRow[];

    for (const row of statusRows) {
      counts.set(row.status, row.count);
    }

    const oldestOutstanding = this.db
      .prepare(
        `
          SELECT created_at AS createdAt
          FROM engine_notifications
          WHERE status IN ('pending', 'delivering')
          ORDER BY created_at ASC, event_id ASC
          LIMIT 1
        `,
      )
      .get() as NotificationTimestampRow | undefined;

    const newestCreated = this.db
      .prepare(
        `
          SELECT created_at AS createdAt
          FROM engine_notifications
          ORDER BY created_at DESC, event_id DESC
          LIMIT 1
        `,
      )
      .get() as NotificationTimestampRow | undefined;

    const pendingWithoutTarget = (
      this.db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM engine_notifications
            WHERE status IN ('pending', 'delivering')
              AND (target_chat_id IS NULL OR TRIM(target_chat_id) = '')
          `,
        )
        .get() as { count: number }
    ).count;

    const pending = counts.get('pending') || 0;
    const delivering = counts.get('delivering') || 0;
    const delivered = counts.get('delivered') || 0;
    const failed = counts.get('failed') || 0;

    return {
      total: pending + delivering + delivered + failed,
      pending,
      delivering,
      delivered,
      failed,
      pendingWithoutTarget,
      oldestOutstandingAt: normalizeOptionalText(oldestOutstanding?.createdAt),
      newestCreatedAt: normalizeOptionalText(newestCreated?.createdAt),
    } satisfies EngineNotificationSummary;
  }
}

let engineNotificationRepository: EngineNotificationRepository | null = null;

export function getEngineNotificationRepository() {
  if (engineNotificationRepository) return engineNotificationRepository;

  engineNotificationRepository = new EngineNotificationRepository(getRalphitoDatabase());
  return engineNotificationRepository;
}

export function resetEngineNotificationRepository() {
  engineNotificationRepository = null;
}

export function enqueueEngineNotification<T extends EngineNotificationEventType>(
  input: EnqueueEngineNotificationInput<T>,
) {
  return getEngineNotificationRepository().enqueue(input);
}
