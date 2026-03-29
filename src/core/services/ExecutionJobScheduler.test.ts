import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  getRalphitoRepositories,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import { ExecutionJobScheduler } from './ExecutionJobScheduler.js';
import { ExecutionPipelineService } from './ExecutionPipelineService.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from '../engine/runtimeLockRepository.js';
import { getRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';
import type { SpawnRuntimeSessionResult } from './SessionManager.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const repoRoot = createTempDirectory('rr-scheduler-repo-');
  const worktreeRoot = createTempDirectory('rr-scheduler-worktrees-');

  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeLockRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeLockRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;
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

function createPersistedTask(taskId: string, beadFileName: string) {
  const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', beadFileName);
  const targetPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'src', `${taskId}.ts`);
  mkdirSync(path.dirname(beadPath), { recursive: true });
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, '// target\n', 'utf8');
  writeFileSync(beadPath, `[WRITE_ONLY_GLOBS]: ["src/${taskId}.ts"]\n`, 'utf8');

  return {
    task: BeadLifecycleService.createTask({
      taskId,
      projectId: 'system',
      title: taskId,
      beadPath,
    }),
    targetPath,
  };
}

test('ExecutionJobScheduler reclama job pending y lo arranca', async () => {
  await withTempRuntime(async () => {
    const executionPipeline = new ExecutionPipelineService();
    const created = createPersistedTask('task-scheduler-start', 'bead-scheduler-start.md');
    const job = executionPipeline.createJob({
      task: created.task!,
      executorAgentId: 'system',
      agentConfigId: 'default',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      toolMode: 'allowed',
      allowedTools: ['finish_task'],
      prompt: 'Start scheduler job',
      requestedByAgentId: 'raymon',
    });
    const launchCalls: Array<{ executionJobId: string; claimToken: string; workerId?: string }> = [];

    const scheduler = new ExecutionJobScheduler(
      executionPipeline,
      {
        async launchExecutionJob(input: { executionJobId: string; claimToken: string; workerId?: string }) {
          launchCalls.push(input);
          const startedAt = '2026-03-29T00:00:00.000Z';
          getRuntimeSessionRepository().create({
            threadId: insertRuntimeThread('rt-scheduler-1', startedAt),
            agentId: 'system',
            runtimeSessionId: 'rt-scheduler-1',
            status: 'queued',
            startedAt,
            heartbeatAt: startedAt,
            createdAt: startedAt,
            updatedAt: startedAt,
          });
          executionPipeline.markJobRunning({
            executionJobId: input.executionJobId,
            claimToken: input.claimToken,
            runtimeSessionId: 'rt-scheduler-1',
            branchName: 'jopen/rt-scheduler-1',
            baseCommitHash: 'abc123',
            startedAt,
          });

          return {
            taskId: job!.taskId,
            executionJobId: input.executionJobId,
            runtimeSessionId: 'rt-scheduler-1',
            baseCommitHash: 'abc123',
            worktreePath: '/tmp/rt-scheduler-1',
            branchName: 'jopen/rt-scheduler-1',
          } satisfies SpawnRuntimeSessionResult;
        },
      } as never,
      1,
      50,
      'test-scheduler',
    );

    const result = await scheduler.pollOnce(1);
    const storedJob = getRalphitoRepositories().executionJobs.getById(job!.id);

    assert.equal(result.claimed, 1);
    assert.equal(result.started, 1);
    assert.equal(result.deferred, 0);
    assert.equal(result.failed, 0);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0]?.executionJobId, job!.id);
    assert.ok(launchCalls[0]?.claimToken);
    assert.equal(storedJob?.status, 'running');
    assert.equal(storedJob?.runtimeSessionId, 'rt-scheduler-1');
  });
});

test('ExecutionJobScheduler difiere job con lock conflict sin consumir intento', async () => {
  await withTempRuntime(async () => {
    const executionPipeline = new ExecutionPipelineService();
    const created = createPersistedTask('task-scheduler-lock', 'bead-scheduler-lock.md');
    const job = executionPipeline.createJob({
      task: created.task!,
      executorAgentId: 'system',
      agentConfigId: 'default',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      toolMode: 'allowed',
      allowedTools: ['finish_task'],
      prompt: 'Defer scheduler job',
      requestedByAgentId: 'raymon',
    });
    const before = getRalphitoRepositories().executionJobs.getById(job!.id);
    let launchCalls = 0;

    getRuntimeLockRepository().acquireForSession({
      runtimeSessionId: 'lock-holder',
      targets: [{ path: created.targetPath, pathKind: 'file' }],
    });

    const scheduler = new ExecutionJobScheduler(
      executionPipeline,
      {
        async launchExecutionJob() {
          launchCalls += 1;
          throw new Error('LOCK_CONFLICT: same src/task-scheduler-lock.ts');
        },
      } as never,
      1,
      50,
      'test-scheduler',
    );

    const result = await scheduler.pollOnce(1);
    const storedJob = getRalphitoRepositories().executionJobs.getById(job!.id);

    assert.equal(result.claimed, 1);
    assert.equal(result.started, 0);
    assert.equal(result.deferred, 1);
    assert.equal(result.failed, 0);
    assert.equal(launchCalls, 1);
    assert.equal(storedJob?.status, 'pending');
    assert.equal(storedJob?.attemptCount, 0);
    assert.equal(storedJob?.claimToken, null);
    assert.match(storedJob?.failureReason || '', /LOCK_CONFLICT/i);
    assert.ok((storedJob?.nextAttemptAt || '') >= (before?.createdAt || ''));
  });
});

test('ExecutionJobScheduler corta running job huerfano', async () => {
  await withTempRuntime(async () => {
    const executionPipeline = new ExecutionPipelineService();
    const created = createPersistedTask('task-scheduler-orphan', 'bead-scheduler-orphan.md');
    const job = executionPipeline.createJob({
      task: created.task!,
      executorAgentId: 'system',
      agentConfigId: 'default',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      toolMode: 'allowed',
      allowedTools: ['finish_task'],
      prompt: 'Orphan scheduler job',
      requestedByAgentId: 'raymon',
    });
    const oldIso = '2026-03-20T00:00:00.000Z';

    getRalphitoRepositories().executionJobs.updateStatus({
      id: job!.id,
      status: 'running',
      runtimeSessionId: null,
      startedAt: oldIso,
      lastHeartbeatAt: oldIso,
    });

    const scheduler = new ExecutionJobScheduler(
      executionPipeline,
      {
        async launchExecutionJob() {
          throw new Error('should not launch');
        },
      } as never,
      1,
      50,
      'test-scheduler',
      0,
      {
        async isAlive() {
          return false;
        },
      } as never,
    );

    const result = await scheduler.pollOnce(1);
    const storedJob = getRalphitoRepositories().executionJobs.getById(job!.id);
    const storedResult = getRalphitoRepositories().executionResults.getByExecutionJobId(job!.id);
    const storedTask = BeadLifecycleService.getTaskById(created.task!.id);

    assert.equal(result.orphaned, 1);
    assert.equal(result.claimed, 0);
    assert.equal(storedJob?.status, 'failed');
    assert.equal(storedJob?.lastErrorCode, 'orphan_job');
    assert.equal(storedResult?.status, 'failed');
    assert.match(storedResult?.payloadJson || '', /"kind":"orphan_job"/);
    assert.equal(storedTask?.status, 'blocked');
  });
});
