import { existsSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { readFile } from 'fs/promises';
import { getRuntimeSessionRepository } from '../../../core/engine/runtimeSessionRepository.js';
import {
  clearRuntimeFailureRecord,
  getGuardrailLogPath,
  readRuntimeSessionFile,
  writeRuntimeFailureRecord,
} from '../../../core/engine/runtimeFiles.js';
import { getSessionChat } from '../../../core/engine/sessionChatService.js';
import { enqueueEngineNotification } from '../../../core/services/EventBus.js';
import { CommandRunner } from '../../../infrastructure/runtime/commandRunner.js';
import { requireWorktreePath } from '../filesystem/pathSafety.js';
import { GitService } from './gitService.js';

const DEFAULT_COMMIT_MESSAGE = 'Auto-sync from agent session';
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx']);

interface LandingResult {
  success: boolean;
  message: string;
  commitHash?: string;
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function hasTypeScriptFiles(filePaths: string[]) {
  return filePaths.some((filePath) => TYPESCRIPT_EXTENSIONS.has(path.extname(filePath)));
}

async function readPackageScripts(worktreePath: string) {
  const packageJsonPath = path.join(worktreePath, 'package.json');
  if (!existsSync(packageJsonPath)) return {};

  const rawPackage = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(rawPackage) as PackageJsonShape;
  return parsed.scripts || {};
}

function getRuntimeSessionId(worktreePath: string) {
  return readRuntimeSessionFile(worktreePath)?.runtimeSessionId || null;
}

function resetGuardrailLog(worktreePath: string) {
  rmSync(getGuardrailLogPath(worktreePath), { force: true });
}

function writeGuardrailLog(worktreePath: string, content: string) {
  writeFileSync(getGuardrailLogPath(worktreePath), `${content.trim()}\n`, 'utf8');
}

function getGuardrailSummary(error: unknown) {
  if (error instanceof Error) {
    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return [stderr, stdout, error.message].filter(Boolean).join('\n').trim() || 'Unknown guardrail failure';
  }

  return String(error);
}

async function recordRuntimeStep(runtimeSessionId: string | null) {
  if (!runtimeSessionId) return;
  getRuntimeSessionRepository().incrementStepCount({ runtimeSessionId });
}

async function notifyGuardrailFailure(runtimeSessionId: string, guardrail: string) {
  const sessionChat = getSessionChat(runtimeSessionId);
  enqueueEngineNotification({
    runtimeSessionId,
    eventType: 'session.guardrail_failed',
    payload: {
      guardrail,
      beadId: sessionChat.beadId,
      title: sessionChat.title,
      summary: sessionChat.guardrailError,
      snippet: sessionChat.guardrailError,
    },
    ...(sessionChat.externalChatId ? { targetChatId: sessionChat.externalChatId } : {}),
  });
}

async function notifySessionSynced(runtimeSessionId: string, branchName: string) {
  const sessionChat = getSessionChat(runtimeSessionId);
  enqueueEngineNotification({
    runtimeSessionId,
    eventType: 'session.synced',
    payload: {
      beadId: sessionChat.beadId,
      title: sessionChat.title,
      branchName,
      prUrl: null,
    },
    ...(sessionChat.externalChatId ? { targetChatId: sessionChat.externalChatId } : {}),
  });
}

async function markRuntimeFailure(worktreePath: string, failureKind: string, failureSummary: string) {
  const runtimeSessionId = getRuntimeSessionId(worktreePath);
  if (!runtimeSessionId) return;

  const nowIso = new Date().toISOString();
  writeRuntimeFailureRecord(worktreePath, {
    runtimeSessionId,
    kind: failureKind,
    summary: failureSummary,
    reasonCode: null,
    logTail: failureSummary,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  getRuntimeSessionRepository().fail({
    runtimeSessionId,
    failureKind,
    failureSummary,
    failureLogTail: failureSummary,
  });

  await notifyGuardrailFailure(runtimeSessionId, failureKind);
}

async function clearRuntimeFailure(worktreePath: string) {
  const runtimeSessionId = getRuntimeSessionId(worktreePath);
  if (!runtimeSessionId) return;

  clearRuntimeFailureRecord(worktreePath);
  getRuntimeSessionRepository().clearFailure({ runtimeSessionId, status: 'running' });
}

async function finishRuntimeSession(worktreePath: string, branchName: string) {
  const runtimeSessionId = getRuntimeSessionId(worktreePath);
  if (!runtimeSessionId) return;

  await notifySessionSynced(runtimeSessionId, branchName);
  getRuntimeSessionRepository().finish({ runtimeSessionId, status: 'done' });
}

async function runCommandGuardrail(
  runner: CommandRunner,
  worktreePath: string,
  runtimeSessionId: string | null,
  guardrailName: string,
  command: string,
  args: string[],
  failureKind: string,
  failureMessage: string,
) {
  try {
    await recordRuntimeStep(runtimeSessionId);
    await runner.run(command, args, { cwd: worktreePath, timeoutMs: 600000, maxBuffer: 1024 * 1024 * 16 });
  } catch (error) {
    const summary = `${failureMessage}\n${getGuardrailSummary(error)}`.trim();
    writeGuardrailLog(worktreePath, summary);
    await markRuntimeFailure(worktreePath, failureKind, summary);
    throw new Error(`${guardrailName} failed: ${summary}`);
  }
}

async function maybeRunVisualQa(runner: CommandRunner, worktreePath: string, runtimeSessionId: string | null) {
  const sessionFile = readRuntimeSessionFile(worktreePath);
  const enabled = Boolean((sessionFile?.qaConfig as { enableVisualQa?: boolean } | null)?.enableVisualQa);
  const visualQaPath = path.join(worktreePath, 'src', 'app', 'visual-qa.ts');
  if (!enabled || !existsSync(visualQaPath)) return;

  try {
    await recordRuntimeStep(runtimeSessionId);
    await runner.run(process.execPath, ['--import', 'tsx', visualQaPath, '--repo-root', worktreePath, '--shadow'], {
      cwd: worktreePath,
      timeoutMs: 600000,
      maxBuffer: 1024 * 1024 * 16,
    });
  } catch {
    // Miron sigue en shadow mode: solo informativo.
  }
}

async function collectRelevantFiles(git: GitService) {
  const snapshot = await git.status();
  const workingTreeFiles = unique([...snapshot.stagedFiles, ...snapshot.unstagedFiles, ...snapshot.untrackedFiles]);
  if (workingTreeFiles.length > 0) return workingTreeFiles;

  if (!snapshot.branch) return [];

  const upstream = snapshot.upstream || `origin/${snapshot.branch}`;
  return git.changedFilesSince(upstream);
}

export async function finishTaskLanding(worktreePath: string): Promise<LandingResult> {
  const cwd = requireWorktreePath(worktreePath);
  const git = new GitService(cwd);
  const runner = new CommandRunner();
  const runtimeSessionId = getRuntimeSessionId(cwd);

  try {
    await git.ensureRemoteBranchRefExists();

    const initialSnapshot = await git.status();
    const relevantFiles = await collectRelevantFiles(git);

    if (initialSnapshot.unstagedFiles.length > 0) {
      return { success: false, message: 'Unstaged changes detected. Stage or commit them before running finish_task.' };
    }

    if (initialSnapshot.untrackedFiles.length > 0) {
      return { success: false, message: 'Untracked files detected. Stage or remove them before running finish_task.' };
    }

    const hasLocalCommitsAhead = await git.hasLocalCommitsAhead();
    if (initialSnapshot.stagedFiles.length === 0 && !hasLocalCommitsAhead) {
      return { success: true, message: 'Nothing to sync. No staged changes and no commits pending push.' };
    }

    let commitHash: string | undefined;

    if (initialSnapshot.stagedFiles.length > 0) {
      const commitResult = await git.commit(DEFAULT_COMMIT_MESSAGE);
      commitHash = commitResult.commitHash;
    }

    const postCommitSnapshot = await git.status();
    if (postCommitSnapshot.unstagedFiles.length > 0 || postCommitSnapshot.untrackedFiles.length > 0) {
      return { success: false, message: 'Worktree became dirty after commit. Resolve it before finalizing.' };
    }

    if (await git.hasLocalCommitsAhead()) {
      await recordRuntimeStep(runtimeSessionId);
      await git.fetch('origin', 'master', { allowFailure: true });
      try {
        await git.rebase('origin/master');
      } catch (error) {
        const summary = `Rebase failed. Resolve conflicts and retry.\n${getGuardrailSummary(error)}`;
        writeGuardrailLog(cwd, summary);
        await markRuntimeFailure(cwd, 'rebase_failed', summary);
        return { success: false, message: summary };
      }
    }

    resetGuardrailLog(cwd);
    await clearRuntimeFailure(cwd);

    await maybeRunVisualQa(runner, cwd, runtimeSessionId);

    if (hasTypeScriptFiles(relevantFiles)) {
      const packageScripts = await readPackageScripts(cwd);
      if (existsSync(path.join(cwd, 'tsconfig.json'))) {
        await runCommandGuardrail(
          runner,
          cwd,
          runtimeSessionId,
          'TypeScript',
          'npx',
          ['tsc', '--noEmit'],
          'typescript_guardrail_failed',
          'TypeScript type errors found.',
        );
      }

      if (packageScripts.lint) {
        await runCommandGuardrail(
          runner,
          cwd,
          runtimeSessionId,
          'ESLint',
          'npm',
          ['run', 'lint'],
          'lint_guardrail_failed',
          'Linter errors found.',
        );
      }

      if (packageScripts.test && !packageScripts.test.includes('no test specified')) {
        await runCommandGuardrail(
          runner,
          cwd,
          runtimeSessionId,
          'Tests',
          'npm',
          ['test'],
          'test_guardrail_failed',
          'Tests failed.',
        );
      }
    }

    const branch = await git.currentBranch();
    const remote = await git.upstreamRemote();
    await recordRuntimeStep(runtimeSessionId);
    await git.pushSetUpstream(remote, branch);
    await finishRuntimeSession(cwd, branch);

    return { success: true, message: 'Landing completed successfully.', ...(commitHash ? { commitHash } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message: `finish_task failed: ${message}` };
  }
}
