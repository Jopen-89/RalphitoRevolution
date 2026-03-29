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
import type { ILLMProvider, Message } from '../domain/gateway.types.js';
import { AgentRegistryService } from './AgentRegistry.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import { ExecutionPipelineService } from './ExecutionPipelineService.js';
import {
  ExecutionReviewService,
  type ExecutionReviewInputSnapshot,
} from './ExecutionReviewService.js';
import { resetRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { repoRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const repoRoot = createTempDirectory('rr-execution-review-');

  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn({ repoRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      rmSync(repoRoot, { force: true, recursive: true });
    });
}

function createReviewFixture(taskId: string, repoRoot: string) {
  const beadPath = path.join(repoRoot, 'docs', 'specs', 'projects', 'system', `${taskId}.md`);
  BeadLifecycleService.createTask({
    taskId,
    projectId: 'system',
    title: taskId,
    beadPath,
    status: 'in_progress',
  });

  const executionPipeline = new ExecutionPipelineService();
  const task = BeadLifecycleService.getTaskById(taskId)!;
  const job = executionPipeline.createJob({
    task,
    executorAgentId: 'system',
    executionHarness: 'codex',
    executionProfile: 'jopen',
    provider: 'openai',
    model: 'gpt-5.4',
    prompt: 'Review fixture',
    requestedByAgentId: 'raymon',
  })!;

  getRalphitoRepositories().executionJobs.updateStatus({
    id: job.id,
    status: 'review',
    branchName: `jopen/${taskId}`,
    baseCommitHash: 'abc123',
    finishedAt: '2026-03-29T00:00:00.000Z',
  });
  getRalphitoRepositories().executionResults.upsert({
    id: `${job.id}-result`,
    executionJobId: job.id,
    taskId: job.taskId,
    status: 'done',
    summary: 'Landing OK',
    reason: 'landing_completed',
    branchName: `jopen/${taskId}`,
    baseCommitHash: 'abc123',
    payloadJson: JSON.stringify({ terminalStatus: 'done' }),
  });

  const snapshot: ExecutionReviewInputSnapshot = {
    reviewRequestedAt: '2026-03-29T00:00:00.000Z',
    verificationSummary: 'CI PASSED',
    beadPath,
    beadContent: '# bead',
    branchName: `jopen/${taskId}`,
    baseCommitHash: 'abc123',
    diffCached: null,
    diffWorkingTree: null,
    diffFromBase: 'diff --git a/src/a.ts b/src/a.ts\n+const ok = true;\n',
    gitStatus: null,
  };
  const review = getRalphitoRepositories().executionReviews.upsert({
    id: `${job.id}-review`,
    executionJobId: job.id,
    taskId: job.taskId,
    reviewerAgentId: 'juez',
    status: 'pending',
    inputJson: JSON.stringify(snapshot),
  })!;

  return { executionPipeline, task, job, review, beadPath };
}

function stubProvider(responseText: string): ILLMProvider {
  return {
    name: 'openai',
    async generateResponse(_messages: Message[]) {
      return responseText;
    },
  };
}

test('ExecutionReviewService approves review y cierra task/job', async () => {
  await withTempDb(async ({ repoRoot }) => {
    const { job } = createReviewFixture('task-review-approve', repoRoot);
    const service = new ExecutionReviewService(
      new ExecutionPipelineService(),
      new CommandRunner(),
      async () => stubProvider(JSON.stringify({
        verdict: 'approved',
        summary: 'Todo bien.',
        findings: [],
        reworkTitle: null,
      })),
    );

    const claimed = service.claimNextRunnableReview({ workerId: 'review-worker' });
    assert.ok(claimed);

    const outcome = await service.processClaimedReview(claimed!);
    const storedReview = getRalphitoRepositories().executionReviews.getByExecutionJobId(job.id);
    const storedJob = getRalphitoRepositories().executionJobs.getById(job.id);
    const storedTask = BeadLifecycleService.getTaskById('task-review-approve');

    assert.equal(outcome, 'approved');
    assert.equal(storedReview?.status, 'approved');
    assert.equal(storedJob?.status, 'done');
    assert.equal(storedTask?.status, 'done');
  });
});

test('ExecutionReviewService rejects review y crea task hija', async () => {
  await withTempDb(async ({ repoRoot }) => {
    const { job, beadPath } = createReviewFixture('task-review-reject', repoRoot);
    const service = new ExecutionReviewService(
      new ExecutionPipelineService(),
      new CommandRunner(),
      async () => stubProvider(JSON.stringify({
        verdict: 'rejected',
        summary: 'Falta cubrir edge case.',
        findings: [
          { severity: 'high', file: 'src/a.ts', line: 7, message: 'Maneja null.' },
        ],
        reworkTitle: 'Rework: edge case null',
      })),
    );

    const claimed = service.claimNextRunnableReview({ workerId: 'review-worker' });
    assert.ok(claimed);

    const outcome = await service.processClaimedReview(claimed!);
    const storedReview = getRalphitoRepositories().executionReviews.getByExecutionJobId(job.id);
    const storedJob = getRalphitoRepositories().executionJobs.getById(job.id);
    const parentTask = BeadLifecycleService.getTaskById('task-review-reject');
    const relatedTasks = BeadLifecycleService.listTasksBySourceSpec({ sourceSpecPath: beadPath });
    const reworkTask = relatedTasks.find((task) => task.parentTaskId === 'task-review-reject');

    assert.equal(outcome, 'rejected');
    assert.equal(storedReview?.status, 'rejected');
    assert.ok(storedReview?.reworkTaskId);
    assert.equal(storedJob?.status, 'failed');
    assert.equal(parentTask?.status, 'blocked');
    assert.equal(reworkTask?.id, storedReview?.reworkTaskId);
    assert.equal(reworkTask?.status, 'pending');
  });
});

test('ExecutionReviewService recoverExpiredClaims marca stale_review', async () => {
  await withTempDb(async ({ repoRoot }) => {
    const { job, review } = createReviewFixture('task-review-stale', repoRoot);
    const service = new ExecutionReviewService(
      new ExecutionPipelineService(),
      new CommandRunner(),
      async () => stubProvider('{"verdict":"approved","summary":"ok","findings":[],"reworkTitle":null}'),
    );

    getRalphitoRepositories().executionReviews.updateStatus({
      id: review.id,
      status: 'claimed',
      claimToken: 'claim-stale',
      claimedBy: 'review-worker',
      claimedAt: '2026-03-20T00:00:00.000Z',
      claimExpiresAt: '2026-03-20T00:00:00.000Z',
    });

    const recovered = service.recoverExpiredClaims({
      now: '2026-03-21T00:00:00.000Z',
      retryDelayMs: 0,
    });
    const storedReview = getRalphitoRepositories().executionReviews.getById(review.id);
    const db = initializeRalphitoDatabase();
    const guardrailEvent = db
      .prepare(
        `
          SELECT payload_json AS payloadJson
          FROM system_events
          WHERE event_type = 'guardrail_detected'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get() as { payloadJson: string } | undefined;

    assert.deepEqual(recovered.requeued, [review.id]);
    assert.deepEqual(recovered.failed, []);
    assert.equal(storedReview?.status, 'pending');
    assert.equal(storedReview?.lastError, 'stale_review');
    assert.match(guardrailEvent?.payloadJson || '', /"kind":"stale_review"/);
    assert.equal(getRalphitoRepositories().executionJobs.getById(job.id)?.status, 'review');
  });
});
