import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { getEngineNotificationRepository, resetEngineNotificationRepository } from '../services/EventBus.js';
import { SessionLoop } from './sessionLoop.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from './runtimeLockRepository.js';
import { SessionSupervisor } from '../services/SessionManager.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from './runtimeFiles.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousDisableNotificationKick = process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
  const runtimeRoot = createTempDirectory('rr-runtime-task-lifecycle-');

  process.env.RALPHITO_DB_PATH = path.join(runtimeRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = '1';
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  resetRuntimeLockRepository();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      resetRuntimeLockRepository();
      resetEngineNotificationRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      if (previousDisableNotificationKick) {
        process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = previousDisableNotificationKick;
      } else {
        delete process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
      }
      rmSync(runtimeRoot, { force: true, recursive: true });
    });
}

function insertTask(input: {
  id: string;
  title: string;
  sourceSpecPath: string;
  status?: string;
  runtimeSessionId?: string | null;
  assignedAgent?: string | null;
}) {
  const db = initializeRalphitoDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO tasks (
        id,
        project_key,
        title,
        source_spec_path,
        component_path,
        status,
        assigned_agent,
        runtime_session_id,
        priority,
        created_at,
        updated_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.id,
    'backend-team',
    input.title,
    input.sourceSpecPath,
    null,
    input.status || 'pending',
    input.assignedAgent || null,
    input.runtimeSessionId || null,
    'medium',
    now,
    now,
    null,
  );
}

function insertRuntimeThread(runtimeSessionId: string, createdAt: string) {
  const db = initializeRalphitoDatabase();
  return Number(
    db
      .prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run('runtime', runtimeSessionId, runtimeSessionId, createdAt, createdAt).lastInsertRowid,
  );
}

test('SessionSupervisor liga task existente al spawn por beadPath', async () => {
  await withTempRuntime(async () => {
    const beadPath = path.join(process.cwd(), 'docs/specs/projects/test-engine/bead-02-fake-test.md');
    insertTask({
      id: 'task-spawn-link',
      title: 'Prueba de Engine 02',
      sourceSpecPath: beadPath,
    });

    const worktreePath = createTempDirectory('rr-spawn-link-worktree-');
    const runner = {
      async run() {
        return { stdout: 'feedcafe\n', stderr: '' };
      },
      spawnDetached() {
        return { pid: 999 };
      },
    };
    const tmuxRuntime = {
      async createSession() {
        return undefined;
      },
      async getPanePid() {
        return 1234;
      },
      async killSession() {
        return true;
      },
    };

    const supervisor = new SessionSupervisor(
      runner as never,
      tmuxRuntime as never,
      () =>
        ({
          async createWorkspace() {
            mkdirSync(worktreePath, { recursive: true });
            return worktreePath;
          },
          async teardownWorkspacePath() {
            return true;
          },
        }) as never,
    );

    const result = await supervisor.spawn({
      project: 'backend-team',
      prompt: 'Ejecuta el bead 02',
      beadPath: 'docs/specs/projects/test-engine/bead-02-fake-test.md',
    });

    const db = initializeRalphitoDatabase();
    const task = db
      .prepare(
        `
          SELECT status, assigned_agent AS assignedAgent, runtime_session_id AS runtimeSessionId
          FROM tasks
          WHERE id = ?
        `,
      )
      .get('task-spawn-link') as {
        status: string;
        assignedAgent: string | null;
        runtimeSessionId: string | null;
      };

    assert.equal(task.status, 'in_progress');
    assert.equal(task.assignedAgent, 'backend-team');
    assert.equal(task.runtimeSessionId, result.runtimeSessionId);

    rmSync(worktreePath, { force: true, recursive: true });
  });
});

test('ExecutorLoop marca done la task ligada cuando el landing cierra bien', async () => {
  await withTempRuntime(async () => {
    const runtimeSessionId = 'be-task-done';
    const worktreePath = createTempDirectory('rr-executor-done-worktree-');
    const beadPath = path.join(process.cwd(), 'docs/specs/projects/test-engine/bead-02-fake-test.md');
    const now = new Date().toISOString();

    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(path.join(worktreePath, '.ralphito-runtime-exit-code'), '0\n', 'utf8');
    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'base-commit',
      branchName: `jopen/${runtimeSessionId}`,
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'Ejecuta el bead 02',
      beadPath: 'docs/specs/projects/test-engine/bead-02-fake-test.md',
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    insertTask({
      id: 'task-done-link',
      title: 'Prueba de Engine 02',
      sourceSpecPath: beadPath,
      status: 'in_progress',
      runtimeSessionId,
      assignedAgent: 'backend-team',
    });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread(runtimeSessionId, now),
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      baseCommitHash: 'base-commit',
      worktreePath,
      pid: 123,
      maxSteps: 10,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const result = await new SessionLoop(
      {
        async isAlive() {
          return false;
        },
        async captureOutput() {
          return 'done';
        },
        async killSession() {
          return true;
        },
      } as never,
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      undefined,
      {
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
      } as never,
    ).run({ runtimeSessionId, pollMs: 1 });

    const db = initializeRalphitoDatabase();
    const task = db
      .prepare(
        `
          SELECT status, runtime_session_id AS runtimeSessionId
          FROM tasks
          WHERE id = ?
        `,
      )
      .get('task-done-link') as { status: string; runtimeSessionId: string | null };
    const notifications = getEngineNotificationRepository().listAll();

    assert.equal(result.terminalStatus, 'done');
    assert.equal(task.status, 'done');
    assert.equal(task.runtimeSessionId, runtimeSessionId);
    assert.equal(notifications[0]?.eventType, 'session.synced');
    assert.equal(notifications[0]?.runtimeSessionId, runtimeSessionId);

    rmSync(worktreePath, { force: true, recursive: true });
  });
});
