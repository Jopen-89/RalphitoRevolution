import { resolveEngineProjectConfig } from '../engine/config.js';
import { readRuntimeSessionFile, resolveRuntimeTaskId } from '../engine/runtimeFiles.js';
import { getRuntimeLockRepository } from '../engine/runtimeLockRepository.js';
import { RuntimeReaper, type ReapRuntimeStateInput, type ReapRuntimeStateResult } from '../engine/runtimeReaper.js';
import { getRuntimeSessionRepository, type RuntimeSessionRecord } from '../engine/runtimeSessionRepository.js';
import { syncRuntimeTaskLink } from '../engine/runtimeTaskLinking.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';
import { enqueueEngineNotification } from './EventBus.js';
import { ExecutionPipelineService } from './ExecutionPipelineService.js';

export const DEFAULT_RUNTIME_CANCEL_REASON = 'Sesión cancelada';

export interface CancelRuntimeSessionInput {
  runtimeSessionId: string;
  reason?: string | null;
}

export interface CancelRuntimeSessionResult {
  session: RuntimeSessionRecord | null;
  killed: boolean;
  runtimeStopped: boolean;
  locksReleased: number;
  worktreeRemoved: boolean;
  notificationQueued: boolean;
  statusChanged: boolean;
}

export interface ReapStaleRuntimeSessionsResult extends ReapRuntimeStateResult {
  auditedSessions: number;
}

function canTransitionToCancelled(status: RuntimeSessionRecord['status']) {
  return status === 'queued' || status === 'running' || status === 'suspended_human_input';
}

export class RuntimeSessionLifecycleService {
  constructor(
    private readonly sessionRepository = getRuntimeSessionRepository(),
    private readonly lockRepository = getRuntimeLockRepository(),
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly worktreeManagerFactory = () =>
      new WorktreeManager(process.cwd(), process.env.RALPHITO_WORKTREE_ROOT || undefined),
    private readonly reaperFactory = (
      sessionRepository = getRuntimeSessionRepository(),
      lockRepository = getRuntimeLockRepository(),
      worktreeManager = new WorktreeManager(process.cwd(), process.env.RALPHITO_WORKTREE_ROOT || undefined),
      tmuxRuntime = new TmuxRuntime(),
    ) => new RuntimeReaper(sessionRepository, lockRepository, worktreeManager, tmuxRuntime),
    private readonly executionPipeline = new ExecutionPipelineService(),
  ) {}

  private resolveWorktreeManager(session: RuntimeSessionRecord, projectId?: string | null) {
    const resolvedProjectId = projectId?.trim() || session.agentId;
    try {
      const project = resolveEngineProjectConfig(resolvedProjectId);
      return new WorktreeManager(project.path, project.worktreeRoot);
    } catch {
      return new WorktreeManager(process.cwd(), process.env.RALPHITO_WORKTREE_ROOT || undefined);
    }
  }

  async cancel(input: CancelRuntimeSessionInput): Promise<CancelRuntimeSessionResult> {
    const session = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
    const reason = input.reason?.trim() || DEFAULT_RUNTIME_CANCEL_REASON;
    let statusChanged = false;
    let notificationQueued = false;
    let locksReleased = 0;
    let worktreeRemoved = false;
    let currentSession = session;
    const sessionFile = session?.worktreePath ? readRuntimeSessionFile(session.worktreePath) : null;

    if (session && canTransitionToCancelled(session.status)) {
      currentSession = this.sessionRepository.finish({
        runtimeSessionId: input.runtimeSessionId,
        status: 'cancelled',
      });
      statusChanged = true;

      syncRuntimeTaskLink({
        runtimeSessionId: input.runtimeSessionId,
        projectId: sessionFile?.projectId ?? session.agentId,
        taskId: resolveRuntimeTaskId({
          taskId: sessionFile?.taskId ?? null,
          workItemKey: sessionFile?.workItemKey ?? null,
        }),
        workItemKey: sessionFile?.workItemKey ?? null,
        beadPath: sessionFile?.beadPath ?? null,
        assignedAgent: session.agentId,
        status: 'cancelled',
      });
      this.executionPipeline.recordTerminalResultByRuntimeSessionId({
        runtimeSessionId: input.runtimeSessionId,
        status: 'cancelled',
        summary: reason,
        reason: 'cancelled',
        payload: {
          kind: 'cancelled',
        },
      });

      enqueueEngineNotification({
        runtimeSessionId: input.runtimeSessionId,
        eventType: 'session.cancelled',
        payload: {
          projectId: sessionFile?.projectId ?? session.agentId,
          branchName: sessionFile?.branchName ?? null,
          beadPath: sessionFile?.beadPath ?? null,
          workItemKey: sessionFile?.workItemKey ?? null,
          reason,
        },
      });
      notificationQueued = true;
    }

    const killed = await this.tmuxRuntime.killSession(input.runtimeSessionId);
    const runtimeStopped = killed || !(await this.tmuxRuntime.isAlive(input.runtimeSessionId));

    if (session?.worktreePath && runtimeStopped) {
      locksReleased = this.lockRepository.releaseForSession(input.runtimeSessionId);
      const worktreeManager = this.resolveWorktreeManager(session, sessionFile?.projectId);
      if (worktreeManager.isManagedWorkspace(session.worktreePath)) {
        worktreeRemoved = await worktreeManager.teardownWorkspacePath(session.worktreePath);
      }
    } else if (runtimeStopped) {
      locksReleased = this.lockRepository.releaseForSession(input.runtimeSessionId);
    }

    return {
      session: currentSession,
      killed,
      runtimeStopped,
      locksReleased,
      worktreeRemoved,
      notificationQueued,
      statusChanged,
    };
  }

  async reapStaleSessions(input: ReapRuntimeStateInput = {}): Promise<ReapStaleRuntimeSessionsResult> {
    const auditedSessions = this.sessionRepository.listActive().length;
    const reaper = this.reaperFactory(
      this.sessionRepository,
      this.lockRepository,
      this.worktreeManagerFactory(),
      this.tmuxRuntime,
    );
    const result = await reaper.reap(input);

    return {
      auditedSessions,
      ...result,
    };
  }
}
