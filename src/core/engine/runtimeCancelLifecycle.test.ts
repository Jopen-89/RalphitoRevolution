import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { SessionLoop } from './sessionLoop.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from './runtimeLockRepository.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from './runtimeSessionRepository.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const repoRoot = createTempDirectory('rr-runtime-cancel-repo-');
  const worktreeRoot = createTempDirectory('rr-runtime-cancel-worktrees-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  resetRuntimeLockRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      resetRuntimeLockRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
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

test('SessionLoop sale clean con status cancelled y limpia worktree/locks', async () => {
  await withTempRuntime(async ({ repoRoot, worktreeRoot }) => {
    const runtimeSessionId = 'be-cancelled';
    const now = new Date().toISOString();
    const worktreePath = path.join(worktreeRoot, runtimeSessionId);
    let killedCount = 0;

    mkdirSync(worktreePath, { recursive: true });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread(runtimeSessionId, now),
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    getRuntimeSessionRepository().finish({
      runtimeSessionId,
      status: 'cancelled',
      finishedAt: now,
      heartbeatAt: now,
    });

    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId,
      targets: [{ path: path.join(repoRoot, 'src', 'cancelled.ts'), pathKind: 'file' }],
      heartbeatAt: now,
    });

    const result = await new SessionLoop(
      {
        async isAlive() {
          return true;
        },
        async captureOutput() {
          return '';
        },
        async killSession() {
          killedCount += 1;
          return true;
        },
      } as never,
    ).run({ runtimeSessionId });

    const session = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);

    assert.equal(result.terminalStatus, 'cancelled');
    assert.equal(result.reason, 'cancelled');
    assert.equal(killedCount, 1);
    assert.equal(session?.status, 'cancelled');
    assert.equal(existsSync(worktreePath), false);
    assert.equal(getRuntimeLockRepository().listAllActive().length, 0);
  });
});
