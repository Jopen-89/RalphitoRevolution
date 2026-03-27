import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRalphitoDatabase,
  getRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';
import { AgentRegistryService } from '../services/AgentRegistry.js';
import {
  getEngineNotificationRepository,
  resetEngineNotificationRepository,
} from '../services/EventBus.js';
import { SessionLoop } from './sessionLoop.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from './runtimeLockRepository.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { resumeRuntimeSession } from './resume.js';
import {
  clearRuntimeExitCode,
  getRuntimeBeadSnapshotFilePath,
  getRuntimeExitCodeFilePath,
  writeRuntimeFailureRecord,
  writeRuntimeSessionFile,
} from './runtimeFiles.js';
import { SessionSupervisor } from '../services/SessionManager.js';

const GIT_BIN = '/usr/bin/git';
const SOURCE_REPO_ROOT = process.cwd();

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(cwd: string, args: string[]) {
  execFileSync(GIT_BIN, args, { cwd, stdio: 'ignore' });
}

function createTempRepo() {
  const repoRoot = createTempDirectory('rr-engine-phase3-');

  mkdirSync(path.join(repoRoot, 'ops'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, 'ops', 'engine-config.yaml'),
    [
      'defaults:',
      '  agent: opencode',
      '  agentConfig:',
      '    provider: opencode',
      '    model: minimax-m2.7',
      'projects:',
      '  backend-team:',
      '    name: Ralphito Backend',
      '    sessionPrefix: be',
      `    path: ${repoRoot}`,
      '    defaultBranch: master',
      '    agentRulesFile: AGENTS.md',
      '    agent: opencode',
      '    agentConfig:',
      '      provider: opencode',
      '      model: minimax-m2.7',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'Usa finish_task.\n', 'utf8');
  writeFileSync(path.join(repoRoot, 'package.json'), '{}\n', 'utf8');
  writeFileSync(path.join(repoRoot, 'seed.txt'), 'seed\n', 'utf8');

  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.name', 'Codex']);
  runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'seed']);

  const headRef = readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
  const refName = headRef.replace('ref: ', '');
  const headCommit = readFileSync(path.join(repoRoot, '.git', refName), 'utf8').trim();
  return { repoRoot, headCommit };
}

function runtimeWorktreePath(worktreeRoot: string, runtimeSessionId: string) {
  return path.join(worktreeRoot, runtimeSessionId);
}

function withTempRuntime<T>(fn: (ctx: { repoRoot: string; headCommit: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousDisableKick = process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const { repoRoot, headCommit } = createTempRepo();
  const worktreeRoot = createTempDirectory('rr-engine-worktrees-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = '1';
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRuntimeSessionRepository();
  resetRuntimeLockRepository();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, headCommit, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRuntimeSessionRepository();
      resetRuntimeLockRepository();
      resetEngineNotificationRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      if (previousDisableKick) {
        process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = previousDisableKick;
      } else {
        delete process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
      }
      if (previousWorktreeRoot) {
        process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      } else {
        delete process.env.RALPHITO_WORKTREE_ROOT;
      }
      process.chdir(previousCwd);
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(worktreeRoot, { force: true, recursive: true });
    });
}

test('SessionSupervisor crea sesion runtime con thread sintetico y session file', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const detachedCalls: Array<{ command: string; args: string[] }> = [];
    const createdSessions: string[] = [];
    const launchCommands: string[] = [];
    const createdEnvs: Array<Record<string, string>> = [];
    const runCalls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    const runner = {
      async run(command: string, args: string[], options?: { cwd?: string }) {
        const call: { command: string; args: string[]; cwd?: string } = { command, args };
        if (options?.cwd) {
          call.cwd = options.cwd;
        }
        runCalls.push(call);
        return { stdout: `${headCommit}\n`, stderr: '' };
      },
      spawnDetached(command: string, args: string[]) {
        detachedCalls.push({ command, args });
        return 4321;
      },
    };

    const tmuxRuntime = {
      async createSession(sessionId: string, _workspacePath: string, launchCommand: string, env: Record<string, string>) {
        createdSessions.push(sessionId);
        launchCommands.push(launchCommand);
        createdEnvs.push(env);
      },
      async getPanePid() {
        return 987;
      },
      async killSession() {
        return true;
      },
    };

    const supervisor = new SessionSupervisor(
      runner as never,
      tmuxRuntime as never,
      (project) =>
        ({
          async createWorkspace(runtimeSessionId: string) {
            const workspacePath = runtimeWorktreePath(project.worktreeRoot, runtimeSessionId);
            mkdirSync(workspacePath, { recursive: true });
            return workspacePath;
          },
          async teardownWorkspacePath() {
            return true;
          },
        }) as never,
    );

    const runtimeCwd = process.cwd();
    process.chdir(SOURCE_REPO_ROOT);
    AgentRegistryService.sync();
    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      tool_calling_mode: 'allowed',
      allowed_tools_json: JSON.stringify(['finish_task']),
    });
    process.chdir(runtimeCwd);

    const result = await supervisor.spawn({
      project: 'backend-team',
      prompt: 'Implementa la fase 3.',
      originThreadId: 321,
      notificationChatId: 'chat-999',
    });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(result.runtimeSessionId);
    const db = getRalphitoDatabase();
    const thread = db
      .prepare(
        `
          SELECT channel, external_chat_id AS externalChatId
          FROM threads
          WHERE id = ?
        `,
      )
      .get(session?.threadId) as { channel: string; externalChatId: string };
    const sessionFilePath = path.join(result.worktreePath, '.ralphito-session.json');

    assert.ok(session);
    assert.equal(session?.status, 'running');
    assert.equal(session?.pid, 987);
    assert.equal(session?.originThreadId, 321);
    assert.equal(session?.notificationChatId, 'chat-999');
    assert.equal(thread.channel, 'runtime');
    assert.equal(thread.externalChatId, result.runtimeSessionId);
    assert.equal(existsSync(sessionFilePath), true);
    assert.match(result.branchName, /^jopen\//);
    assert.deepEqual(createdSessions, [result.runtimeSessionId]);
    assert.match(launchCommands[0] || '', /^exec \/bin\/sh -lc /);
    assert.equal(createdEnvs[0]?.CI, '1');
    assert.equal(createdEnvs[0]?.RALPHITO_DB_PATH, path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite'));
    assert.equal(
      createdEnvs[0]?.RALPHITO_RUNTIME_EXIT_FILE,
      path.join(result.worktreePath, '.ralphito-runtime-exit-code'),
    );
    assert.equal(createdEnvs[0]?.RALPHITO_LLM_PROVIDER, 'opencode');
    assert.equal(createdEnvs[0]?.RALPHITO_LLM_MODEL, 'minimax-m2.7');
    assert.equal(detachedCalls.length, 0);
    assert.match(createdEnvs[0]?.RALPHITO_INSTRUCTION || '', /Implementa la fase 3\./);
    assert.match(createdEnvs[0]?.RALPHITO_SYSTEM_PROMPT || '', /Validation Playbook/);
    assert.match(createdEnvs[0]?.RALPHITO_SYSTEM_PROMPT || '', /use `git_add`/);
    assert.match(createdEnvs[0]?.RALPHITO_SYSTEM_PROMPT || '', /finish_task/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"provider": "opencode"/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"pid": 987/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"notificationChatId": "chat-999"/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"agentConfigSnapshot":/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"executionHarness": "opencode"/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"toolMode": "allowed"/);
    assert.deepEqual(
      getEngineNotificationRepository().listAll().map((notification) => notification.eventType),
      ['session.started'],
    );
    assert.equal(getEngineNotificationRepository().listAll()[0]?.targetChatId, 'chat-999');
    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0]?.command, 'git');
    assert.deepEqual(runCalls[0]?.args, ['rev-parse', 'HEAD']);
  });

test('ExecutorLoop marca done cuando la sesion termina limpia', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-done';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
      provider: null,
      model: 'codex-latest',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'done',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'step 1';
      },
      async killSession() {
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: 'origin/jopen/be-loop-exit-zero\n', stderr: '' };
        }
        return { stdout: 'feedcafe\n', stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(session?.status, 'done');
    assert.equal(session?.stepCount, 0);
  });
});

test('ExecutorLoop marca done si la sesion running sale con exit code 0', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-exit-zero';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '0\n', 'utf8');

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'done-lock.txt'), pathKind: 'file' }],
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'done';
      },
      async killSession() {
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: 'origin/jopen/be-loop-exit-zero\n', stderr: '' };
        }
        return { stdout: 'feedcafe\n', stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(result.reason, 'process_exited');
    assert.equal(session?.status, 'done');
    assert.equal(clearRuntimeExitCode(worktreePath), false);
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
  });
});

test('ExecutorLoop ignora artifacts runtime legitimos al validar landing', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-exit-zero-runtime-artifacts';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '0\n', 'utf8');

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'done-lock-runtime-artifacts.txt'), pathKind: 'file' }],
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'done';
      },
      async killSession() {
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return {
            stdout: '?? .ralphito-runtime-exit-code\n?? .ralphito-session.json\n',
            stderr: '',
          };
        }
        if (args[0] === 'ls-remote') {
          return { stdout: `feedcafe\trefs/heads/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: `origin/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        return { stdout: 'feedcafe\n', stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(session?.status, 'done');
    assert.equal(clearRuntimeExitCode(worktreePath), false);
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
  });
});

test('ExecutorLoop falla si exit 0 pero falta landing real', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-exit-zero-no-landing';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: 'docs/specs/projects/test-engine-real/bead-01-telegram-evidence-logger.md',
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '0\n', 'utf8');

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'no-landing-lock.txt'), pathKind: 'file' }],
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'done';
      },
      async killSession() {
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          throw new Error('fatal: no upstream configured');
        }
        return { stdout: `${headCommit}\n`, stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'landing_not_completed');
    assert.equal(session?.status, 'failed');
    assert.equal(session?.failureKind, 'landing_not_completed');
    assert.equal(session?.failureReasonCode, 'missing_upstream');
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
    assert.match(session?.failureSummary || '', /no quedó pusheada/i);
    const failure = JSON.parse(
      readFileSync(path.join(worktreePath, '.ralphito-runtime-failure.json'), 'utf8'),
    ) as { kind: string; reasonCode: string | null };
    assert.equal(failure.kind, 'landing_not_completed');
    assert.equal(failure.reasonCode, 'missing_upstream');
    assert.equal(clearRuntimeExitCode(worktreePath), false);
  });
});

test('ExecutorLoop falla si exit 0 pero la rama remota no existe', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-exit-zero-no-remote';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '0\n', 'utf8');

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'done';
      },
      async killSession() {
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'ls-remote') {
          throw new Error('fatal: remote branch missing');
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: `origin/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        return { stdout: 'feedcafe\n', stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'landing_not_completed');
    assert.equal(session?.status, 'failed');
    assert.equal(session?.failureKind, 'landing_not_completed');
    assert.equal(session?.failureReasonCode, 'missing_remote_branch');
    assert.match(session?.failureSummary || '', /no existe en remoto/i);
  });
});

test('ExecutorLoop no repisa done si finish_task cierra la sesion con tmux vivo', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-done-race';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    const sessionRepository = getRuntimeSessionRepository();
    sessionRepository.create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'done-race-lock.txt'), pathKind: 'file' }],
    });

    let finishedDuringHeartbeat = false;
    const heartbeatRaceRepository = {
      getByRuntimeSessionId: sessionRepository.getByRuntimeSessionId.bind(sessionRepository),
      create: sessionRepository.create.bind(sessionRepository),
      attachPid: sessionRepository.attachPid.bind(sessionRepository),
      incrementStepCount: sessionRepository.incrementStepCount.bind(sessionRepository),
      fail: sessionRepository.fail.bind(sessionRepository),
      finish: sessionRepository.finish.bind(sessionRepository),
      clearFailure: sessionRepository.clearFailure.bind(sessionRepository),
      markStuck: sessionRepository.markStuck.bind(sessionRepository),
      resume: sessionRepository.resume.bind(sessionRepository),
      suspend: sessionRepository.suspend.bind(sessionRepository),
      heartbeat(input: Parameters<typeof sessionRepository.heartbeat>[0]) {
        if (!finishedDuringHeartbeat) {
          finishedDuringHeartbeat = true;
          sessionRepository.finish({
            runtimeSessionId,
            status: 'done',
            heartbeatAt: now,
            finishedAt: now,
          });
        }
        return sessionRepository.heartbeat(input);
      },
    };

    let killCalls = 0;
    const tmuxRuntime = {
      async isAlive() {
        return true;
      },
      async captureOutput() {
        return 'done';
      },
      async killSession() {
        killCalls += 1;
        return true;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'ls-remote') {
          return { stdout: `feedcafe\trefs/heads/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: `origin/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        return { stdout: 'feedcafe\n', stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      heartbeatRaceRepository as never,
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = sessionRepository.getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(result.reason, 'landing_completed');
    assert.equal(session?.status, 'done');
    assert.equal(killCalls, 1);
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
    assert.equal(existsSync(worktreePath), false);
  });
});

test('ExecutorLoop marca failed si la sesion running sale con exit code != 0', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-exit-nonzero';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '7\n', 'utf8');

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'nonzero-lock.txt'), pathKind: 'file' }],
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'boom';
      },
      async killSession() {
        return true;
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'process_exit_nonzero');
    assert.equal(session?.status, 'failed');
    assert.equal(session?.failureKind, 'process_exit_nonzero');
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
    assert.match(readFileSync(path.join(worktreePath, '.ralphito-runtime-failure.json'), 'utf8'), /process_exit_nonzero/);
    assert.equal(clearRuntimeExitCode(worktreePath), false);
  });
});

test('ExecutorLoop marca stuck si la sesion running muere sin exit file ni failure record', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-silent-exit';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'silent-lock.txt'), pathKind: 'file' }],
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return 'last line before death';
      },
      async killSession() {
        return true;
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'stuck');
    assert.equal(result.reason, 'silent_exit');
    assert.equal(session?.status, 'stuck');
    assert.equal(session?.failureKind, 'silent_exit');
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
    assert.match(readFileSync(path.join(worktreePath, '.ralphito-runtime-failure.json'), 'utf8'), /silent_exit/);
  });
});

test('ExecutorLoop auto-responde prompts y falla tras 3 intentos', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-prompt';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
      provider: null,
      model: 'codex-latest',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'docs', 'prompt-lock.txt'), pathKind: 'file' }],
    });

    let alive = true;
    let sendCount = 0;
    const tmuxRuntime = {
      async isAlive() {
        return alive;
      },
      async captureOutput() {
        return 'Continue? [Y/n]';
      },
      async sendLiteral() {
        sendCount++;
      },
      async sendCtrlC() {
        sendCount++;
      },
      async killSession() {
        alive = false;
        return true;
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'interactive_prompt_unresolved');
    assert.equal(session?.failureKind, 'interactive_prompt_unresolved');
    assert.equal(getEngineNotificationRepository().listAll()[0]?.eventType, 'session.interactive_blocked');
    assert.equal(getEngineNotificationRepository().listAll()[0]?.runtimeSessionId, runtimeSessionId);
    assert.ok(sendCount >= 2, 'Should have attempted auto-response');
    assert.equal(getRuntimeLockRepository().listByRuntimeSessionId(runtimeSessionId).length, 0);
  });
});

test('ExecutorLoop mata sesion cuando detecta daemon bloqueante', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-loop-daemon';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
      provider: null,
      model: 'codex-latest',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60 * 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let alive = true;
    const tmuxRuntime = {
      async isAlive() {
        return alive;
      },
      async captureOutput() {
        return [
          'VITE v5.4.0 ready in 300 ms',
          'Local: http://127.0.0.1:5173/',
          'press h + enter to show help',
        ].join('\n');
      },
      async killSession() {
        alive = false;
        return true;
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      0,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'blocked_daemon_detected');
    assert.equal(session?.failureKind, 'blocked_daemon_detected');
    assert.equal(getEngineNotificationRepository().listAll()[0]?.eventType, 'session.interactive_blocked');
    assert.equal(getEngineNotificationRepository().listAll()[0]?.runtimeSessionId, runtimeSessionId);
  });
});

test('resumeRuntimeSession reinyecta fallo estructurado y limpia estado', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-resume';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
      provider: null,
      model: 'codex-latest',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 456,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:00:00.000Z',
    });
    writeRuntimeFailureRecord(worktreePath, {
      runtimeSessionId,
      kind: 'typescript_guardrail_failed',
      summary: 'Fallo tsc',
      reasonCode: 'missing_upstream',
      logTail: 'src/a.ts:1 error TS1005',
      createdAt: '2026-03-21T10:01:00.000Z',
      updatedAt: '2026-03-21T10:01:00.000Z',
    });

    const db = getRalphitoDatabase();
    const now = '2026-03-21T10:00:00.000Z';
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'failed',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 456,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const prompts: string[] = [];
    const tmuxRuntime = {
      async isAlive() {
        return true;
      },
      async sendLiteral(_runtimeSessionId: string, prompt: string) {
        prompts.push(prompt);
      },
    };

    await resumeRuntimeSession(runtimeSessionId, tmuxRuntime as never);

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(session?.status, 'running');
    assert.equal(existsSync(path.join(worktreePath, '.ralphito-runtime-failure.json')), false);
    assert.match(prompts[0] || '', /Tipo: typescript_guardrail_failed/);
    assert.match(prompts[0] || '', /Resumen corto: Fallo tsc/);
    assert.match(prompts[0] || '', /Motivo verificacion: missing_upstream/);
    assert.match(prompts[0] || '', /src\/a\.ts:1 error TS1005/);
  });
});

test('resumeRuntimeSession relanza sesion muerta y reinyecta fallo estructurado', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-resume-dead';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const beadSnapshotPath = getRuntimeBeadSnapshotFilePath(worktreePath);
    writeFileSync(
      beadSnapshotPath,
      ['# Resume bead', '', '## Scope', '- keep snapshot', '', '## VERIFICATION_COMMAND', '`printf ok`'].join('\n'),
      'utf8',
    );

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 456,
      prompt: 'hola',
      beadPath: null,
      beadSnapshotPath,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:00:00.000Z',
    });
    writeRuntimeFailureRecord(worktreePath, {
      runtimeSessionId,
      kind: 'typescript_guardrail_failed',
      summary: 'Fallo tsc',
      reasonCode: null,
      logTail: 'src/a.ts:1 error TS1005',
      createdAt: '2026-03-21T10:01:00.000Z',
      updatedAt: '2026-03-21T10:01:00.000Z',
    });

    const db = getRalphitoDatabase();
    const now = '2026-03-21T10:00:00.000Z';
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'failed',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 456,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const prompts: string[] = [];
    const createdSessions: Array<{ sessionId: string; workspacePath: string; launchCommand: string; env: Record<string, string> }> = [];
    const detachedCalls: Array<{ command: string; args: string[] }> = [];
    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async createSession(sessionId: string, workspacePath: string, launchCommand: string, env: Record<string, string>) {
        createdSessions.push({ sessionId, workspacePath, launchCommand, env });
      },
      async getPanePid() {
        return 654;
      },
      async sendLiteral(_runtimeSessionId: string, prompt: string) {
        prompts.push(prompt);
      },
    };
    const commandRunner = {
      spawnDetached(command: string, args: string[]) {
        detachedCalls.push({ command, args });
        return 999;
      },
    };

    await resumeRuntimeSession(runtimeSessionId, tmuxRuntime as never, commandRunner as never);

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(session?.status, 'running');
    assert.equal(session?.finishedAt, null);
    assert.equal(session?.pid, 654);
    assert.equal(existsSync(path.join(worktreePath, '.ralphito-runtime-failure.json')), false);
    assert.equal(createdSessions.length, 1);
    assert.equal(createdSessions[0]?.sessionId, runtimeSessionId);
    assert.equal(createdSessions[0]?.workspacePath, worktreePath);
    assert.match(createdSessions[0]?.launchCommand || '', /^exec \/bin\/sh -lc /);
    assert.match(createdSessions[0]?.env.RALPHITO_INSTRUCTION || '', /hola/);
    assert.match(createdSessions[0]?.env.RALPHITO_INSTRUCTION || '', /Tipo: typescript_guardrail_failed/);
    assert.match(createdSessions[0]?.env.RALPHITO_INSTRUCTION || '', /Resumen corto: Fallo tsc/);
    assert.doesNotMatch(createdSessions[0]?.env.RALPHITO_INSTRUCTION || '', /Motivo verificacion:/);
    assert.match(createdSessions[0]?.env.RALPHITO_INSTRUCTION || '', /src\/a\.ts:1 error TS1005/);
    assert.match(createdSessions[0]?.env.RALPHITO_SYSTEM_PROMPT || '', /## BEAD IMPLEMENTATION TASK/);
    assert.match(createdSessions[0]?.env.RALPHITO_SYSTEM_PROMPT || '', /# Resume bead/);
    assert.match(createdSessions[0]?.env.RALPHITO_SYSTEM_PROMPT || '', /Validation Playbook/);
    assert.match(createdSessions[0]?.env.RALPHITO_SYSTEM_PROMPT || '', /use `git_commit`/);
    assert.match(createdSessions[0]?.env.RALPHITO_SYSTEM_PROMPT || '', /finish_task/);
    assert.equal(prompts.length, 0);
    assert.equal(detachedCalls.length, 0);
  });
});

test('SessionLoop auto-resume guardrail failures within retry budget', async () => {
  await withTempRuntime(async ({ headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-auto-resume';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 456,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      autoResumeAttempts: {},
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeRuntimeFailureRecord(worktreePath, {
      runtimeSessionId,
      kind: 'test_guardrail_failed',
      summary: 'npm test failed',
      reasonCode: null,
      logTail: '1 failing test',
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 456,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    let resumed = false;
    const tmuxRuntime = {
      async isAlive() {
        return resumed;
      },
      async captureOutput() {
        return resumed ? 'done' : '';
      },
      async killSession() {
        return true;
      },
      async createSession() {
        resumed = true;
        writeFileSync(getRuntimeExitCodeFilePath(worktreePath), '0\n', 'utf8');
      },
      async getPanePid() {
        return 654;
      },
      async sendLiteral() {
        return;
      },
    };
    const commandRunner = {
      async run(_command: string, args: string[]) {
        if (args[0] === 'status') {
          return { stdout: '', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args.includes('HEAD')) {
          return { stdout: 'new-commit\n', stderr: '' };
        }
        if (args.at(-1) === '@{u}') {
          return { stdout: `origin/jopen/${runtimeSessionId}\n`, stderr: '' };
        }
        return { stdout: `feedcafe\trefs/heads/jopen/${runtimeSessionId}\n`, stderr: '' };
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      commandRunner as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(session?.status, 'done');
    assert.equal(session?.pid, 654);
    assert.equal(resumed, true);
    assert.equal(existsSync(worktreePath), false);
  });
});

test('SessionLoop notifica cuando un guardrail agota el budget de auto-resume', async () => {
  await withTempRuntime(async ({ headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-auto-resume-exhausted';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: headCommit,
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 456,
      prompt: 'hola',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: 'chat-123',
      autoResumeAttempts: { test_guardrail_failed: 2 },
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });
    writeRuntimeFailureRecord(worktreePath, {
      runtimeSessionId,
      kind: 'test_guardrail_failed',
      summary: 'npm test failed badly',
      reasonCode: null,
      logTail: '2 failing tests',
      createdAt: now,
      updatedAt: now,
    });

    const db = getRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('telegram', 'chat-123', runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      notificationChatId: 'chat-123',
      worktreePath,
      pid: 456,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async captureOutput() {
        return '';
      },
      async killSession() {
        return true;
      },
    };

    const result = await new SessionLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    const notifications = getEngineNotificationRepository().listAll();
    const terminalNotification = notifications.at(-1);
    const terminalPayload = terminalNotification?.payload as { summary?: string; snippet?: string } | undefined;

    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.reason, 'test_guardrail_failed');
    assert.equal(session?.status, 'failed');
    assert.equal(terminalNotification?.eventType, 'session.guardrail_failed');
    assert.match(String(terminalPayload?.summary || ''), /Auto-resume agotado tras 2\/2 intentos/i);
    assert.match(String(terminalPayload?.snippet || ''), /2 failing tests/);
  });
});

test('cli record-failure persiste failure record en DB y archivo', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit, worktreeRoot }) => {
    const runtimeSessionId = 'be-record-failure';
    const worktreePath = runtimeWorktreePath(worktreeRoot, runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const logPath = path.join(worktreePath, '.guardrail_error.log');
    writeFileSync(logPath, 'src/a.ts:1 error TS1005\n', 'utf8');

    const db = getRalphitoDatabase();
    const now = '2026-03-21T10:00:00.000Z';
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: headCommit,
      worktreePath,
      pid: 456,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(SOURCE_REPO_ROOT, 'src/core/engine/cli.ts'),
        'record-failure',
        runtimeSessionId,
        'typescript_guardrail_failed',
        'Fallo tsc',
        logPath,
      ],
      {
        cwd: SOURCE_REPO_ROOT,
        env: {
          ...process.env,
          RALPHITO_DB_PATH: path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite'),
        },
        stdio: 'ignore',
      },
    );

    closeRalphitoDatabase();
    resetRuntimeSessionRepository();
    initializeRalphitoDatabase();

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    const failure = JSON.parse(
      readFileSync(path.join(worktreePath, '.ralphito-runtime-failure.json'), 'utf8'),
    ) as {
      kind: string;
      summary: string;
      reasonCode: string | null;
      logTail: string | null;
    };

    assert.equal(session?.status, 'failed');
    assert.equal(session?.failureKind, 'typescript_guardrail_failed');
    assert.equal(session?.failureSummary, 'Fallo tsc');
    assert.equal(session?.failureReasonCode, null);
    assert.match(session?.failureLogTail || '', /TS1005/);
    assert.equal(failure.kind, 'typescript_guardrail_failed');
    assert.equal(failure.summary, 'Fallo tsc');
    assert.equal(failure.reasonCode, null);
    assert.match(failure.logTail || '', /TS1005/);
  });
});
});
