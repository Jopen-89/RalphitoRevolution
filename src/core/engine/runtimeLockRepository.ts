import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import { DEFAULT_RUNTIME_LOCK_TTL_MS } from '../domain/constants.js';
import {
  collapseRuntimeLockTargets,
  getRuntimePathCollisionRelation,
  type RuntimeLockPathKind,
} from './writeScope.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export interface RuntimeLockRecord {
  id: number;
  runtimeSessionId: string;
  path: string;
  pathKind: RuntimeLockPathKind;
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface RuntimeLockTarget {
  path: string;
  pathKind: RuntimeLockPathKind;
}

export interface RuntimeLockConflict {
  requestedPath: string;
  requestedPathKind: RuntimeLockPathKind;
  blockingLock: RuntimeLockRecord;
  relation: 'same' | 'ancestor' | 'descendant';
}

export interface AcquireRuntimeLocksInput {
  runtimeSessionId: string;
  targets: RuntimeLockTarget[];
  heartbeatAt?: string;
  ttlMs?: number;
}

export interface HeartbeatRuntimeLocksInput {
  runtimeSessionId: string;
  heartbeatAt?: string;
  ttlMs?: number;
}

export class RuntimeLockConflictError extends Error {
  constructor(readonly conflict: RuntimeLockConflict) {
    super(
      [
        'MUTEX COLLISION:',
        `lock activo ${conflict.relation} en ${conflict.blockingLock.path}`,
        `sesion=${conflict.blockingLock.runtimeSessionId}`,
        `requested=${conflict.requestedPath}`,
      ].join(' '),
    );

    this.name = 'RuntimeLockConflictError';
  }
}

function addMilliseconds(isoTimestamp: string, milliseconds: number) {
  return new Date(Date.parse(isoTimestamp) + milliseconds).toISOString();
}

function mapLockRow(row: Record<string, unknown>) {
  return row as unknown as RuntimeLockRecord;
}

export class RuntimeLockRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  private listActiveInternal(nowIso: string, excludedRuntimeSessionId?: string) {
    if (excludedRuntimeSessionId) {
      return this.db
        .prepare(
          `
            SELECT
              id,
              runtime_session_id AS runtimeSessionId,
              path,
              path_kind AS pathKind,
              created_at AS createdAt,
              heartbeat_at AS heartbeatAt,
              expires_at AS expiresAt
            FROM runtime_locks
            WHERE expires_at > ?
              AND runtime_session_id != ?
            ORDER BY path ASC
          `,
        )
        .all(nowIso, excludedRuntimeSessionId)
        .map((row) => mapLockRow(row as Record<string, unknown>));
    }

    return this.db
      .prepare(
        `
          SELECT
            id,
            runtime_session_id AS runtimeSessionId,
            path,
            path_kind AS pathKind,
            created_at AS createdAt,
            heartbeat_at AS heartbeatAt,
            expires_at AS expiresAt
          FROM runtime_locks
          WHERE expires_at > ?
          ORDER BY path ASC
        `,
      )
      .all(nowIso)
      .map((row) => mapLockRow(row as Record<string, unknown>));
  }

  private findFirstConflict(targets: RuntimeLockTarget[], activeLocks: RuntimeLockRecord[]) {
    for (const target of collapseRuntimeLockTargets(targets)) {
      for (const activeLock of activeLocks) {
        const relation = getRuntimePathCollisionRelation(activeLock.path, target.path);
        if (!relation) continue;

        return {
          requestedPath: target.path,
          requestedPathKind: target.pathKind,
          blockingLock: activeLock,
          relation,
        } satisfies RuntimeLockConflict;
      }
    }

    return null;
  }

  findActiveConflict(targets: RuntimeLockTarget[], nowIso = new Date().toISOString()) {
    const activeLocks = this.listActiveInternal(nowIso);
    return this.findFirstConflict(targets, activeLocks);
  }

  listAllActive(nowIso = new Date().toISOString()) {
    return this.listActiveInternal(nowIso);
  }

  acquireForSession(input: AcquireRuntimeLocksInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const expiresAt = addMilliseconds(heartbeatAt, input.ttlMs ?? DEFAULT_RUNTIME_LOCK_TTL_MS);
    const targets = collapseRuntimeLockTargets(input.targets);

    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM runtime_locks WHERE expires_at <= ?').run(heartbeatAt);
      this.db.prepare('DELETE FROM runtime_locks WHERE runtime_session_id = ?').run(input.runtimeSessionId);

      const conflict = this.findFirstConflict(
        targets,
        this.listActiveInternal(heartbeatAt, input.runtimeSessionId),
      );

      if (conflict) {
        throw new RuntimeLockConflictError(conflict);
      }

      const insertLock = this.db.prepare(
        `
          INSERT INTO runtime_locks (
            runtime_session_id,
            path,
            path_kind,
            created_at,
            heartbeat_at,
            expires_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      );

      for (const target of targets) {
        insertLock.run(
          input.runtimeSessionId,
          target.path,
          target.pathKind,
          heartbeatAt,
          heartbeatAt,
          expiresAt,
        );
      }
    });

    transaction.immediate();
    return this.listByRuntimeSessionId(input.runtimeSessionId);
  }

  heartbeat(input: HeartbeatRuntimeLocksInput) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const expiresAt = addMilliseconds(heartbeatAt, input.ttlMs ?? DEFAULT_RUNTIME_LOCK_TTL_MS);

    this.db
      .prepare(
        `
          UPDATE runtime_locks
          SET heartbeat_at = ?,
              expires_at = ?
          WHERE runtime_session_id = ?
        `,
      )
      .run(heartbeatAt, expiresAt, input.runtimeSessionId);

    return this.listByRuntimeSessionId(input.runtimeSessionId);
  }

  releaseForSession(runtimeSessionId: string) {
    const result = this.db
      .prepare('DELETE FROM runtime_locks WHERE runtime_session_id = ?')
      .run(runtimeSessionId);

    return result.changes;
  }

  deleteExpired(nowIso = new Date().toISOString()) {
    const result = this.db
      .prepare('DELETE FROM runtime_locks WHERE expires_at <= ?')
      .run(nowIso);

    return result.changes;
  }

  listByRuntimeSessionId(runtimeSessionId: string) {
    return this.db
      .prepare(
        `
          SELECT
            id,
            runtime_session_id AS runtimeSessionId,
            path,
            path_kind AS pathKind,
            created_at AS createdAt,
            heartbeat_at AS heartbeatAt,
            expires_at AS expiresAt
          FROM runtime_locks
          WHERE runtime_session_id = ?
          ORDER BY path ASC
        `,
      )
      .all(runtimeSessionId)
      .map((row) => mapLockRow(row as Record<string, unknown>));
  }
}

let runtimeLockRepository: RuntimeLockRepository | null = null;

export function getRuntimeLockRepository() {
  if (runtimeLockRepository) return runtimeLockRepository;

  runtimeLockRepository = new RuntimeLockRepository(getRalphitoDatabase());
  return runtimeLockRepository;
}

export function resetRuntimeLockRepository() {
  runtimeLockRepository = null;
}
