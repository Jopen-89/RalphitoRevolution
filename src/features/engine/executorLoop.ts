import { setTimeout as sleep } from 'timers/promises';
import {
  DEFAULT_RUNTIME_HEARTBEAT_INTERVAL_MS,
  DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS,
  DEFAULT_RUNTIME_MAX_WALL_TIME_MS,
  DEFAULT_RUNTIME_OUTPUT_LINES,
} from './constants.js';
import {
  clearRuntimeFailureRecord,
  readRuntimeFailureRecord,
  readRuntimeSessionFile,
  writeRuntimeFailureRecord,
} from './runtimeFiles.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';
import { WorktreeManager } from './worktreeManager.js';

export interface ExecutorLoopContext {
  runtimeSessionId: string;
  pollMs?: number;
}

export interface ExecutorLoopResult {
  terminalStatus: 'done' | 'failed' | 'stuck';
  reason: string;
}

function tailOutput(output: string | null, maxLines = 40) {
  if (!output) return null;
  return output
    .trim()
    .split('\n')
    .slice(-maxLines)
    .join('\n')
    .trim();
}

export class ExecutorLoop {
  constructor(
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly sessionRepository = getRuntimeSessionRepository(),
    private readonly lockRepository = getRuntimeLockRepository(),
  ) {}

  private async cleanupTerminalSession(runtimeSessionId: string, worktreePath: string | null, removeWorkspace: boolean) {
    this.lockRepository.releaseForSession(runtimeSessionId);

    if (!worktreePath || !removeWorkspace) return;

    const manager = new WorktreeManager();
    if (manager.isManagedWorkspace(worktreePath)) {
      await manager.teardownWorkspacePath(worktreePath);
    }
  }

  async run(input: ExecutorLoopContext) {
    let lastOutput = '';
    let lastProgressAt = Date.now();
    let lastStatus: string | null = null;

    for (;;) {
      const session = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      if (!session) {
        return {
          terminalStatus: 'failed',
          reason: 'session_missing',
        } satisfies ExecutorLoopResult;
      }

      const sessionFile = session.worktreePath ? readRuntimeSessionFile(session.worktreePath) : null;
      const failure = session.worktreePath ? readRuntimeFailureRecord(session.worktreePath) : null;
      const nowIso = new Date().toISOString();
      const nowMs = Date.parse(nowIso);
      const maxWallTimeMs = sessionFile?.maxWallTimeMs ?? DEFAULT_RUNTIME_MAX_WALL_TIME_MS;
      const maxCommandTimeMs = sessionFile?.maxCommandTimeMs ?? DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS;
      const sessionMaxSteps = session.maxSteps ?? sessionFile?.maxSteps;
      const startedAtMs = Date.parse(session.startedAt || session.createdAt);
      const alive = await this.tmuxRuntime.isAlive(input.runtimeSessionId);
      const output = alive ? await this.tmuxRuntime.captureOutput(input.runtimeSessionId, DEFAULT_RUNTIME_OUTPUT_LINES) : '';
      const normalizedOutput = output.trim();

      if (lastStatus === 'failed' && session.status === 'running') {
        lastProgressAt = nowMs;
      }
      lastStatus = session.status;

      this.sessionRepository.heartbeat({
        runtimeSessionId: input.runtimeSessionId,
        heartbeatAt: nowIso,
        status: session.status,
        ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
        ...(typeof sessionMaxSteps === 'number' ? { maxSteps: sessionMaxSteps } : {}),
      });
      this.lockRepository.heartbeat({
        runtimeSessionId: input.runtimeSessionId,
        heartbeatAt: nowIso,
      });

      if (failure && session.status !== 'failed') {
        this.sessionRepository.fail({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: failure.kind,
          failureSummary: failure.summary,
          ...(failure.logTail ? { failureLogTail: failure.logTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
      }

      if (session.status === 'running' && normalizedOutput && normalizedOutput !== lastOutput) {
        lastOutput = normalizedOutput;
        lastProgressAt = nowMs;
        this.sessionRepository.incrementStepCount({
          runtimeSessionId: input.runtimeSessionId,
          heartbeatAt: nowIso,
        });
      }

      const refreshedSession = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      if (!refreshedSession) {
        return {
          terminalStatus: 'failed',
          reason: 'session_missing_after_heartbeat',
        } satisfies ExecutorLoopResult;
      }

      if (refreshedSession.maxSteps && refreshedSession.stepCount >= refreshedSession.maxSteps) {
        const summary = `Se excedio max_steps=${refreshedSession.maxSteps}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_steps_exceeded',
            summary,
            logTail: tailOutput(normalizedOutput),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        const failureLogTail = tailOutput(normalizedOutput);
        this.sessionRepository.fail({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: 'max_steps_exceeded',
          failureSummary: summary,
          ...(failureLogTail ? { failureLogTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'failed', reason: 'max_steps_exceeded' } satisfies ExecutorLoopResult;
      }

      if (nowMs - startedAtMs > maxWallTimeMs) {
        const summary = `Se excedio max_wall_time_ms=${maxWallTimeMs}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_wall_time_exceeded',
            summary,
            logTail: tailOutput(normalizedOutput),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        const failureLogTail = tailOutput(normalizedOutput);
        this.sessionRepository.markStuck({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: 'max_wall_time_exceeded',
          failureSummary: summary,
          ...(failureLogTail ? { failureLogTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'stuck', reason: 'max_wall_time_exceeded' } satisfies ExecutorLoopResult;
      }

      if (refreshedSession.status === 'running' && nowMs - lastProgressAt > maxCommandTimeMs) {
        const summary = `Se excedio max_command_time_ms=${maxCommandTimeMs}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_command_time_exceeded',
            summary,
            logTail: tailOutput(normalizedOutput),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        const failureLogTail = tailOutput(normalizedOutput);
        this.sessionRepository.fail({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: 'max_command_time_exceeded',
          failureSummary: summary,
          ...(failureLogTail ? { failureLogTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'failed', reason: 'max_command_time_exceeded' } satisfies ExecutorLoopResult;
      }

      if (!alive) {
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, false);
        if (failure) {
          this.sessionRepository.fail({
            runtimeSessionId: input.runtimeSessionId,
            failureKind: failure.kind,
            failureSummary: failure.summary,
            ...(failure.logTail ? { failureLogTail: failure.logTail } : {}),
            heartbeatAt: nowIso,
            finishedAt: nowIso,
          });
          return { terminalStatus: 'failed', reason: failure.kind } satisfies ExecutorLoopResult;
        }

        if (refreshedSession.status === 'failed') {
          return { terminalStatus: 'failed', reason: refreshedSession.failureKind || 'failed' } satisfies ExecutorLoopResult;
        }

        if (refreshedSession.worktreePath) {
          clearRuntimeFailureRecord(refreshedSession.worktreePath);
        }
        this.sessionRepository.finish({
          runtimeSessionId: input.runtimeSessionId,
          status: 'done',
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
        return { terminalStatus: 'done', reason: 'process_exited' } satisfies ExecutorLoopResult;
      }

      await sleep(input.pollMs ?? DEFAULT_RUNTIME_HEARTBEAT_INTERVAL_MS);
    }
  }
}
