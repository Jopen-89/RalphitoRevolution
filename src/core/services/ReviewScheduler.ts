import {
  DEFAULT_EXECUTION_REVIEW_POLL_INTERVAL_MS,
  DEFAULT_EXECUTION_REVIEW_RETRY_BASE_MS,
} from '../domain/constants.js';
import { ExecutionReviewService } from './ExecutionReviewService.js';

export interface ReviewSchedulerPollResult {
  claimed: number;
  approved: number;
  rejected: number;
  deferred: number;
  failed: number;
  busy: boolean;
  recovered: {
    requeued: number;
    failed: number;
  };
}

export class ReviewScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly reviewService = new ExecutionReviewService(),
    private readonly pollIntervalMs = DEFAULT_EXECUTION_REVIEW_POLL_INTERVAL_MS,
    private readonly retryDelayMs = DEFAULT_EXECUTION_REVIEW_RETRY_BASE_MS,
    private readonly workerId = `execution-review-scheduler-${process.pid}`,
  ) {}

  start() {
    if (this.timer) return;

    console.log(`[ReviewScheduler] started interval_ms=${this.pollIntervalMs} worker=${this.workerId}`);
    void this.pollOnce().catch((error: unknown) => {
      console.error(
        '[ReviewScheduler] initial poll failed:',
        error instanceof Error ? error.message : String(error),
      );
    });

    this.timer = setInterval(() => {
      void this.pollOnce().catch((error: unknown) => {
        console.error(
          '[ReviewScheduler] interval poll failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log('[ReviewScheduler] stopped');
  }

  async pollOnce(limit = 4): Promise<ReviewSchedulerPollResult> {
    if (this.running) {
      return {
        claimed: 0,
        approved: 0,
        rejected: 0,
        deferred: 0,
        failed: 0,
        busy: true,
        recovered: { requeued: 0, failed: 0 },
      };
    }

    this.running = true;
    const result: ReviewSchedulerPollResult = {
      claimed: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
      failed: 0,
      busy: false,
      recovered: { requeued: 0, failed: 0 },
    };

    try {
      const recovered = this.reviewService.recoverExpiredClaims({
        retryDelayMs: this.retryDelayMs,
        limit,
      });
      result.recovered.requeued = recovered.requeued.length;
      result.recovered.failed = recovered.failed.length;

      for (let index = 0; index < limit; index += 1) {
        const claimed = this.reviewService.claimNextRunnableReview({
          workerId: this.workerId,
        });
        if (!claimed) break;

        result.claimed += 1;
        let outcome: 'approved' | 'rejected' | 'deferred' | 'failed';
        try {
          outcome = await this.reviewService.processClaimedReview(claimed);
        } catch (error) {
          const retry = this.reviewService.requeueClaimedReview({
            reviewId: claimed.review.id,
            claimToken: claimed.claimToken,
            summary: error instanceof Error ? error.message : String(error),
            retryDelayMs: this.retryDelayMs,
          });
          outcome = retry.status === 'failed' ? 'failed' : 'deferred';
        }
        if (outcome === 'approved') {
          result.approved += 1;
        } else if (outcome === 'rejected') {
          result.rejected += 1;
        } else if (outcome === 'deferred') {
          result.deferred += 1;
        } else {
          result.failed += 1;
        }
      }

      if (
        result.claimed > 0 ||
        result.approved > 0 ||
        result.rejected > 0 ||
        result.deferred > 0 ||
        result.failed > 0 ||
        result.recovered.requeued > 0 ||
        result.recovered.failed > 0
      ) {
        console.log(
          `[ReviewScheduler] poll claimed=${result.claimed} approved=${result.approved} rejected=${result.rejected} deferred=${result.deferred} failed=${result.failed} recovered_requeued=${result.recovered.requeued} recovered_failed=${result.recovered.failed}`,
        );
      }

      return result;
    } finally {
      this.running = false;
    }
  }
}
