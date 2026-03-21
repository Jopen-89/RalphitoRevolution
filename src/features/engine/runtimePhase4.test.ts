import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../persistence/db/index.js';
import { getEngineSessionsStatus } from './status.js';
import {
  getRuntimeSessionRepository,
  resetRuntimeSessionRepository,
} from './runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from './runtimeFiles.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (repoRoot: string) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const repoRoot = createTempDirectory('rr-engine-phase4-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn(repoRoot))
    .finally(() => {
      closeRalphitoDatabase();
      resetRuntimeSessionRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      process.chdir(previousCwd);
      rmSync(repoRoot, { force: true, recursive: true });
    });
}

function insertThread(runtimeSessionId: string, createdAt: string) {
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

test('getEngineSessionsStatus expone sesiones recientes del engine con metadata util para dashboard', async () => {
  await withTempRuntime(async (repoRoot) => {
    const repository = getRuntimeSessionRepository();
    const runningWorktree = path.join(repoRoot, '.agent-worktrees', 'be-running');
    const failedWorktree = path.join(repoRoot, '.agent-worktrees', 'be-failed');

    mkdirSync(runningWorktree, { recursive: true });
    mkdirSync(failedWorktree, { recursive: true });

    writeRuntimeSessionFile(runningWorktree, {
      runtimeSessionId: 'be-running',
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'codex',
      model: 'gpt-5.4',
      baseCommitHash: 'abc123',
      branchName: 'jopen/be-running',
      worktreePath: runningWorktree,
      tmuxSessionId: 'be-running',
      pid: 111,
      prompt: 'hola',
      beadPath: 'docs/specs/projects/runtime/bead-4.md',
      workItemKey: 'runtime-f4',
      beadSpecHash: 'hash-1',
      beadSpecVersion: 'v1',
      qaConfig: null,
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:00:00.000Z',
    });

    writeRuntimeSessionFile(failedWorktree, {
      runtimeSessionId: 'be-failed',
      projectId: 'frontend-team',
      agentId: 'frontend-team',
      agent: 'codex',
      model: 'gpt-5.4',
      baseCommitHash: 'def456',
      branchName: 'jopen/be-failed',
      worktreePath: failedWorktree,
      tmuxSessionId: 'be-failed',
      pid: 222,
      prompt: 'hola',
      beadPath: 'docs/specs/projects/runtime/bead-5.md',
      workItemKey: 'runtime-f5',
      beadSpecHash: 'hash-2',
      beadSpecVersion: 'v2',
      qaConfig: null,
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: '2026-03-21T09:00:00.000Z',
      updatedAt: '2026-03-21T09:00:00.000Z',
    });

    repository.create({
      threadId: insertThread('be-running', '2026-03-21T10:00:00.000Z'),
      agentId: 'backend-team',
      runtimeSessionId: 'be-running',
      status: 'running',
      worktreePath: runningWorktree,
      startedAt: '2026-03-21T10:00:00.000Z',
      heartbeatAt: '2026-03-21T10:05:00.000Z',
      createdAt: '2026-03-21T10:00:00.000Z',
      updatedAt: '2026-03-21T10:05:00.000Z',
    });

    repository.create({
      threadId: insertThread('be-failed', '2026-03-21T09:00:00.000Z'),
      agentId: 'frontend-team',
      runtimeSessionId: 'be-failed',
      status: 'running',
      worktreePath: failedWorktree,
      startedAt: '2026-03-21T09:00:00.000Z',
      heartbeatAt: '2026-03-21T09:02:00.000Z',
      createdAt: '2026-03-21T09:00:00.000Z',
      updatedAt: '2026-03-21T09:03:00.000Z',
    });
    repository.fail({
      runtimeSessionId: 'be-failed',
      failureKind: 'guardrail_failed',
      failureSummary: 'Fallo guardrail',
      finishedAt: '2026-03-21T09:03:00.000Z',
      heartbeatAt: '2026-03-21T09:03:00.000Z',
    });

    const recent = repository.listRecent();
    const sessions = await getEngineSessionsStatus({
      sessions: recent,
      tmuxRuntime: {
        async isAlive(runtimeSessionId: string) {
          return runtimeSessionId === 'be-running';
        },
      },
    });

    assert.deepEqual(
      sessions.map((session) => session.id),
      ['be-running', 'be-failed'],
    );

    assert.deepEqual(sessions[0], {
      id: 'be-running',
      status: 'running',
      projectId: 'backend-team',
      role: 'worker',
      activity: 'running',
      branch: 'jopen/be-running',
      summary: 'runtime-f4',
      issue: null,
      prUrl: null,
      createdAt: '2026-03-21T10:00:00.000Z',
      lastActivityAt: '2026-03-21T10:05:00.000Z',
      lastActivityLabel: '2026-03-21T10:05:00.000Z',
      alive: true,
      source: 'ralphito_engine',
    });

    assert.equal(sessions[1]?.status, 'failed');
    assert.equal(sessions[1]?.activity, 'failed');
    assert.equal(sessions[1]?.summary, 'Fallo guardrail');
    assert.equal(sessions[1]?.alive, false);
    assert.equal(sessions[1]?.branch, 'jopen/be-failed');
    assert.equal(sessions[1]?.projectId, 'frontend-team');
  });
});
