import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import { getEngineNotificationRepository, resetEngineNotificationRepository } from './EventBus.js';
import { writeRuntimeSessionFile } from '../engine/runtimeFiles.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from '../engine/runtimeLockRepository.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';
import { RuntimeSessionLifecycleService } from './RuntimeSessionLifecycleService.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const repoRoot = createTempDirectory('rr-runtime-lifecycle-repo-');
  const worktreeRoot = createTempDirectory('rr-runtime-lifecycle-worktrees-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  resetRuntimeLockRepository();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      resetRuntimeLockRepository();
      resetEngineNotificationRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;
      process.chdir(previousCwd);
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(worktreeRoot, { force: true, recursive: true });
    });
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

test('RuntimeSessionLifecycleService cancel unifica cancel/task/outbox/cleanup', async () => {
  await withTempRuntime(async ({ repoRoot, worktreeRoot }) => {
    const runtimeSessionId = 'sy-lifecycle-cancel';
    const now = new Date().toISOString();
    const worktreePath = path.join(worktreeRoot, runtimeSessionId);
    const beadPath = path.join(repoRoot, 'docs', 'specs', 'projects', 'system', 'bead-lifecycle.md');

    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(path.dirname(beadPath), { recursive: true });
    writeFileSync(beadPath, '# bead\n', 'utf8');

    BeadLifecycleService.createTask({
      taskId: 'task-lifecycle-cancel',
      projectId: 'system',
      title: 'Lifecycle cancel',
      beadPath,
      status: 'in_progress',
      assignedAgent: 'system',
    });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread(runtimeSessionId, now),
      agentId: 'system',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      notificationChatId: 'chat-lifecycle',
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'system',
      agentId: 'system',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/sy-lifecycle-cancel',
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'Cancela lifecycle',
      beadPath,
      workItemKey: 'task-lifecycle-cancel',
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: 'chat-lifecycle',
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: beadPath, pathKind: 'file' }],
      heartbeatAt: now,
    });

    const service = new RuntimeSessionLifecycleService(
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      {
        async killSession() {
          return false;
        },
        async isAlive() {
          return false;
        },
      } as never,
    );

    const result = await service.cancel({
      runtimeSessionId,
      reason: 'Sesión cancelada por test',
    });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    const task = BeadLifecycleService.getTaskById('task-lifecycle-cancel');
    const notification = getEngineNotificationRepository().listAll()[0];

    assert.equal(result.statusChanged, true);
    assert.equal(result.notificationQueued, true);
    assert.equal(result.killed, false);
    assert.equal(result.runtimeStopped, true);
    assert.equal(result.locksReleased, 1);
    assert.equal(result.worktreeRemoved, true);
    assert.equal(session?.status, 'cancelled');
    assert.equal(task?.status, 'cancelled');
    assert.equal(notification?.eventType, 'session.cancelled');
    assert.equal(notification?.targetChatId, 'chat-lifecycle');
    assert.equal(existsSync(worktreePath), false);
  });
});

test('RuntimeSessionLifecycleService no pisa sesiones done', async () => {
  await withTempRuntime(async ({ worktreeRoot }) => {
    const runtimeSessionId = 'sy-lifecycle-done';
    const now = new Date().toISOString();
    const worktreePath = path.join(worktreeRoot, runtimeSessionId);

    mkdirSync(worktreePath, { recursive: true });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread(runtimeSessionId, now),
      agentId: 'system',
      runtimeSessionId,
      status: 'done',
      worktreePath,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const service = new RuntimeSessionLifecycleService(
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      {
        async killSession() {
          return false;
        },
        async isAlive() {
          return false;
        },
      } as never,
    );

    const result = await service.cancel({ runtimeSessionId });
    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);

    assert.equal(result.statusChanged, false);
    assert.equal(result.notificationQueued, false);
    assert.equal(session?.status, 'done');
  });
});

test('RuntimeSessionLifecycleService reapStaleSessions delega al reaper canonico', async () => {
  await withTempRuntime(async ({ repoRoot, worktreeRoot }) => {
    const runtimeSessionId = 'sy-lifecycle-stale';
    const staleAt = '2026-03-21T10:00:00.000Z';
    const worktreePath = path.join(worktreeRoot, runtimeSessionId);

    mkdirSync(worktreePath, { recursive: true });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread(runtimeSessionId, staleAt),
      agentId: 'system',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      heartbeatAt: staleAt,
      startedAt: staleAt,
      createdAt: staleAt,
      updatedAt: staleAt,
    });

    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      heartbeatAt: staleAt,
      ttlMs: 60_000,
      targets: [{ path: path.join(repoRoot, 'src'), pathKind: 'directory' }],
    });

    const service = new RuntimeSessionLifecycleService(
      getRuntimeSessionRepository(),
      getRuntimeLockRepository(),
      {
        async isAlive() {
          return false;
        },
        async killSession() {
          return true;
        },
      } as never,
      () => new WorktreeManager(repoRoot, worktreeRoot),
    );

    const result = await service.reapStaleSessions({
      nowIso: '2026-03-21T10:10:00.000Z',
      sessionTtlMs: 60_000,
    });
    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
    const notification = getEngineNotificationRepository().listAll()[0];

    assert.equal(result.auditedSessions, 1);
    assert.deepEqual(result.staleSessions, [runtimeSessionId]);
    assert.equal(result.releasedLocks, 1);
    assert.deepEqual(result.removedWorktrees, [worktreePath]);
    assert.deepEqual(result.killedTmuxSessions, []);
    assert.equal(session?.status, 'stuck');
    assert.equal(session?.failureKind, 'heartbeat_timeout');
    assert.equal(notification?.eventType, 'session.reaped');
    assert.equal(existsSync(worktreePath), false);
  });
});
