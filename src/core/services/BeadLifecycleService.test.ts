import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import {
  closeRalphitoDatabase,
  getRalphitoDatabase,
  getRalphitoRepositories,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const tmpDir = createTempDirectory('rr-bead-lifecycle-');
  const repoRoot = path.join(tmpDir, 'repo-root');
  const worktreeRoot = path.join(tmpDir, 'worktrees-root');

  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;

  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();

      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;

      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;

      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;

      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('BeadLifecycleService creates tasks with project metadata and creation event', async () => {
  await withTempDb(({ repoRoot }) => {
    const task = BeadLifecycleService.createTask({
      taskId: 'task-1',
      title: 'Wire system project',
      projectId: 'system',
      beadPath: 'docs/specs/projects/system/bead-1.md',
    });

    const db = getRalphitoDatabase();
    const event = db
      .prepare('SELECT event_type AS eventType FROM task_events WHERE task_id = ? ORDER BY id ASC LIMIT 1')
      .get('task-1') as { eventType: string };

    assert.equal(task?.projectId, 'system');
    assert.equal(task?.status, 'pending');
    assert.equal(
      task?.beadPath,
      path.join(repoRoot, 'docs/specs/projects/system/bead-1.md'),
    );
    assert.equal(event.eventType, 'task_created');
  });
});

test('BeadLifecycleService resolves and transitions tasks across lifecycle states', async () => {
  await withTempDb(({ repoRoot }) => {
    const repos = getRalphitoRepositories();
    repos.projects.upsert({
      projectId: 'qa-pipeline-smoke',
      name: 'QA Pipeline Smoke',
      kind: 'repo',
      repoPath: path.join(repoRoot, 'qa-pipeline-smoke'),
      worktreeRoot: path.join(repoRoot, '.ralphito', 'qa-worktrees'),
      defaultBranch: 'main',
      agentRulesFile: 'AGENTS.md',
    });

    BeadLifecycleService.createTask({
      taskId: 'task-2',
      title: 'Implement smoke checks',
      projectId: 'qa-pipeline-smoke',
      beadPath: 'docs/specs/projects/qa-pipeline-smoke/bead-1.md',
    });

    const started = BeadLifecycleService.startTask({
      taskId: 'task-2',
      assignedAgent: 'poncho',
    });
    const failed = BeadLifecycleService.failTask({
      beadPath: 'docs/specs/projects/qa-pipeline-smoke/bead-1.md',
      projectId: 'qa-pipeline-smoke',
      failureReason: 'lint failed',
    });
    const completed = BeadLifecycleService.completeTask({
      taskId: 'task-2',
    });

    const db = getRalphitoDatabase();
    const eventTypes = db
      .prepare('SELECT event_type AS eventType FROM task_events WHERE task_id = ? ORDER BY id ASC')
      .all('task-2') as Array<{ eventType: string }>;

    assert.equal(started?.status, 'in_progress');
    assert.equal(started?.assignedAgent, 'poncho');
    assert.equal(failed?.status, 'failed');
    assert.equal(completed?.status, 'done');
    assert.ok(completed?.completedAt);
    assert.deepEqual(eventTypes.map((event) => event.eventType), [
      'task_created',
      'task_started',
      'task_failed',
      'task_completed',
    ]);
  });
});
