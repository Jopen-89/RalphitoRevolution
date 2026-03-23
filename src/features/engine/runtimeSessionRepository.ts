import { getRalphitoDatabase } from '../persistence/db/index.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export type RuntimeSessionStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'stuck' | 'suspended_human_input';
type FinishableRuntimeSessionStatus = Extract<RuntimeSessionStatus, 'done' | 'cancelled'>;
const ACTIVE_RUNTIME_SESSION_STATUSES = ['queued', 'running', 'suspended_human_input'] as const;
const DEFAULT_RECENT_RUNTIME_SESSION_LIMIT = 40;

export interface RuntimeSessionRecord {
  id: number;
  threadId: number;
  originThreadId: number | null;
  agentId: string;
  runtimeSessionId: string;
  status: RuntimeSessionStatus;
  baseCommitHash: string | null;
  notificationChatId: string | null;
  worktreePath: string | null;
  pid: number | null;
  stepCount: number;
  maxSteps: number | null;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  failureKind: string | null;
  failureSummary: string | null;
  failureLogTail: string | null;
  createdAt: string;
  updatedAt: string;
  currentCommand: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export interface CreateRuntimeSessionInput {
  threadId: number;
  originThreadId?: number;
  agentId: string;
  runtimeSessionId: string;
  status?: RuntimeSessionStatus;
  baseCommitHash?: string;
  notificationChatId?: string;
  worktreePath?: string;
  pid?: number;
  stepCount?: number;
  maxSteps?: number;
  startedAt?: string;
  heartbeatAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HeartbeatRuntimeSessionInput {
  runtimeSessionId: string;
  heartbeatAt?: string;
  status?: RuntimeSessionStatus;
  worktreePath?: string;
  maxSteps?: number;
  currentCommand?: string | null;
}

export interface AttachPidRuntimeSessionInput {
  runtimeSessionId: string;
  pid: number;
  worktreePath?: string;
  status?: RuntimeSessionStatus;
  startedAt?: string;
}

export interface IncrementRuntimeSessionStepInput {
  runtimeSessionId: string;
  stepDelta?: number;
  heartbeatAt?: string;
}

export interface FailRuntimeSessionInput {
  runtimeSessionId: string;
  failureKind: string;
  failureSummary: string;
  failureLogTail?: string;
  finishedAt?: string;
  heartbeatAt?: string;
}

export interface FinishRuntimeSessionInput {
  runtimeSessionId: string;
  status?: FinishableRuntimeSessionStatus;
  finishedAt?: string;
  heartbeatAt?: string;
}

export interface ClearRuntimeSessionFailureInput {
  runtimeSessionId: string;
  heartbeatAt?: string;
  status?: RuntimeSessionStatus;
}

export interface MarkStuckRuntimeSessionInput {
  runtimeSessionId: string;
  failureKind?: string;
  failureSummary?: string;
  failureLogTail?: string;
  finishedAt?: string;
  heartbeatAt?: string;
}

export interface ResumeRuntimeSessionInput {
  runtimeSessionId: string;
  heartbeatAt?: string;
}

export interface SuspendRuntimeSessionInput {
  runtimeSessionId: string;
  suspendedReason: string;
  heartbeatAt?: string;
}

export class RuntimeSessionRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateRuntimeSessionInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const updatedAt = input.updatedAt || createdAt;
    const startedAt = input.startedAt || createdAt;
    const heartbeatAt = input.heartbeatAt || updatedAt;
    const status = input.status || 'queued';
    const stepCount = input.stepCount ?? 0;

    this.db
      .prepare(
        `
          INSERT INTO agent_sessions (
            thread_id,
            origin_thread_id,
            agent_id,
            runtime_session_id,
            status,
            base_commit_hash,
            notification_chat_id,
            worktree_path,
            pid,
            step_count,
            max_steps,
            started_at,
            heartbeat_at,
            finished_at,
            failure_kind,
            failure_summary,
            failure_log_tail,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
          ON CONFLICT(runtime_session_id)
          DO UPDATE SET
            thread_id = excluded.thread_id,
            origin_thread_id = COALESCE(excluded.origin_thread_id, agent_sessions.origin_thread_id),
            agent_id = excluded.agent_id,
            runtime_session_id = excluded.runtime_session_id,
            status = excluded.status,
            base_commit_hash = excluded.base_commit_hash,
            notification_chat_id = COALESCE(excluded.notification_chat_id, agent_sessions.notification_chat_id),
            worktree_path = excluded.worktree_path,
            pid = excluded.pid,
            step_count = excluded.step_count,
            max_steps = excluded.max_steps,
            started_at = excluded.started_at,
            heartbeat_at = excluded.heartbeat_at,
            finished_at = excluded.finished_at,
            failure_kind = excluded.failure_kind,
            failure_summary = excluded.failure_summary,
            failure_log_tail = excluded.failure_log_tail,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.threadId,
        input.originThreadId || null,
        input.agentId,
        input.runtimeSessionId,
        status,
        input.baseCommitHash || null,
        input.notificationChatId || null,
        input.worktreePath || null,
        input.pid || null,
        stepCount,
        input.maxSteps || null,
        startedAt,
        heartbeatAt,
        createdAt,
        updatedAt,
      );

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  heartbeat(input: HeartbeatRuntimeSessionInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET heartbeat_at = ?,
              updated_at = ?,
              status = COALESCE(?, status),
              worktree_path = COALESCE(?, worktree_path),
              max_steps = COALESCE(?, max_steps),
              current_command = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(
        heartbeatAt,
        heartbeatAt,
        input.status || null,
        input.worktreePath || null,
        input.maxSteps || null,
        input.currentCommand ?? null,
        input.runtimeSessionId,
      );

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  attachPid(input: AttachPidRuntimeSessionInput) {
    const startedAt = input.startedAt || new Date().toISOString();
    const status = input.status || 'running';

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET pid = ?,
              worktree_path = COALESCE(?, worktree_path),
              status = ?,
              started_at = COALESCE(started_at, ?),
              heartbeat_at = ?,
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(
        input.pid,
        input.worktreePath || null,
        status,
        startedAt,
        startedAt,
        startedAt,
        input.runtimeSessionId,
      );

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  incrementStepCount(input: IncrementRuntimeSessionStepInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const stepDelta = input.stepDelta ?? 1;

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET step_count = step_count + ?,
              heartbeat_at = ?,
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(stepDelta, heartbeatAt, heartbeatAt, input.runtimeSessionId);

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  fail(input: FailRuntimeSessionInput) {
    const finishedAt = input.finishedAt || new Date().toISOString();
    const heartbeatAt = input.heartbeatAt || finishedAt;

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'failed',
              heartbeat_at = ?,
              finished_at = ?,
              failure_kind = ?,
              failure_summary = ?,
              failure_log_tail = ?,
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(
        heartbeatAt,
        finishedAt,
        input.failureKind,
        input.failureSummary,
        input.failureLogTail || null,
        finishedAt,
        input.runtimeSessionId,
      );

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  finish(input: FinishRuntimeSessionInput) {
    const finishedAt = input.finishedAt || new Date().toISOString();
    const heartbeatAt = input.heartbeatAt || finishedAt;
    const status = input.status || 'done';

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = ?,
              heartbeat_at = ?,
              finished_at = ?,
              failure_kind = NULL,
              failure_summary = NULL,
              failure_log_tail = NULL,
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(status, heartbeatAt, finishedAt, finishedAt, input.runtimeSessionId);

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  clearFailure(input: ClearRuntimeSessionFailureInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const status = input.status || 'running';

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = ?,
              heartbeat_at = ?,
              finished_at = NULL,
              failure_kind = NULL,
              failure_summary = NULL,
              failure_log_tail = NULL,
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(status, heartbeatAt, heartbeatAt, input.runtimeSessionId);

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  markStuck(input: MarkStuckRuntimeSessionInput) {
    const finishedAt = input.finishedAt || new Date().toISOString();
    const heartbeatAt = input.heartbeatAt || finishedAt;

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'stuck',
              heartbeat_at = ?,
              finished_at = ?,
              failure_kind = COALESCE(?, failure_kind),
              failure_summary = COALESCE(?, failure_summary),
              failure_log_tail = COALESCE(?, failure_log_tail),
              updated_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(
        heartbeatAt,
        finishedAt,
        input.failureKind || null,
        input.failureSummary || null,
        input.failureLogTail || null,
        finishedAt,
        input.runtimeSessionId,
      );

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  resume(input: ResumeRuntimeSessionInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'running',
              heartbeat_at = ?,
              updated_at = ?,
              failure_kind = NULL,
              failure_summary = NULL,
              failure_log_tail = NULL,
              suspended_at = NULL,
              suspended_reason = NULL
          WHERE runtime_session_id = ?
        `,
      )
      .run(heartbeatAt, heartbeatAt, input.runtimeSessionId);

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  suspend(input: SuspendRuntimeSessionInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const suspendedAt = heartbeatAt;

    this.db
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'suspended_human_input',
              heartbeat_at = ?,
              updated_at = ?,
              suspended_at = ?,
              suspended_reason = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(heartbeatAt, heartbeatAt, suspendedAt, input.suspendedReason, input.runtimeSessionId);

    return this.getByRuntimeSessionId(input.runtimeSessionId);
  }

  getByRuntimeSessionId(runtimeSessionId: string) {
    return (
      this.db
        .prepare(
          `
            SELECT
              id,
              thread_id AS threadId,
              origin_thread_id AS originThreadId,
              agent_id AS agentId,
              runtime_session_id AS runtimeSessionId,
              status,
              base_commit_hash AS baseCommitHash,
              notification_chat_id AS notificationChatId,
              worktree_path AS worktreePath,
              pid,
              step_count AS stepCount,
              max_steps AS maxSteps,
              started_at AS startedAt,
              heartbeat_at AS heartbeatAt,
              finished_at AS finishedAt,
              failure_kind AS failureKind,
              failure_summary AS failureSummary,
              failure_log_tail AS failureLogTail,
              created_at AS createdAt,
              updated_at AS updatedAt,
              current_command AS currentCommand,
              suspended_at AS suspendedAt,
              suspended_reason AS suspendedReason
            FROM agent_sessions
            WHERE runtime_session_id = ?
            LIMIT 1
          `,
        )
        .get(runtimeSessionId) as RuntimeSessionRecord | undefined
    ) || null;
  }

  listActive() {
    return this.db
      .prepare(
        `
          SELECT
            id,
            thread_id AS threadId,
            origin_thread_id AS originThreadId,
            agent_id AS agentId,
            runtime_session_id AS runtimeSessionId,
            status,
            base_commit_hash AS baseCommitHash,
            notification_chat_id AS notificationChatId,
            worktree_path AS worktreePath,
            pid,
            step_count AS stepCount,
            max_steps AS maxSteps,
            started_at AS startedAt,
            heartbeat_at AS heartbeatAt,
            finished_at AS finishedAt,
            failure_kind AS failureKind,
            failure_summary AS failureSummary,
            failure_log_tail AS failureLogTail,
            created_at AS createdAt,
            updated_at AS updatedAt,
            current_command AS currentCommand,
            suspended_at AS suspendedAt,
            suspended_reason AS suspendedReason
          FROM agent_sessions
          WHERE status IN (?, ?, ?)
          ORDER BY updated_at DESC, id DESC
        `,
      )
      .all(...ACTIVE_RUNTIME_SESSION_STATUSES, 'suspended_human_input') as RuntimeSessionRecord[];
  }

  listRecent(limit = DEFAULT_RECENT_RUNTIME_SESSION_LIMIT) {
    return this.db
      .prepare(
        `
          SELECT
            id,
            thread_id AS threadId,
            origin_thread_id AS originThreadId,
            agent_id AS agentId,
            runtime_session_id AS runtimeSessionId,
            status,
            base_commit_hash AS baseCommitHash,
            notification_chat_id AS notificationChatId,
            worktree_path AS worktreePath,
            pid,
            step_count AS stepCount,
            max_steps AS maxSteps,
            started_at AS startedAt,
            heartbeat_at AS heartbeatAt,
            finished_at AS finishedAt,
            failure_kind AS failureKind,
            failure_summary AS failureSummary,
            failure_log_tail AS failureLogTail,
            created_at AS createdAt,
            updated_at AS updatedAt,
            current_command AS currentCommand,
            suspended_at AS suspendedAt,
            suspended_reason AS suspendedReason
          FROM agent_sessions
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(limit) as RuntimeSessionRecord[];
  }
}

let runtimeSessionRepository: RuntimeSessionRepository | null = null;

export function getRuntimeSessionRepository() {
  if (runtimeSessionRepository) return runtimeSessionRepository;

  runtimeSessionRepository = new RuntimeSessionRepository(getRalphitoDatabase());
  return runtimeSessionRepository;
}

export function resetRuntimeSessionRepository() {
  runtimeSessionRepository = null;
}
