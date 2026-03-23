import { readdirSync } from 'fs';
import { DEFAULT_RUNTIME_HEARTBEAT_TTL_MS } from './constants.js';
import { enqueueEngineNotification } from './engineNotifications.js';
import { RuntimeLockRepository } from './runtimeLockRepository.js';
import { RuntimeSessionRepository, type RuntimeSessionRecord } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';
import { WorktreeManager } from './worktreeManager.js';

export interface ReapRuntimeStateInput {
  nowIso?: string;
  sessionTtlMs?: number;
}

export interface ReapRuntimeStateResult {
  staleSessions: string[];
  releasedLocks: number;
  removedWorktrees: string[];
  killedPids: number[];
  killedTmuxSessions: string[];
}

function getLastSeenAt(session: RuntimeSessionRecord) {
  return session.heartbeatAt || session.startedAt || session.updatedAt;
}

export class RuntimeReaper {
  constructor(
    private readonly sessionRepository: RuntimeSessionRepository,
    private readonly lockRepository: RuntimeLockRepository,
    private readonly worktreeManager: WorktreeManager,
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly enqueueNotification = enqueueEngineNotification,
  ) {}

  async reap(input: ReapRuntimeStateInput = {}) {
    const nowIso = input.nowIso || new Date().toISOString();
    const sessionCutoff = Date.parse(nowIso) - (input.sessionTtlMs ?? DEFAULT_RUNTIME_HEARTBEAT_TTL_MS);
    const staleSessions: string[] = [];
    const removedWorktrees: string[] = [];
    const killedPids: number[] = [];
    const killedTmuxSessions: string[] = [];
    let releasedLocks = this.lockRepository.deleteExpired(nowIso);

    // 1. Limpieza de sesiones activas pero caducadas (Heartbeat timeout)
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

      this.enqueueNotification({
        runtimeSessionId: session.runtimeSessionId,
        eventType: 'session.reaped',
        payload: {
          kind: 'heartbeat_timeout',
          reason: `Heartbeat vencido. last_seen=${lastSeenAt}`,
        },
      });

      // Intentar matar procesos asociados
      if (session.pid) {
        try {
          process.kill(session.pid, 'SIGKILL');
          killedPids.push(session.pid);
        } catch {
          // Ya no existe o no tenemos permiso
        }
      }

      if (await this.tmuxRuntime.isAlive(session.runtimeSessionId)) {
        if (await this.tmuxRuntime.killSession(session.runtimeSessionId)) {
          killedTmuxSessions.push(session.runtimeSessionId);
        }
      }

      releasedLocks += this.lockRepository.releaseForSession(session.runtimeSessionId);
      staleSessions.push(session.runtimeSessionId);

      if (!session.worktreePath) continue;
      if (!this.worktreeManager.isManagedWorkspace(session.worktreePath)) continue;

      if (await this.worktreeManager.teardownWorkspacePath(session.worktreePath)) {
        removedWorktrees.push(session.worktreePath);
      }
    }

    // 2. Limpieza de Worktrees huérfanos (Zombies que no están en la DB como activos)
    try {
      const worktreeRoot = this.worktreeManager.getWorktreeRootPath();
      const activeSessionIds = new Set(
        this.sessionRepository.listActive().map((s) => s.runtimeSessionId)
      );

      const entries = readdirSync(worktreeRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionId = entry.name;
        // Si no es una sesión activa, es candidata a limpieza si es lo suficientemente vieja
        // Para simplificar ahora: si no es activa, la limpiamos (asumimos que sessions supervisor se encarga de las nuevas)
        if (!activeSessionIds.has(sessionId)) {
          const fullPath = this.worktreeManager.getWorkspacePath(sessionId);
          if (await this.worktreeManager.teardownWorkspacePath(fullPath)) {
            removedWorktrees.push(fullPath);
            // También intentar matar tmux por si acaso el nombre de la carpeta coincide con una sesión colgada
            if (await this.tmuxRuntime.isAlive(sessionId)) {
              if (await this.tmuxRuntime.killSession(sessionId)) {
                killedTmuxSessions.push(sessionId);
              }
            }
          }
        }
      }
    } catch {
      // Root no existe o inaccesible
    }

    // 3. Limpieza de Locks huérfanos (Locks de sesiones que ya no están vivas en tmux)
    const activeLocks = this.lockRepository.listAllActive();
    for (const lock of activeLocks) {
      const isTmuxAlive = await this.tmuxRuntime.isAlive(lock.runtimeSessionId);
      if (!isTmuxAlive) {
        releasedLocks += this.lockRepository.releaseForSession(lock.runtimeSessionId);
        if (!staleSessions.includes(lock.runtimeSessionId)) {
          staleSessions.push(lock.runtimeSessionId);
        }
      }
    }

    return {
      staleSessions,
      releasedLocks,
      removedWorktrees,
      killedPids,
      killedTmuxSessions,
    } satisfies ReapRuntimeStateResult;
  }
}
