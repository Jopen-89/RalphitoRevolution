import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewScheduler } from './ReviewScheduler.js';

test('ReviewScheduler difiere review sin execution_result', async () => {
  const calls: string[] = [];
  const scheduler = new ReviewScheduler(
    {
      recoverExpiredClaims() {
        return { requeued: [], failed: [] };
      },
      claimNextRunnableReview() {
        if (calls.includes('claimed')) return null;
        calls.push('claimed');
        return {
          claimToken: 'claim-1',
          review: {
            id: 'review-1',
            executionJobId: 'job-1',
            taskId: 'task-1',
            runtimeSessionId: null,
            reviewerAgentId: 'juez',
            provider: null,
            model: null,
            status: 'claimed',
            summary: null,
            findingsJson: null,
            inputJson: null,
            reworkTaskId: null,
            claimToken: 'claim-1',
            claimedBy: 'review-worker',
            claimedAt: null,
            claimExpiresAt: null,
            attemptCount: 0,
            maxAttempts: 3,
            nextAttemptAt: null,
            lastError: null,
            createdAt: '2026-03-29T00:00:00.000Z',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-03-29T00:00:00.000Z',
          },
        };
      },
      async processClaimedReview() {
        calls.push('processed');
        return 'deferred' as const;
      },
    } as never,
    1,
    50,
    'test-review-scheduler',
  );

  const result = await scheduler.pollOnce(1);

  assert.deepEqual(calls, ['claimed', 'processed']);
  assert.equal(result.claimed, 1);
  assert.equal(result.approved, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.deferred, 1);
  assert.equal(result.failed, 0);
});
