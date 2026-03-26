import { setTimeout as sleep } from 'timers/promises';
import {
  DEFAULT_RUNTIME_BLOCKING_DAEMON_GRACE_MS,
  DEFAULT_RUNTIME_HEARTBEAT_INTERVAL_MS,
  RUNTIME_EXIT_CODE_FILE_NAME,
  RUNTIME_SESSION_FILE_NAME,
  DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS,
  DEFAULT_RUNTIME_MAX_WALL_TIME_MS,
  DEFAULT_RUNTIME_OUTPUT_LINES,
} from '../domain/constants.js';
import {
  clearRuntimeExitCode,
  clearRuntimeFailureRecord,
  readRuntimeExitCode,
  readRuntimeFailureRecord,
  readRuntimeSessionFile,
  updateRuntimeSessionFile,
  writeRuntimeFailureRecord,
  isWaitingForLlm,
  type RuntimeFailureRecord,
} from './runtimeFiles.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { enqueueEngineNotification } from '../services/EventBus.js';
import { getRuntimeSessionRepository, type RuntimeSessionRecord } from './runtimeSessionRepository.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';
import {
  detectCredentialPrompt,
  detectSmartDefault,
  findMatchingPrompt,
  getCredentialFromEnv,
  type PromptMatch,
} from './promptPatterns.js';
import { getSessionChat } from './sessionChatService.js';
import { resumeRuntimeSession } from './resume.js';
import { syncRuntimeTaskLink } from './runtimeTaskLinking.js';
import type { RalphitoTaskStatus } from '../services/taskStateService.js';

export interface SessionLoopContext {
  runtimeSessionId: string;
  pollMs?: number;
}

export interface SessionLoopResult {
  terminalStatus: 'done' | 'failed' | 'stuck';
  reason: string;
}

interface LandingVerificationResult {
  ok: boolean;
  summary: string | null;
  reasonCode: string | null;
}

type LandingFailureReasonCode =
  | 'missing_worktree'
  | 'dirty_worktree'
  | 'missing_upstream'
  | 'invalid_upstream'
  | 'missing_remote_branch'
  | 'no_new_commit'
  | 'verification_error';

const BLOCKING_DAEMON_PATTERNS = [
  /\bwatch mode\b/i,
  /watching for file changes/i,
  /waiting for file changes/i,
  /press h \+ enter to show help/i,
  /\blocal:\s+https?:\/\//i,
  /\bnetwork:\s+https?:\/\//i,
  /\bready in \d+(?:\.\d+)?\s*(?:ms|s)\b/i,
];

const AUTO_RESUME_FAILURE_KINDS = new Set([
  'typescript_guardrail_failed',
  'lint_guardrail_failed',
  'test_guardrail_failed',
  'rebase_failed',
]);
const MAX_AUTO_RESUME_ATTEMPTS_PER_FAILURE = 2;

function formatGuardrailLabel(failureKind: string) {
  switch (failureKind) {
    case 'typescript_guardrail_failed':
      return 'TypeScript';
    case 'lint_guardrail_failed':
      return 'Lint';
    case 'test_guardrail_failed':
      return 'Tests';
    case 'rebase_failed':
      return 'Rebase';
    default:
      return failureKind;
  }
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

const ALLOWED_UNTRACKED_RUNTIME_FILES = new Set([
  RUNTIME_EXIT_CODE_FILE_NAME,
  RUNTIME_SESSION_FILE_NAME,
]);

function normalizeStatusPath(rawPath: string) {
  const trimmed = rawPath.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
  return trimmed.slice(1, -1);
}

function filterRelevantGitStatusLines(statusOutput: string) {
  return statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      if (!line.startsWith('?? ')) return true;
      const path = normalizeStatusPath(line.slice(3));
      return !ALLOWED_UNTRACKED_RUNTIME_FILES.has(path);
    });
}

function summarizeGitStatusLines(lines: string[], maxLines = 2) {
  const visibleLines = lines.slice(0, maxLines);
  const remainder = lines.length - visibleLines.length;
  const suffix = remainder > 0 ? `; +${remainder} mas` : '';
  return `${visibleLines.join('; ')}${suffix}`;
}

export class SessionLoop {
  constructor(
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly sessionRepository = getRuntimeSessionRepository(),
    private readonly lockRepository = getRuntimeLockRepository(),
    private readonly blockingDaemonGraceMs = DEFAULT_RUNTIME_BLOCKING_DAEMON_GRACE_MS,
    private readonly commandRunner = new CommandRunner(),
  ) {}

  private async verifyLanding(worktreePath: string | null, baseCommitHash: string | null, branchName: string | null) {
    if (!worktreePath) {
      return {
        ok: false,
        summary: 'Proceso salió 0 pero falta worktree para validar landing.',
        reasonCode: 'missing_worktree' satisfies LandingFailureReasonCode,
      } satisfies LandingVerificationResult;
    }

    try {
      const [{ stdout: currentHead }, { stdout: statusOutput }] = await Promise.all([
        this.commandRunner.run('git', ['rev-parse', 'HEAD'], { cwd: worktreePath }),
        this.commandRunner.run('git', ['status', '--short'], { cwd: worktreePath }),
      ]);

      let upstreamRef = '';
      try {
        const { stdout } = await this.commandRunner.run(
          'git',
          ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
          { cwd: worktreePath },
        );
        upstreamRef = stdout.trim();
      } catch {
        upstreamRef = '';
      }

      const relevantStatusLines = filterRelevantGitStatusLines(statusOutput);
      if (relevantStatusLines.length > 0) {
        return {
          ok: false,
          summary: `Proceso salió 0 pero el worktree quedó sucio: ${summarizeGitStatusLines(relevantStatusLines)}. Faltó finish_task.`,
          reasonCode: 'dirty_worktree' satisfies LandingFailureReasonCode,
        } satisfies LandingVerificationResult;
      }

      if (!upstreamRef) {
        return {
          ok: false,
          summary: `Proceso salió 0 pero la rama ${branchName || '(sin rama)'} no quedó pusheada.`,
          reasonCode: 'missing_upstream' satisfies LandingFailureReasonCode,
        } satisfies LandingVerificationResult;
      }

      const upstreamSeparator = upstreamRef.indexOf('/');
      const upstreamRemote = upstreamSeparator > 0 ? upstreamRef.slice(0, upstreamSeparator) : '';
      const upstreamBranch = upstreamSeparator > 0 ? upstreamRef.slice(upstreamSeparator + 1) : '';

      if (!upstreamRemote || !upstreamBranch) {
        return {
          ok: false,
          summary: `Proceso salió 0 pero upstream=${upstreamRef} es inválido.`,
          reasonCode: 'invalid_upstream' satisfies LandingFailureReasonCode,
        } satisfies LandingVerificationResult;
      }

      try {
        await this.commandRunner.run(
          'git',
          ['ls-remote', '--exit-code', '--heads', upstreamRemote, upstreamBranch],
          { cwd: worktreePath },
        );
      } catch {
        return {
          ok: false,
          summary: `Proceso salió 0 pero la rama ${branchName || upstreamBranch} no existe en remoto.`,
          reasonCode: 'missing_remote_branch' satisfies LandingFailureReasonCode,
        } satisfies LandingVerificationResult;
      }

      if (baseCommitHash && currentHead.trim() === baseCommitHash) {
        return {
          ok: false,
          summary: `Proceso salió 0 pero la rama ${branchName || '(sin rama)'} no generó commit nuevo.`,
          reasonCode: 'no_new_commit' satisfies LandingFailureReasonCode,
        } satisfies LandingVerificationResult;
      }

      return { ok: true, summary: null, reasonCode: null } satisfies LandingVerificationResult;
    } catch (error) {
      return {
        ok: false,
        summary: `Proceso salió 0 pero falló la validación de landing: ${error instanceof Error ? error.message : String(error)}`,
        reasonCode: 'verification_error' satisfies LandingFailureReasonCode,
      } satisfies LandingVerificationResult;
    }
  }

  private syncTaskStatus(session: RuntimeSessionRecord, status: RalphitoTaskStatus, failureReason?: string | null) {
    const sessionFile = session.worktreePath ? readRuntimeSessionFile(session.worktreePath) : null;
    syncRuntimeTaskLink({
      runtimeSessionId: session.runtimeSessionId,
      projectId: sessionFile?.projectId ?? session.agentId,
      workItemKey: sessionFile?.workItemKey ?? null,
      beadPath: sessionFile?.beadPath ?? null,
      assignedAgent: session.agentId,
      status,
      ...(failureReason ? { failureReason } : {}),
    });
  }

  private async finalizeDoneSession(
    input: SessionLoopContext,
    session: RuntimeSessionRecord,
    branchName: string | null,
    output: string | null,
    nowIso: string,
    alive: boolean,
  ) {
    const failureLogTail = tailOutput(output);
    const landing = await this.verifyLanding(
      session.worktreePath,
      session.baseCommitHash,
      branchName,
    );

    if (!landing.ok) {
      if (session.worktreePath) {
        writeRuntimeFailureRecord(session.worktreePath, {
          runtimeSessionId: input.runtimeSessionId,
          kind: 'landing_not_completed',
          summary: landing.summary || 'Proceso salió 0 sin landing verificable.',
          reasonCode: landing.reasonCode,
          logTail: failureLogTail,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        clearRuntimeExitCode(session.worktreePath);
      }

      this.sessionRepository.fail({
        runtimeSessionId: input.runtimeSessionId,
        failureKind: 'landing_not_completed',
        failureSummary: landing.summary || 'Proceso salió 0 sin landing verificable.',
        failureReasonCode: landing.reasonCode,
        ...(failureLogTail ? { failureLogTail } : {}),
        heartbeatAt: nowIso,
        finishedAt: nowIso,
      });

      if (alive) {
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
      }
      await this.cleanupTerminalSession(input.runtimeSessionId, session.worktreePath, false);
      this.syncTaskStatus(session, 'failed', landing.summary || 'landing_not_completed');
      return { terminalStatus: 'failed', reason: 'landing_not_completed' } satisfies SessionLoopResult;
    }

    if (alive) {
      await this.tmuxRuntime.killSession(input.runtimeSessionId);
    }

    const sessionChat = getSessionChat(input.runtimeSessionId);

    if (session.worktreePath) {
      clearRuntimeFailureRecord(session.worktreePath);
      clearRuntimeExitCode(session.worktreePath);
    }

    this.sessionRepository.finish({
      runtimeSessionId: input.runtimeSessionId,
      status: 'done',
      heartbeatAt: nowIso,
      finishedAt: nowIso,
    });
    this.syncTaskStatus(session, 'done');
    enqueueEngineNotification({
      runtimeSessionId: input.runtimeSessionId,
      eventType: 'session.synced',
      payload: {
        beadId: sessionChat.beadId,
        title: sessionChat.title,
        branchName: branchName || sessionChat.branchName,
        prUrl: null,
      },
      ...(sessionChat.externalChatId ? { targetChatId: sessionChat.externalChatId } : {}),
    });
    await this.cleanupTerminalSession(input.runtimeSessionId, session.worktreePath, true);

    return {
      terminalStatus: 'done',
      reason: session.status === 'done' ? 'landing_completed' : 'process_exited',
    } satisfies SessionLoopResult;
  }

  private async tryAutoResumeFailure(
    input: SessionLoopContext,
    session: RuntimeSessionRecord,
    failure: RuntimeFailureRecord,
  ) {
    if (!session.worktreePath) return false;
    if (!AUTO_RESUME_FAILURE_KINDS.has(failure.kind)) return false;

    const sessionFile = readRuntimeSessionFile(session.worktreePath);
    if (!sessionFile) return false;

    const attempts = sessionFile.autoResumeAttempts?.[failure.kind] || 0;
    if (attempts >= MAX_AUTO_RESUME_ATTEMPTS_PER_FAILURE) {
      return false;
    }

    updateRuntimeSessionFile(session.worktreePath, {
      autoResumeAttempts: {
        ...(sessionFile.autoResumeAttempts || {}),
        [failure.kind]: attempts + 1,
      },
    });

    await resumeRuntimeSession(input.runtimeSessionId, this.tmuxRuntime, this.commandRunner, { spawnLoop: false });
    return true;
  }

  private notifyTerminalGuardrailFailure(session: RuntimeSessionRecord, failure: RuntimeFailureRecord) {
    if (!session.worktreePath) return;

    const sessionFile = readRuntimeSessionFile(session.worktreePath);
    const attempts = sessionFile?.autoResumeAttempts?.[failure.kind] || 0;
    const retryPolicy = AUTO_RESUME_FAILURE_KINDS.has(failure.kind)
      ? attempts >= MAX_AUTO_RESUME_ATTEMPTS_PER_FAILURE
        ? `Auto-resume agotado tras ${attempts}/${MAX_AUTO_RESUME_ATTEMPTS_PER_FAILURE} intentos.`
        : `Sin auto-resume aplicado. Intentos consumidos: ${attempts}/${MAX_AUTO_RESUME_ATTEMPTS_PER_FAILURE}.`
      : 'Fallo no auto-reintentable.';
    const sessionChat = getSessionChat(session.runtimeSessionId);

    enqueueEngineNotification({
      runtimeSessionId: session.runtimeSessionId,
      eventType: 'session.guardrail_failed',
      payload: {
        guardrail: formatGuardrailLabel(failure.kind),
        beadId: sessionChat.beadId,
        title: sessionChat.title,
        summary: `${retryPolicy} ${failure.summary}`.trim(),
        snippet: failure.logTail || failure.summary,
      },
      ...(sessionChat.externalChatId ? { targetChatId: sessionChat.externalChatId } : {}),
    });
  }

  private async cleanupTerminalSession(runtimeSessionId: string, worktreePath: string | null, removeWorkspace: boolean) {
    console.log(`[SessionLoop:${runtimeSessionId}] Cleaning up terminal session. Worktree: ${worktreePath}, remove: ${removeWorkspace}`);
    this.lockRepository.releaseForSession(runtimeSessionId);

    if (!worktreePath || !removeWorkspace) return;

      const manager = new WorktreeManager(process.cwd(), process.env.RALPHITO_WORKTREE_ROOT || undefined);
    if (manager.isManagedWorkspace(worktreePath)) {
      await manager.teardownWorkspacePath(worktreePath);
    }
  }

  async run(input: SessionLoopContext) {
    console.log(`[SessionLoop:${input.runtimeSessionId}] Started`);
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
          console.log(`[SessionLoop:${input.runtimeSessionId}] Session missing from DB, aborting.`);
        return {
          terminalStatus: 'failed',
          reason: 'session_missing',
        } satisfies SessionLoopResult;
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
      console.log(`[SessionLoop:${input.runtimeSessionId}] Polling... status=${session.status}, steps=${session.stepCount}, alive=${alive}`);
      
      const output = alive ? await this.tmuxRuntime.captureOutput(input.runtimeSessionId, DEFAULT_RUNTIME_OUTPUT_LINES) : '';
      const normalizedOutput = output.trim();

      if (lastStatus === 'failed' && session.status === 'running') {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Recovered from failed state, resetting progress timer`);
        lastProgressAt = nowMs;
      }
      lastStatus = session.status;

      this.sessionRepository.heartbeat({
        runtimeSessionId: input.runtimeSessionId,
        heartbeatAt: nowIso,
        ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
        ...(typeof sessionMaxSteps === 'number' ? { maxSteps: sessionMaxSteps } : {}),
      });
      this.lockRepository.heartbeat({
        runtimeSessionId: input.runtimeSessionId,
        heartbeatAt: nowIso,
      });

      if (failure && session.status !== 'failed') {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Failure file detected: ${failure.kind}, marking session failed`);
        this.sessionRepository.fail({
          runtimeSessionId: input.runtimeSessionId,
          failureKind: failure.kind,
          failureSummary: failure.summary,
          failureReasonCode: failure.reasonCode,
          ...(failure.logTail ? { failureLogTail: failure.logTail } : {}),
          heartbeatAt: nowIso,
          finishedAt: nowIso,
        });
      }

      if (session.status === 'running' && normalizedOutput && normalizedOutput !== lastOutput) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] New output detected, updating progress timer`);
        lastOutput = normalizedOutput;
        lastProgressAt = nowMs;
        this.sessionRepository.incrementStepCount({
          runtimeSessionId: input.runtimeSessionId,
          heartbeatAt: nowIso,
        });
      } else if (session.status === 'running' && session.worktreePath && isWaitingForLlm(session.worktreePath)) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Waiting for LLM detected via marker file, resetting progress timer`);
        lastProgressAt = nowMs;
      }

      const refreshedSession = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      if (!refreshedSession) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Session missing after heartbeat`);
        return {
          terminalStatus: 'failed',
          reason: 'session_missing_after_heartbeat',
        } satisfies SessionLoopResult;
      }

      const processExitCode = refreshedSession.worktreePath
        ? readRuntimeExitCode(refreshedSession.worktreePath)
        : null;

      if (refreshedSession.status === 'done') {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Session already marked done, validating landing`);
        return this.finalizeDoneSession(
          input,
          refreshedSession,
          sessionFile?.branchName || null,
          normalizedOutput,
          nowIso,
          alive,
        );
      }

      if (refreshedSession.status === 'running' && processExitCode === 0 && alive) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Exit code 0 detected while tmux is still alive, finalizing landing`);
        return this.finalizeDoneSession(
          input,
          refreshedSession,
          sessionFile?.branchName || null,
          normalizedOutput,
          nowIso,
          alive,
        );
      }

      const promptMatch: PromptMatch | null =
        refreshedSession.status === 'running' || refreshedSession.status === 'suspended_human_input'
          ? findMatchingPrompt(normalizedOutput)
          : null;

      if (refreshedSession.status === 'suspended_human_input') {
        if (!promptMatch) {
          console.log(`[SessionLoop:${input.runtimeSessionId}] Suspended but prompt gone, auto-resuming`);
          this.sessionRepository.resume({ runtimeSessionId: input.runtimeSessionId, heartbeatAt: nowIso });
          promptRetryCount = 0;
          lastPromptMatch = null;
        } else {
          const suspendedAt = refreshedSession.suspendedAt ? new Date(refreshedSession.suspendedAt) : null;
          if (suspendedAt && nowMs - suspendedAt.getTime() > 15 * 60 * 1000) {
            console.log(`[SessionLoop:${input.runtimeSessionId}] Suspended timeout exceeded, failing`);
            this.sessionRepository.fail({
              runtimeSessionId: input.runtimeSessionId,
              failureKind: 'human_suspend_timeout',
              failureSummary: `Suspended for more than 15 min: ${promptMatch.matchedLine}`,
              heartbeatAt: nowIso,
              finishedAt: nowIso,
            });
            this.syncTaskStatus(refreshedSession, 'failed', `Suspended for more than 15 min: ${promptMatch.matchedLine}`);
            await this.tmuxRuntime.killSession(input.runtimeSessionId);
            await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
            return { terminalStatus: 'failed', reason: 'human_suspend_timeout' } satisfies SessionLoopResult;
          }
        }
      } else if (promptMatch) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Interactive prompt detected: ${promptMatch.matchedLine}, tool=${promptMatch.tool}`);

        const credentialInfo = detectCredentialPrompt(normalizedOutput);

        if (credentialInfo && promptMatch.isCredential) {
          const envCredential = promptMatch.tool ? getCredentialFromEnv(promptMatch.tool) : null;
          if (envCredential) {
            console.log(`[SessionLoop:${input.runtimeSessionId}] Using credential from env for ${credentialInfo.tool}`);
            await this.tmuxRuntime.sendLiteral(input.runtimeSessionId, envCredential);
            lastProgressAt = nowMs;
            promptRetryCount = 0;
          } else {
            console.log(`[SessionLoop:${input.runtimeSessionId}] Credential prompt requires human input, suspending`);
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
          console.log(`[SessionLoop:${input.runtimeSessionId}] Auto-responding to prompt, attempt ${promptRetryCount}/3`);

          let response = promptMatch.response;

          if (promptRetryCount === 1) {
            const smartResponse = detectSmartDefault(promptMatch.matchedLine);
            if (smartResponse !== 'y') {
              response = smartResponse;
              console.log(`[SessionLoop:${input.runtimeSessionId}] Smart response: ${response}`);
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
          console.log(`[SessionLoop:${input.runtimeSessionId}] All retry attempts exhausted, failing`);
          const failureLogTail = tailOutput(normalizedOutput);
          if (refreshedSession.worktreePath) {
            writeRuntimeFailureRecord(refreshedSession.worktreePath, {
              runtimeSessionId: input.runtimeSessionId,
              kind: 'interactive_prompt_unresolved',
              summary: `Prompt unresolved after 3 attempts: ${promptMatch.matchedLine}`,
              reasonCode: null,
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
          this.syncTaskStatus(refreshedSession, 'failed', `Prompt unresolved after 3 attempts: ${promptMatch.matchedLine}`);
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
          return { terminalStatus: 'failed', reason: 'interactive_prompt_unresolved' } satisfies SessionLoopResult;
        }
      } else {
        if (promptRetryCount > 0) {
          console.log(`[SessionLoop:${input.runtimeSessionId}] Prompt no longer present, resetting retry state`);
        }
        promptRetryCount = 0;
        lastPromptMatch = null;
      }

      const blockingDaemonSummaryCandidate =
        refreshedSession.status === 'running' ? getBlockingDaemonSummary(normalizedOutput) : null;
      if (blockingDaemonSummaryCandidate) {
        if (blockingDaemonDetectedAt === null) {
          console.log(`[SessionLoop:${input.runtimeSessionId}] Blocking daemon candidate detected: ${blockingDaemonSummaryCandidate}`);
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
        console.log(`[SessionLoop:${input.runtimeSessionId}] Blocking daemon confirmed after grace period`);
        const failureLogTail = tailOutput(normalizedOutput);
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'blocked_daemon_detected',
            summary: blockingDaemonSummary,
            reasonCode: null,
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
        this.syncTaskStatus(refreshedSession, 'failed', blockingDaemonSummary);
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
        return { terminalStatus: 'failed', reason: 'blocked_daemon_detected' } satisfies SessionLoopResult;
      }

      if (refreshedSession.maxSteps && refreshedSession.stepCount >= refreshedSession.maxSteps) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Max steps exceeded (${refreshedSession.stepCount} >= ${refreshedSession.maxSteps})`);
        const summary = `Se excedio max_steps=${refreshedSession.maxSteps}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_steps_exceeded',
            summary,
            reasonCode: null,
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
        this.syncTaskStatus(refreshedSession, 'failed', summary);
        await this.tmuxRuntime.killSession(input.runtimeSessionId);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, true);
        return { terminalStatus: 'failed', reason: 'max_steps_exceeded' } satisfies SessionLoopResult;
      }

      if (nowMs - startedAtMs > maxWallTimeMs) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Max wall time exceeded`);
        const summary = `Se excedio max_wall_time_ms=${maxWallTimeMs}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_wall_time_exceeded',
            summary,
            reasonCode: null,
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
        this.syncTaskStatus(refreshedSession, 'failed', summary);
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
        return { terminalStatus: 'stuck', reason: 'max_wall_time_exceeded' } satisfies SessionLoopResult;
      }

      if (refreshedSession.status === 'running' && nowMs - lastProgressAt > maxCommandTimeMs) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Max command time exceeded (${nowMs - lastProgressAt}ms > ${maxCommandTimeMs}ms)`);
        const summary = `Se excedio max_command_time_ms=${maxCommandTimeMs}`;
        if (refreshedSession.worktreePath) {
          writeRuntimeFailureRecord(refreshedSession.worktreePath, {
            runtimeSessionId: input.runtimeSessionId,
            kind: 'max_command_time_exceeded',
            summary,
            reasonCode: null,
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
        this.syncTaskStatus(refreshedSession, 'failed', summary);
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
        return { terminalStatus: 'failed', reason: 'max_command_time_exceeded' } satisfies SessionLoopResult;
      }

      if (!alive) {
        console.log(`[SessionLoop:${input.runtimeSessionId}] Tmux session is no longer alive`);
        await this.cleanupTerminalSession(input.runtimeSessionId, refreshedSession.worktreePath, false);
        if (failure) {
          console.log(`[SessionLoop:${input.runtimeSessionId}] Exited with failure: ${failure.kind}`);
          if (refreshedSession.worktreePath) {
            clearRuntimeExitCode(refreshedSession.worktreePath);
          }
          this.sessionRepository.fail({
            runtimeSessionId: input.runtimeSessionId,
            failureKind: failure.kind,
            failureSummary: failure.summary,
            failureReasonCode: failure.reasonCode,
            ...(failure.logTail ? { failureLogTail: failure.logTail } : {}),
            heartbeatAt: nowIso,
            finishedAt: nowIso,
          });
          if (await this.tryAutoResumeFailure(input, refreshedSession, failure)) {
            console.log(`[SessionLoop:${input.runtimeSessionId}] Auto-resume triggered for failure=${failure.kind}`);
            lastOutput = '';
            lastProgressAt = nowMs;
            lastStatus = 'running';
            blockingDaemonDetectedAt = null;
            blockingDaemonSummary = null;
            currentCommand = null;
            promptRetryCount = 0;
            lastPromptMatch = null;
            continue;
          }
          if (failure.kind.endsWith('_guardrail_failed') || failure.kind === 'rebase_failed') {
            this.notifyTerminalGuardrailFailure(refreshedSession, failure);
          }
          this.syncTaskStatus(refreshedSession, 'failed', failure.summary);
          return { terminalStatus: 'failed', reason: failure.kind } satisfies SessionLoopResult;
        }

        if (refreshedSession.status === 'failed') {
          console.log(`[SessionLoop:${input.runtimeSessionId}] Exited but was already marked failed`);
          if (refreshedSession.worktreePath) {
            clearRuntimeExitCode(refreshedSession.worktreePath);
          }
          return { terminalStatus: 'failed', reason: refreshedSession.failureKind || 'failed' } satisfies SessionLoopResult;
        }

        if (refreshedSession.status === 'running') {
          if (processExitCode === 0) {
            console.log(`[SessionLoop:${input.runtimeSessionId}] Clean exit via exit code file`);
            return this.finalizeDoneSession(
              input,
              refreshedSession,
              sessionFile?.branchName || null,
              normalizedOutput,
              nowIso,
              false,
            );
          }

          if (typeof processExitCode === 'number') {
            const summary = `Proceso terminó con exit_code=${processExitCode} sin failure record`;
            if (refreshedSession.worktreePath) {
              writeRuntimeFailureRecord(refreshedSession.worktreePath, {
                runtimeSessionId: input.runtimeSessionId,
                kind: 'process_exit_nonzero',
                summary,
                reasonCode: null,
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
            this.syncTaskStatus(refreshedSession, 'failed', summary);
            return { terminalStatus: 'failed', reason: 'process_exit_nonzero' } satisfies SessionLoopResult;
          }

          console.log(`[SessionLoop:${input.runtimeSessionId}] Silent exit detected`);
          const summary = `Sesión marcada running pero tmux murió sin failure record`;
          if (refreshedSession.worktreePath) {
            writeRuntimeFailureRecord(refreshedSession.worktreePath, {
              runtimeSessionId: input.runtimeSessionId,
              kind: 'silent_exit',
              summary,
              reasonCode: null,
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
          this.syncTaskStatus(refreshedSession, 'failed', summary);
          return { terminalStatus: 'stuck', reason: 'silent_exit' } satisfies SessionLoopResult;
        }

        console.log(`[SessionLoop:${input.runtimeSessionId}] Clean exit`);
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
        this.syncTaskStatus(refreshedSession, 'done');
        return { terminalStatus: 'done', reason: 'process_exited' } satisfies SessionLoopResult;
      }

      await sleep(input.pollMs ?? DEFAULT_RUNTIME_HEARTBEAT_INTERVAL_MS);
    }
    } finally {
      console.log(`[SessionLoop:${input.runtimeSessionId}] Loop exiting, performing final cleanup`);
      const session = this.sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
      await this.cleanupTerminalSession(input.runtimeSessionId, session?.worktreePath ?? null, false);
    }
  }
}
