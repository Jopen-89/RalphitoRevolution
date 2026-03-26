import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { createRaymonTools } from './raymonTools.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { BeadLifecycleService } from '../../core/services/BeadLifecycleService.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const tmpDir = createTempDirectory('rr-raymon-tools-');

  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = tmpDir;
  process.env.RALPHITO_WORKTREE_ROOT = path.join(tmpDir, 'worktrees');

  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
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

function getTool(name: string, currentAgentId?: string) {
  const tool = createRaymonTools(currentAgentId ? { currentAgentId } : {}).find((entry) => entry.name === name);
  assert.ok(tool, `${name} tool missing`);
  return tool;
}

test('summon_agent_to_chat rejects non-Raymon callers at runtime', async () => {
  const tool = getTool('summon_agent_to_chat', 'poncho');

  await assert.rejects(
    () => tool.execute({ agentName: 'lola' }),
    /solo puede ser usada por Raymon.*poncho/i,
  );
});

test('summon_agent_to_chat allows Raymon caller to pass runtime guard', async () => {
  const tool = getTool('summon_agent_to_chat', 'raymon');

  await assert.rejects(
    () => tool.execute({ agentName: 'agente-inexistente' }),
    /No conozco al agente 'agente-inexistente'/,
  );
});

test('list_project_backlog returns recommended order by priority and status', async () => {
  await withTempDb(async () => {
    BeadLifecycleService.createTask({
      taskId: 'task-medium',
      projectId: 'system',
      title: 'Medium pending task',
      beadPath: 'docs/specs/projects/system/bead-02-medium.md',
      priority: 'medium',
    });
    BeadLifecycleService.createTask({
      taskId: 'task-high',
      projectId: 'system',
      title: 'High pending task',
      beadPath: 'docs/specs/projects/system/bead-01-high.md',
      priority: 'high',
    });
    BeadLifecycleService.createTask({
      taskId: 'task-blocked',
      projectId: 'system',
      title: 'Blocked urgent task',
      beadPath: 'docs/specs/projects/system/bead-03-blocked.md',
      priority: 'high',
      status: 'blocked',
    });

    const tool = getTool('list_project_backlog');
    const result = await tool.execute({ projectId: 'system', status: 'open' }) as {
      total: number;
      recommendedOrder: Array<{ taskId: string; priority: string; status: string }>;
      summary: string;
    };

    assert.equal(result.total, 3);
    assert.deepEqual(result.recommendedOrder.map((item) => item.taskId), [
      'task-blocked',
      'task-high',
      'task-medium',
    ]);
    assert.ok(result.summary.includes('task-blocked'));
  });
});

test('set_task_priority reprioritizes a task by task id', async () => {
  await withTempDb(async () => {
    BeadLifecycleService.createTask({
      taskId: 'task-priority',
      projectId: 'system',
      title: 'Priority candidate',
      beadPath: 'docs/specs/projects/system/bead-04-priority.md',
      priority: 'low',
    });

    const tool = getTool('set_task_priority');
    const result = await tool.execute({ taskId: 'task-priority', priority: 'high' }) as {
      taskId: string;
      priority: string;
      success: boolean;
    };

    const updated = BeadLifecycleService.getTaskById('task-priority');

    assert.equal(result.taskId, 'task-priority');
    assert.equal(result.priority, 'high');
    assert.equal(result.success, true);
    assert.equal(updated?.priority, 'high');
  });
});
