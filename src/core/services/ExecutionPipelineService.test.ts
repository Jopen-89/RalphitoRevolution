import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  getRalphitoRepositories,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import { ExecutionPipelineService, resolveExecutionTask } from './ExecutionPipelineService.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { tmpDir: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const tmpDir = createTempDirectory('rr-execution-pipeline-');

  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = tmpDir;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ tmpDir }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

function insertRuntimeThread(runtimeSessionId: string, createdAt: string) {
  return Number(
    initializeRalphitoDatabase()
      .prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run('runtime', runtimeSessionId, runtimeSessionId, createdAt, createdAt).lastInsertRowid,
  );
}

test('resolveExecutionTask exige task persistida', async () => {
  await withTempDb(() => {
    assert.throws(
      () => resolveExecutionTask({ beadPath: 'docs/specs/projects/system/missing-bead.md', projectId: 'system' }),
      /Task persistida requerida/i,
    );
  });
});

test('ExecutionPipelineService persiste job running y result terminal', async () => {
  await withTempDb(() => {
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-job.md');
    BeadLifecycleService.createTask({
      taskId: 'task-job',
      projectId: 'system',
      title: 'Task con job',
      beadPath,
    });

    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-job' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      prompt: 'Implementa todo',
      requestedByAgentId: 'raymon',
    });

    assert.ok(job);
    assert.equal(job?.status, 'pending');
    assert.equal(job?.taskId, 'task-job');
    const now = new Date().toISOString();

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread('rt-job', now),
      agentId: 'system',
      runtimeSessionId: 'rt-job',
      status: 'running',
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const running = service.markJobRunning({
      executionJobId: job!.id,
      runtimeSessionId: 'rt-job',
      branchName: 'jopen/rt-job',
      baseCommitHash: 'abc123',
    });

    assert.equal(running.status, 'running');
    assert.equal(running.runtimeSessionId, 'rt-job');

    const recorded = service.recordTerminalResult({
      executionJobId: job!.id,
      runtimeSessionId: 'rt-job',
      status: 'done',
      summary: 'Landing OK',
      reason: 'landing_completed',
      payload: { terminalStatus: 'done' },
    });

    const repos = getRalphitoRepositories();
    const storedJob = repos.executionJobs.getById(job!.id);
    const storedResult = repos.executionResults.getByExecutionJobId(job!.id);

    assert.equal(recorded.job.status, 'done');
    assert.equal(storedJob?.status, 'done');
    assert.equal(storedJob?.runtimeSessionId, 'rt-job');
    assert.equal(storedResult?.status, 'done');
    assert.equal(storedResult?.summary, 'Landing OK');
    assert.match(storedResult?.payloadJson || '', /terminalStatus/);
  });
});
