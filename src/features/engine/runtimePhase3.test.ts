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
} from '../persistence/db/index.js';
import {
  getEngineNotificationRepository,
  resetEngineNotificationRepository,
} from './engineNotifications.js';
import { ExecutorLoop } from './executorLoop.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from './runtimeLockRepository.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { resumeRuntimeSession } from './resume.js';
import { writeRuntimeFailureRecord, writeRuntimeSessionFile } from './runtimeFiles.js';
import { SessionSupervisor } from './sessionSupervisor.js';

const GIT_BIN = '/usr/bin/git';

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
    path.join(repoRoot, 'ops', 'agent-orchestrator.yaml'),
    [
      'defaults:',
      '  agent: codex',
      'projects:',
      '  backend-team:',
      '    name: Ralphito Backend',
      '    sessionPrefix: be',
      `    path: ${repoRoot}`,
      '    defaultBranch: master',
      '    agentRulesFile: .agent-rules.md',
      '    agent: codex',
      '    agentConfig:',
      '      model: codex-latest',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(repoRoot, '.agent-rules.md'), 'Usa bd sync.\n', 'utf8');
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

function withTempRuntime<T>(fn: (ctx: { repoRoot: string; headCommit: string }) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousDisableKick = process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
  const { repoRoot, headCommit } = createTempRepo();

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = '1';
  closeRalphitoDatabase();
  resetRuntimeSessionRepository();
  resetRuntimeLockRepository();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, headCommit }))
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
      process.chdir(previousCwd);
      rmSync(repoRoot, { force: true, recursive: true });
    });
}

test('SessionSupervisor crea sesion runtime con thread sintetico y session file', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit }) => {
    const detachedCalls: Array<{ command: string; args: string[] }> = [];
    const createdSessions: string[] = [];
    const launchCommands: string[] = [];
    const createdEnvs: Array<Record<string, string>> = [];

    const runner = {
      async run() {
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
      (projectRoot: string) =>
        ({
          async createWorkspace(runtimeSessionId: string) {
            const workspacePath = path.join(projectRoot, '.agent-worktrees', runtimeSessionId);
            mkdirSync(workspacePath, { recursive: true });
            return workspacePath;
          },
          async teardownWorkspacePath() {
            return true;
          },
        }) as never,
    );

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
    assert.match(launchCommands[0] || '', /(?:codex --full-auto --no-alt-screen|opencode run "\$RALPHITO_INSTRUCTION")/);
    assert.equal(createdEnvs[0]?.CI, '1');
    assert.equal(createdEnvs[0]?.RALPHITO_DB_PATH, path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite'));
    assert.equal(detachedCalls.length, 1);
    assert.match(createdEnvs[0]?.RALPHITO_INSTRUCTION || '', /Implementa la fase 3\./);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"pid": 987/);
    assert.match(readFileSync(sessionFilePath, 'utf8'), /"notificationChatId": "chat-999"/);
    assert.deepEqual(
      getEngineNotificationRepository().listAll().map((notification) => notification.eventType),
      ['session.started'],
    );
    assert.equal(getEngineNotificationRepository().listAll()[0]?.targetChatId, 'chat-999');
  });
});

test('ExecutorLoop marca done cuando la sesion termina limpia', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit }) => {
    const runtimeSessionId = 'be-loop-done';
    const worktreePath = path.join(repoRoot, '.agent-worktrees', runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
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

    const result = await new ExecutorLoop(
      tmuxRuntime as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
    ).run({ runtimeSessionId, pollMs: 1 });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    assert.equal(result.terminalStatus, 'done');
    assert.equal(session?.status, 'done');
    assert.equal(session?.stepCount, 0);
  });
});

test('ExecutorLoop auto-responde prompts y falla tras 3 intentos', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit }) => {
    const runtimeSessionId = 'be-loop-prompt';
    const worktreePath = path.join(repoRoot, '.agent-worktrees', runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
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

    const result = await new ExecutorLoop(
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
  });
});

test('ExecutorLoop mata sesion cuando detecta daemon bloqueante', async () => {
  await withTempRuntime(async ({ repoRoot, headCommit }) => {
    const runtimeSessionId = 'be-loop-daemon';
    const worktreePath = path.join(repoRoot, '.agent-worktrees', runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });
    const now = new Date().toISOString();

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
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

    const result = await new ExecutorLoop(
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
  await withTempRuntime(async ({ repoRoot, headCommit }) => {
    const runtimeSessionId = 'be-resume';
    const worktreePath = path.join(repoRoot, '.agent-worktrees', runtimeSessionId);
    mkdirSync(worktreePath, { recursive: true });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
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
    assert.match(prompts[0] || '', /Resumen corto: Fallo tsc/);
    assert.match(prompts[0] || '', /src\/a\.ts:1 error TS1005/);
  });
});
