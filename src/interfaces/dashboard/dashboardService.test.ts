import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from '../../core/engine/runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from '../../core/engine/runtimeFiles.js';
import { getUnifiedDashboardSessionDetail } from './dashboardService.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-dashboard-service-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('getUnifiedDashboardSessionDetail exposes persisted worktree path', async () => {
  await withTempDb(async () => {
    const db = initializeRalphitoDatabase();
    const now = new Date().toISOString();
    const runtimeSessionId = 'dash-worktree-1';
    const worktreePath = createTempDirectory('rr-dashboard-worktree-');
    mkdirSync(worktreePath, { recursive: true });

    const threadId = Number(
      db.prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run('runtime', runtimeSessionId, 'Runtime session', now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/dash-worktree-1',
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: null,
      prompt: 'Dashboard test',
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
      createdAt: now,
      updatedAt: now,
    });

    const detail = await getUnifiedDashboardSessionDetail(runtimeSessionId);

    assert.ok(detail);
    assert.equal(detail.session.worktreePath, worktreePath);
    assert.equal(detail.session.agentBinding?.worktreePath, worktreePath);

    rmSync(worktreePath, { force: true, recursive: true });
  });
});
