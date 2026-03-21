import { DEFAULT_RUNTIME_HEARTBEAT_TTL_MS } from './constants.js';
import { RuntimeLockRepository } from './runtimeLockRepository.js';
import { RuntimeSessionRepository, type RuntimeSessionRecord } from './runtimeSessionRepository.js';
import { WorktreeManager } from './worktreeManager.js';

export interface ReapRuntimeStateInput {
  nowIso?: string;
  sessionTtlMs?: number;
}

export interface ReapRuntimeStateResult {
  staleSessions: string[];
  releasedLocks: number;
  removedWorktrees: string[];
}

function getLastSeenAt(session: RuntimeSessionRecord) {
  return session.heartbeatAt || session.startedAt || session.updatedAt;
}

export class RuntimeReaper {
  constructor(
    private readonly sessionRepository: RuntimeSessionRepository,
    private readonly lockRepository: RuntimeLockRepository,
    private readonly worktreeManager: WorktreeManager,
  ) {}

  async reap(input: ReapRuntimeStateInput = {}) {
    const nowIso = input.nowIso || new Date().toISOString();
    const sessionCutoff = Date.parse(nowIso) - (input.sessionTtlMs ?? DEFAULT_RUNTIME_HEARTBEAT_TTL_MS);
    const staleSessions: string[] = [];
    const removedWorktrees: string[] = [];
    let releasedLocks = this.lockRepository.deleteExpired(nowIso);

    for (const session of this.sessionRepository.listActive()) {
      const lastSeenAt = getLastSeenAt(session);
      if (!lastSeenAt) continue;
      if (Date.parse(lastSeenAt) > sessionCutoff) continue;

      this.sessionRepository.markStuck({
        runtimeSessionId: session.runtimeSessionId,
        failureKind: 'heartbeat_timeout',
        failureSummary: `Heartbeat vencido. last_seen=${lastSeenAt}`,
        finishedAt: nowIso,
        heartbeatAt: nowIso,
      });

      releasedLocks += this.lockRepository.releaseForSession(session.runtimeSessionId);
      staleSessions.push(session.runtimeSessionId);

      if (!session.worktreePath) continue;
      if (!this.worktreeManager.isManagedWorkspace(session.worktreePath)) continue;

      if (await this.worktreeManager.teardownWorkspacePath(session.worktreePath)) {
        removedWorktrees.push(session.worktreePath);
      }
    }

    return {
      staleSessions,
      releasedLocks,
      removedWorktrees,
    } satisfies ReapRuntimeStateResult;
  }
}
