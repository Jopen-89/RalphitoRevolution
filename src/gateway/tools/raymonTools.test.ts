import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createRaymonTools } from './raymonTools.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { getRuntimeLockRepository } from '../../core/engine/runtimeLockRepository.js';
import { getRuntimeSessionRepository } from '../../core/engine/runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from '../../core/engine/runtimeFiles.js';
import { BeadLifecycleService } from '../../core/services/BeadLifecycleService.js';
import {
  getEngineNotificationRepository,
  resetEngineNotificationRepository,
} from '../../core/services/EventBus.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';

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
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetEngineNotificationRepository();
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

test('Raymon exposes Stage 4 session-centric orchestration tools', () => {
  const names = createRaymonTools().map((tool) => tool.name).sort();

  assert.ok(names.includes('spawn_session'));
  assert.ok(names.includes('resume_session'));
  assert.ok(names.includes('cancel_session'));
  assert.ok(names.includes('reap_stale_sessions'));
  assert.equal(names.includes('spawn_executor'), false);
  assert.equal(names.includes('resume_executor'), false);
  assert.equal(names.includes('cancel_executor'), false);
  assert.equal(names.includes('cleanup_zombies'), false);
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

test('cancel_session marca cancelled, sincroniza task, limpia worktree y notifica', async () => {
  await withTempDb(async () => {
    const sessionId = 'sy-cancel-1';
    const now = new Date().toISOString();
    const db = initializeRalphitoDatabase();
    const threadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', sessionId, sessionId, now, now).lastInsertRowid,
    );
    const worktreePath = path.join(process.env.RALPHITO_WORKTREE_ROOT!, sessionId);
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-cancel.md');

    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(path.dirname(beadPath), { recursive: true });
    writeFileSync(beadPath, '# bead\n', 'utf8');

    BeadLifecycleService.createTask({
      taskId: 'task-cancel',
      projectId: 'system',
      title: 'Cancel me',
      beadPath,
      status: 'in_progress',
      assignedAgent: 'system',
    });

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'system',
      runtimeSessionId: sessionId,
      status: 'running',
      worktreePath,
      notificationChatId: 'chat-cancel',
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId: sessionId,
      projectId: 'system',
      agentId: 'system',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/sy-cancel-1',
      worktreePath,
      tmuxSessionId: sessionId,
      pid: 123,
      prompt: 'Cancela esta sesión',
      beadPath,
      workItemKey: 'task-cancel',
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: 'chat-cancel',
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId: sessionId,
      targets: [{ path: beadPath, pathKind: 'file' }],
    });

    const originalKillSession = TmuxRuntime.prototype.killSession;
    let killedSessionId: string | null = null;
    TmuxRuntime.prototype.killSession = async (runtimeSessionId: string) => {
      killedSessionId = runtimeSessionId;
      return true;
    };

    try {
      const tool = getTool('cancel_session');
      const result = await tool.execute({ sessionId }) as {
        success: boolean;
        killed: boolean;
        sessionId: string;
      };

      const session = getRuntimeSessionRepository().getByRuntimeSessionId(sessionId);
      const task = BeadLifecycleService.getTaskById('task-cancel');
      const notifications = getEngineNotificationRepository().listAll();

      assert.equal(result.success, true);
      assert.equal(result.killed, true);
      assert.equal(result.sessionId, sessionId);
      assert.equal(killedSessionId, sessionId);
      assert.equal(session?.status, 'cancelled');
      assert.equal(task?.status, 'cancelled');
      assert.equal(task?.runtimeSessionId, sessionId);
      assert.equal(getRuntimeLockRepository().listAllActive().length, 0);
      assert.equal(notifications[0]?.eventType, 'session.cancelled');
      assert.equal(notifications[0]?.targetChatId, 'chat-cancel');
      assert.equal(existsSync(worktreePath), false);
    } finally {
      TmuxRuntime.prototype.killSession = originalKillSession;
    }
  });
});
