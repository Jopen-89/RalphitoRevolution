import { setTimeout as sleep } from 'timers/promises';
import {
  DEFAULT_RUNTIME_BLOCKING_DAEMON_GRACE_MS,
  DEFAULT_RUNTIME_HEARTBEAT_INTERVAL_MS,
  DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS,
  DEFAULT_RUNTIME_MAX_WALL_TIME_MS,
  DEFAULT_RUNTIME_OUTPUT_LINES,
} from './constants.js';
import {
  clearRuntimeExitCode,
  clearRuntimeFailureRecord,
  readRuntimeExitCode,
  readRuntimeFailureRecord,
  readRuntimeSessionFile,
  writeRuntimeFailureRecord,
  isWaitingForLlm,
} from './runtimeFiles.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { enqueueEngineNotification } from './engineNotifications.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';
import { WorktreeManager } from './worktreeManager.js';
import {
  detectCredentialPrompt,
  detectSmartDefault,
  findMatchingPrompt,
  getCredentialFromEnv,
  type PromptMatch,
} from './promptPatterns.js';

export interface ExecutorLoopContext {
  runtimeSessionId: string;
  pollMs?: number;
}

export interface ExecutorLoopResult {
  terminalStatus: 'done' | 'failed' | 'stuck';
  reason: string;
}

const BLOCKING_DAEMON_PATTERNS = [
  /\bwatch mode\b/i,
  /watching for file changes/i,
  /waiting for file changes/i,
  /press h \+ enter to show help/i,
  /\blocal:\s+https?:\/\//i,
  /\bnetwork:\s+https?:\/\//i,
  /\bready in \d+(?:\.\d+)?\s*(?:ms|s)\b/i,
];

function tailOutput(output: string | null, maxLines = 40) {
  if (!output) return null;
  return output
    .trim()
    .split('\n')
    .slice(-maxLines)
    .join('\n')
    .trim();
}

function normalizeTerminalLine(line: string) {
  return line.replace(/\s+/g, ' ').trim();
}

function findMatchingTerminalLine(output: string | null, patterns: RegExp[]) {
  if (!output) return null;

  const lines = output
    .split('\n')
    .map(normalizeTerminalLine)
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) {
      return line.length > 180 ? `${line.slice(0, 177)}...` : line;
    }
  }

  return null;
}

function getBlockingDaemonSummary(output: string | null) {
  const line = findMatchingTerminalLine(output, BLOCKING_DAEMON_PATTERNS);
  return line ? `Proceso bloqueante detectado: ${line}` : null;
}

export class ExecutorLoop {
  constructor(
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly sessionRepository = getRuntimeSessionRepository(),
    private readonly lockRepository = getRuntimeLockRepository(),
    private readonly blockingDaemonGraceMs = DEFAULT_RUNTIME_BLOCKING_DAEMON_GRACE_MS,
  ) {}

  private async cleanupTerminalSession(runtimeSessionId: string, worktreePath: string | null, removeWorkspace: boolean) {
    console.log(`[ExecutorLoop:${runtimeSessionId}] Cleaning up terminal session. Worktree: ${worktreePath}, remove: ${removeWorkspace}`);
    this.lockRepository.releaseForSession(runtimeSessionId);

    if (!worktreePath || !removeWorkspace) return;

    const manager = new WorktreeManager();
    if (manager.isManagedWorkspace(worktreePath)) {
      await manager.teardownWorkspacePath(worktreePath);
    }
  }

  async run(input: ExecutorLoopContext) {
    console.log(`[ExecutorLoop:${input.runtimeSessionId}] Started`);
    let lastOutput = '';
    let lastProgressAt = Date.now();
    let lastStatus: string | null = null;
    let blockingDaemonDetectedAt: number | null = null;
    let blockingDaemonSummary: string | null = null;
    let currentCommand: string | null = null;
    let promptRetryCount = 0;
    let lastPromptMatch: PromptMatch | null = null;

    try {
      for (;;) {
      const session = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      if (!session) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Session missing from DB, aborting.`);
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
      console.log(`[ExecutorLoop:${input.runtimeSessionId}] Polling... status=${session.status}, steps=${session.stepCount}, alive=${alive}`);
      
      const output = alive ? await this.tmuxRuntime.captureOutput(input.runtimeSessionId, DEFAULT_RUNTIME_OUTPUT_LINES) : '';
      const normalizedOutput = output.trim();

      if (lastStatus === 'failed' && session.status === 'running') {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Recovered from failed state, resetting progress timer`);
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
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Failure file detected: ${failure.kind}, marking session failed`);
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
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] New output detected, updating progress timer`);
        lastOutput = normalizedOutput;
        lastProgressAt = nowMs;
        this.sessionRepository.incrementStepCount({
          runtimeSessionId: input.runtimeSessionId,
          heartbeatAt: nowIso,
        });
      } else if (session.status === 'running' && session.worktreePath && isWaitingForLlm(session.worktreePath)) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Waiting for LLM detected via marker file, resetting progress timer`);
        lastProgressAt = nowMs;
      }

      const refreshedSession = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      if (!refreshedSession) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Session missing after heartbeat`);
        return {
          terminalStatus: 'failed',
          reason: 'session_missing_after_heartbeat',
        } satisfies ExecutorLoopResult;
      }

      const promptMatch: PromptMatch | null =
        refreshedSession.status === 'running' || refreshedSession.status === 'suspended_human_input'
          ? findMatchingPrompt(normalizedOutput)
          : null;

      if (refreshedSession.status === 'suspended_human_input') {
        if (!promptMatch) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Suspended but prompt gone, auto-resuming`);
          this.sessionRepository.resume({ runtimeSessionId: input.runtimeSessionId, heartbeatAt: nowIso });
          promptRetryCount = 0;
          lastPromptMatch = null;
        } else {
          const suspendedAt = refreshedSession.suspendedAt ? new Date(refreshedSession.suspendedAt) : null;
          if (suspendedAt && nowMs - suspendedAt.getTime() > 15 * 60 * 1000) {
            console.log(`[ExecutorLoop:${input.runtimeSessionId}] Suspended timeout exceeded, failing`);
            this.sessionRepository.fail({
              runtimeSessionId: input.runtimeSessionId,
              failureKind: 'human_suspend_timeout',
              failureSummary: `Suspended for more than 15 min: ${promptMatch.matchedLine}`,
              heartbeatAt: nowIso,
              finishedAt: nowIso,
            });
            await this.tmuxRuntime.killSession(input.runtimeSessionId);
            await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
            return { terminalStatus: 'failed', reason: 'human_suspend_timeout' } satisfies ExecutorLoopResult;
          }
        }
      } else if (promptMatch) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Interactive prompt detected: ${promptMatch.matchedLine}, tool=${promptMatch.tool}`);

        const credentialInfo = detectCredentialPrompt(normalizedOutput);

        if (credentialInfo && promptMatch.isCredential) {
          const envCredential = promptMatch.tool ? getCredentialFromEnv(promptMatch.tool) : null;
          if (envCredential) {
            console.log(`[ExecutorLoop:${input.runtimeSessionId}] Using credential from env for ${credentialInfo.tool}`);
            await this.tmuxRuntime.sendLiteral(input.runtimeSessionId, envCredential);
            lastProgressAt = nowMs;
            promptRetryCount = 0;
          } else {
            console.log(`[ExecutorLoop:${input.runtimeSessionId}] Credential prompt requires human input, suspending`);
            this.sessionRepository.suspend({
              runtimeSessionId: input.runtimeSessionId,
              suspendedReason: `${credentialInfo.type} prompt for ${credentialInfo.tool}: ${credentialInfo.matchedLine}`,
              heartbeatAt: nowIso,
            });
            enqueueEngineNotification({
              runtimeSessionId: input.runtimeSessionId,
              eventType: 'session.suspended_human_input',
              payload: {
                kind: 'credential_required',
                summary: `Credential required: ${credentialInfo.type} for ${credentialInfo.tool}`,
                prompt: credentialInfo.matchedLine,
                hint: 'Set the credential via environment variable or resolve directly in tmux.',
              },
            });
            lastProgressAt = nowMs;
          }
        } else if (promptRetryCount === 0) {
          promptRetryCount = 1;
        }

        if (promptRetryCount > 0 && promptRetryCount < 3 && !credentialInfo) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Auto-responding to prompt, attempt ${promptRetryCount}/3`);

          let response = promptMatch.response;

          if (promptRetryCount === 1) {
            const smartResponse = detectSmartDefault(promptMatch.matchedLine);
            if (smartResponse !== 'y') {
              response = smartResponse;
              console.log(`[ExecutorLoop:${input.runtimeSessionId}] Smart response: ${response}`);
            }
          } else if (promptRetryCount === 2) {
            response = promptMatch.response;
          }

          if (promptRetryCount > 0 && promptRetryCount <= 2) {
            await this.tmuxRuntime.sendLiteral(input.runtimeSessionId, response);
          }

          if (promptRetryCount < 3) {
            promptRetryCount++;
          }

          lastPromptMatch = promptMatch;
          lastProgressAt = nowMs;
        } else if (promptRetryCount >= 3 && !credentialInfo) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] All retry attempts exhausted, failing`);
          const failureLogTail = tailOutput(normalizedOutput);
          if (refreshedSession.worktreePath) {
            writeRuntimeFailureRecord(refreshedSession.worktreePath, {
              runtimeSessionId: input.runtimeSessionId,
              kind: 'interactive_prompt_unresolved',
              summary: `Prompt unresolved after 3 attempts: ${promptMatch.matchedLine}`,
              logTail: failureLogTail,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
          this.sessionRepository.fail({
            runtimeSessionId: input.runtimeSessionId,
            failureKind: 'interactive_prompt_unresolved',
            failureSummary: `Prompt unresolved after 3 attempts: ${promptMatch.matchedLine}`,
            ...(failureLogTail ? { failureLogTail } : {}),
            heartbeatAt: nowIso,
            finishedAt: nowIso,
          });
          enqueueEngineNotification({
            runtimeSessionId: input.runtimeSessionId,
            eventType: 'session.interactive_blocked',
            payload: {
              kind: 'interactive_prompt_unresolved',
              summary: promptMatch.matchedLine,
              hint: 'Revisa el comando y relanza con resume/manual triage.',
            },
          });
          await this.tmuxRuntime.killSession(input.runtimeSessionId);
          await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
          return { terminalStatus: 'failed', reason: 'interactive_prompt_unresolved' } satisfies ExecutorLoopResult;
        }
      } else {
        if (promptRetryCount > 0) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Prompt no longer present, resetting retry state`);
        }
        promptRetryCount = 0;
        lastPromptMatch = null;
      }

      const blockingDaemonSummaryCandidate =
        refreshedSession.status === 'running' ? getBlockingDaemonSummary(normalizedOutput) : null;
      if (blockingDaemonSummaryCandidate) {
        if (blockingDaemonDetectedAt === null) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Blocking daemon candidate detected: ${blockingDaemonSummaryCandidate}`);
        }
        blockingDaemonDetectedAt ??= nowMs;
        blockingDaemonSummary = blockingDaemonSummaryCandidate;
      } else {
        blockingDaemonDetectedAt = null;
        blockingDaemonSummary = null;
      }

      if (
        refreshedSession.status === 'running' &&
        blockingDaemonDetectedAt !== null &&
        blockingDaemonSummary &&
        nowMs - blockingDaemonDetectedAt >= this.blockingDaemonGraceMs
      ) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Blocking daemon confirmed after grace period`);
        const failureLogTail = tailOutput(normalizedOutput);
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'blocked_daemon_detected',
            summary: blockingDaemonSummary,
            logTail: failureLogTail,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        this.sessionRepository.fail({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: 'blocked_daemon_detected',
          failureSummary: blockingDaemonSummary,
          ...(failureLogTail ? { failureLogTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
        enqueueEngineNotification({
          runtimeSessionId: input.runtimeSessionId,
          eventType: 'session.interactive_blocked',
          payload: {
            kind: 'blocked_daemon_detected',
            summary: blockingDaemonSummary,
            hint: 'No lances watchers, dev servers ni procesos persistentes.',
          },
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'failed', reason: 'blocked_daemon_detected' } satisfies ExecutorLoopResult;
      }

      if (refreshedSession.maxSteps && refreshedSession.stepCount >= refreshedSession.maxSteps) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Max steps exceeded (${refreshedSession.stepCount} >= ${refreshedSession.maxSteps})`);
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
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Max wall time exceeded`);
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
        enqueueEngineNotification({
          runtimeSessionId: input.runtimeSessionId,
          eventType: 'session.timeout',
          payload: {
            kind: 'max_wall_time_exceeded',
            summary,
            hint: 'La sesion agotó el wall time. Revisa progreso y decide resume/manual triage.',
          },
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'stuck', reason: 'max_wall_time_exceeded' } satisfies ExecutorLoopResult;
      }

      if (refreshedSession.status === 'running' && nowMs - lastProgressAt > maxCommandTimeMs) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Max command time exceeded (${nowMs - lastProgressAt}ms > ${maxCommandTimeMs}ms)`);
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
        enqueueEngineNotification({
          runtimeSessionId: input.runtimeSessionId,
          eventType: 'session.timeout',
          payload: {
            kind: 'max_command_time_exceeded',
            summary,
            hint: 'No hubo progreso util dentro del timeout de comando.',
          },
        });
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'failed', reason: 'max_command_time_exceeded' } satisfies ExecutorLoopResult;
      }

      if (!alive) {
        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Tmux session is no longer alive`);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, false);
        const processExitCode = refreshedSession.worktreePath
          ? readRuntimeExitCode(refreshedSession.worktreePath)
          : null;
        if (failure) {
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Exited with failure: ${failure.kind}`);
          if (refreshedSession.worktreePath) {
            clearRuntimeExitCode(refreshedSession.worktreePath);
          }
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
          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Exited but was already marked failed`);
          if (refreshedSession.worktreePath) {
            clearRuntimeExitCode(refreshedSession.worktreePath);
          }
          return { terminalStatus: 'failed', reason: refreshedSession.failureKind || 'failed' } satisfies ExecutorLoopResult;
        }

        if (refreshedSession.status === 'running') {
          if (processExitCode === 0) {
            console.log(`[ExecutorLoop:${input.runtimeSessionId}] Clean exit via exit code file`);
            if (refreshedSession.worktreePath) {
              clearRuntimeFailureRecord(refreshedSession.worktreePath);
              clearRuntimeExitCode(refreshedSession.worktreePath);
            }
            this.sessionRepository.finish({
              runtimeSessionId: input.runtimeSessionId,
              status: 'done',
              heartbeatAt: nowIso,
              finishedAt: nowIso,
            });
            return { terminalStatus: 'done', reason: 'process_exited' } satisfies ExecutorLoopResult;
          }

          if (typeof processExitCode === 'number') {
            const summary = `Proceso terminó con exit_code=${processExitCode} sin failure record`;
            if (refreshedSession.worktreePath) {
              writeRuntimeFailureRecord(refreshedSession.worktreePath, {
                runtimeSessionId: input.runtimeSessionId,
                kind: 'process_exit_nonzero',
                summary,
                logTail: tailOutput(normalizedOutput),
                createdAt: nowIso,
                updatedAt: nowIso,
              });
              clearRuntimeExitCode(refreshedSession.worktreePath);
            }
            this.sessionRepository.fail({
              runtimeSessionId: input.runtimeSessionId,
              failureKind: 'process_exit_nonzero',
              failureSummary: summary,
              heartbeatAt: nowIso,
              finishedAt: nowIso,
            });
            return { terminalStatus: 'failed', reason: 'process_exit_nonzero' } satisfies ExecutorLoopResult;
          }

          console.log(`[ExecutorLoop:${input.runtimeSessionId}] Silent exit detected`);
          const summary = `Sesión marcada running pero tmux murió sin failure record`;
          if (refreshedSession.worktreePath) {
            writeRuntimeFailureRecord(refreshedSession.worktreePath, {
              runtimeSessionId: input.runtimeSessionId,
              kind: 'silent_exit',
              summary,
              logTail: tailOutput(normalizedOutput),
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
          this.sessionRepository.markStuck({
            runtimeSessionId: input.runtimeSessionId,
            failureKind: 'silent_exit',
            failureSummary: summary,
            heartbeatAt: nowIso,
            finishedAt: nowIso,
          });
          return { terminalStatus: 'stuck', reason: 'silent_exit' } satisfies ExecutorLoopResult;
        }

        console.log(`[ExecutorLoop:${input.runtimeSessionId}] Clean exit`);
        if (refreshedSession.worktreePath) {
          clearRuntimeFailureRecord(refreshedSession.worktreePath);
          clearRuntimeExitCode(refreshedSession.worktreePath);
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
    } finally {
      console.log(`[ExecutorLoop:${input.runtimeSessionId}] Loop exiting, performing final cleanup`);
      const session = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      await this.cleanupTerminalSession(input.runtimeSessionId, session?.worktreePath ?? null, false);
    }
  }
}
