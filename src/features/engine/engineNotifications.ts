import { randomUUID } from 'crypto';
import { getRalphitoDatabase } from '../persistence/db/index.js';
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
  kind: 'interactive_prompt_detected' | 'blocked_daemon_detected';
  summary: string;
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
