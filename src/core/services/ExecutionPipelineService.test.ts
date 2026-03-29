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
import type { AgentFallbackRoute } from '../domain/gateway.types.js';
import { createGuardrailRecord } from './guardrails.js';

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

    const fallbacks = [{ provider: 'codex', model: 'gpt-5.4', providerProfile: 'jopen' }] satisfies AgentFallbackRoute[];
    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-job' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      agentConfigId: 'default',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      providerProfile: 'jopen',
      toolMode: 'allowed',
      allowedTools: ['finish_task', 'submit_for_review'],
      fallbacks,
      prompt: 'Implementa todo',
      requestedByAgentId: 'raymon',
    });

    assert.ok(job);
    assert.equal(job?.status, 'pending');
    assert.equal(job?.taskId, 'task-job');
    assert.equal(job?.agentConfigId, 'default');
    assert.equal(job?.toolMode, 'allowed');
    assert.deepEqual(job?.allowedTools, ['finish_task', 'submit_for_review']);
    assert.deepEqual(job?.fallbacks, fallbacks);
    const claim = service.claimJob({
      executionJobId: job!.id,
      workerId: 'test-worker',
      claimedAt: new Date().toISOString(),
    });
    assert.ok(claim);
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
      claimToken: claim!.claimToken,
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
    assert.equal(storedJob?.providerProfile, 'jopen');
    assert.equal(storedJob?.toolMode, 'allowed');
    assert.deepEqual(storedJob?.allowedTools, ['finish_task', 'submit_for_review']);
    assert.deepEqual(storedJob?.fallbacks, fallbacks);
    assert.equal(storedJob?.runtimeSessionId, 'rt-job');
    assert.equal(storedResult?.status, 'done');
    assert.equal(storedResult?.summary, 'Landing OK');
    assert.match(storedResult?.payloadJson || '', /terminalStatus/);
  });
});

test('ExecutionPipelineService reintenta claim fallida y acaba dead al agotar budget', async () => {
  await withTempDb(() => {
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-retry.md');
    BeadLifecycleService.createTask({
      taskId: 'task-retry',
      projectId: 'system',
      title: 'Task con retry bounded',
      beadPath,
    });

    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-retry' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      prompt: 'Retry me',
      requestedByAgentId: 'raymon',
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const claim = service.claimJob({
        executionJobId: job!.id,
        workerId: `worker-${attempt}`,
      });
      assert.ok(claim);
      const scheduled = service.requeueClaimedJob({
        executionJobId: job!.id,
        claimToken: claim!.claimToken,
        summary: `spawn failed ${attempt}`,
        errorCode: 'spawn_failed',
        reason: 'spawn_failed',
        retryDelayMs: 0,
      });
      assert.equal(scheduled.job.status, 'pending');
      assert.equal(scheduled.job.attemptCount, attempt + 1);
      assert.equal(scheduled.result, null);
    }

    const finalClaim = service.claimJob({
      executionJobId: job!.id,
      workerId: 'worker-final',
    });
    assert.ok(finalClaim);
    const terminal = service.requeueClaimedJob({
      executionJobId: job!.id,
      claimToken: finalClaim!.claimToken,
      summary: 'spawn failed final',
      errorCode: 'spawn_failed',
      reason: 'spawn_failed',
      retryDelayMs: 0,
    });

    const repos = getRalphitoRepositories();
    const storedJob = repos.executionJobs.getById(job!.id);
    const storedResult = repos.executionResults.getByExecutionJobId(job!.id);

    assert.equal(terminal.job.status, 'dead');
    assert.equal(storedJob?.status, 'dead');
    assert.equal(storedJob?.attemptCount, 2);
    assert.equal(storedResult?.status, 'dead');
    assert.match(storedResult?.reason || '', /spawn_failed|retry_exhausted/i);
  });
});

test('ExecutionPipelineService recupera claims expiradas y reencola', async () => {
  await withTempDb(() => {
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-expired.md');
    BeadLifecycleService.createTask({
      taskId: 'task-expired-claim',
      projectId: 'system',
      title: 'Task con claim expirada',
      beadPath,
    });

    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-expired-claim' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      prompt: 'Recover me',
      requestedByAgentId: 'raymon',
    });
    const claim = service.claimJob({
      executionJobId: job!.id,
      workerId: 'worker-expired',
    });
    assert.ok(claim);

    const past = '2026-03-20T00:00:00.000Z';
    getRalphitoRepositories().executionJobs.updateStatus({
      id: job!.id,
      status: 'claimed',
      claimToken: claim!.claimToken,
      claimedBy: 'worker-expired',
      claimedAt: past,
      claimExpiresAt: past,
      lastHeartbeatAt: past,
    });

    const recovered = service.recoverExpiredClaims({
      now: '2026-03-21T00:00:00.000Z',
      retryDelayMs: 0,
    });
    const storedJob = getRalphitoRepositories().executionJobs.getById(job!.id);

    assert.deepEqual(recovered.requeued, [job!.id]);
    assert.deepEqual(recovered.dead, []);
    assert.equal(storedJob?.status, 'pending');
    assert.equal(storedJob?.attemptCount, 1);
    assert.equal(storedJob?.claimToken, null);
    assert.equal(storedJob?.lastErrorCode, 'claim_expired');
  });
});

test('ExecutionPipelineService mantiene job en review tras resultado done y cierra al aprobar', async () => {
  await withTempDb(() => {
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-review.md');
    BeadLifecycleService.createTask({
      taskId: 'task-review',
      projectId: 'system',
      title: 'Task con review',
      beadPath,
      status: 'in_progress',
    });

    const now = new Date().toISOString();
    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-review' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      prompt: 'Review me',
      requestedByAgentId: 'raymon',
    });
    const claim = service.claimJob({
      executionJobId: job!.id,
      workerId: 'review-worker',
    });

    getRuntimeSessionRepository().create({
      threadId: insertRuntimeThread('rt-review', now),
      agentId: 'system',
      runtimeSessionId: 'rt-review',
      status: 'running',
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    service.markJobRunning({
      executionJobId: job!.id,
      claimToken: claim!.claimToken,
      runtimeSessionId: 'rt-review',
      branchName: 'jopen/rt-review',
      baseCommitHash: 'abc123',
      startedAt: now,
    });
    service.markJobReviewRequested({
      executionJobId: job!.id,
      summary: 'CI passed',
    });

    const terminal = service.recordTerminalResult({
      executionJobId: job!.id,
      runtimeSessionId: 'rt-review',
      status: 'done',
      summary: 'Landing OK',
      reason: 'landing_completed',
      payload: { terminalStatus: 'done' },
    });

    assert.equal(terminal.job.status, 'review');
    assert.equal(getRalphitoRepositories().executionResults.getByExecutionJobId(job!.id)?.status, 'done');

    const approved = service.markJobReviewApproved({
      executionJobId: job!.id,
      summary: 'Looks good',
      provider: 'openai',
      model: 'gpt-5.4',
    });
    const storedTask = BeadLifecycleService.getTaskById('task-review');

    assert.equal(approved.status, 'done');
    assert.equal(storedTask?.status, 'done');
  });
});

test('ExecutionPipelineService persiste guardrail estructurado en execution_result', async () => {
  await withTempDb(() => {
    const beadPath = path.join(process.env.RALPHITO_REPO_ROOT!, 'docs', 'specs', 'projects', 'system', 'bead-guardrail.md');
    BeadLifecycleService.createTask({
      taskId: 'task-guardrail-result',
      projectId: 'system',
      title: 'Task con guardrail',
      beadPath,
      status: 'in_progress',
    });

    const service = new ExecutionPipelineService();
    const task = resolveExecutionTask({ taskId: 'task-guardrail-result' });
    const job = service.createJob({
      task,
      executorAgentId: 'system',
      executionHarness: 'codex',
      executionProfile: 'jopen',
      provider: 'openai',
      model: 'gpt-5.4',
      prompt: 'Guardrail me',
      requestedByAgentId: 'raymon',
    });
    const guardrail = createGuardrailRecord({
      kind: 'orphan_job',
      scope: 'execution_job',
      summary: 'Job huerfano detectado.',
      taskId: task.id,
      executionJobId: job!.id,
      detectedAt: '2026-03-29T00:00:00.000Z',
    });

    const recorded = service.recordTerminalResult({
      executionJobId: job!.id,
      status: 'failed',
      summary: 'Job huerfano detectado.',
      reason: 'orphan_job',
      payload: { recoveredBy: 'scheduler' },
      guardrail,
    });
    const storedResult = getRalphitoRepositories().executionResults.getByExecutionJobId(job!.id);

    assert.equal(recorded.job.status, 'failed');
    assert.equal(recorded.job.lastErrorCode, 'orphan_job');
    assert.match(storedResult?.payloadJson || '', /"guardrail":/);
    assert.match(storedResult?.payloadJson || '', /"kind":"orphan_job"/);
    assert.match(storedResult?.payloadJson || '', /"recoveredBy":"scheduler"/);
  });
});
