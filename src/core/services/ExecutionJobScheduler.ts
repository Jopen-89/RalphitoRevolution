import {
  DEFAULT_EXECUTION_JOB_POLL_INTERVAL_MS,
  DEFAULT_EXECUTION_JOB_RETRY_BASE_MS,
  DEFAULT_RUNTIME_ORPHAN_JOB_GRACE_MS,
} from '../domain/constants.js';
import {
  getRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { getOrchestrator } from '../engine/orchestrator.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';
import { getRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';
import {
  ExecutionPipelineService,
  type ClaimedExecutionJob,
} from './ExecutionPipelineService.js';
import {
  createGuardrailRecord,
  recordGuardrailEvent,
} from './guardrails.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';

export interface ExecutionJobSchedulerPollResult {
  claimed: number;
  started: number;
  deferred: number;
  failed: number;
  orphaned: number;
  busy: boolean;
  recovered: {
    requeued: number;
    dead: number;
  };
}

function addMs(iso: string, deltaMs: number) {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

export class ExecutionJobScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly runtimeSessionRepository = getRuntimeSessionRepository();

  constructor(
    private readonly executionPipeline = new ExecutionPipelineService(),
    private readonly orchestrator = getOrchestrator(),
    private readonly pollIntervalMs = DEFAULT_EXECUTION_JOB_POLL_INTERVAL_MS,
    private readonly retryDelayMs = DEFAULT_EXECUTION_JOB_RETRY_BASE_MS,
    private readonly workerId = `execution-scheduler-${process.pid}`,
    private readonly orphanJobGraceMs = DEFAULT_RUNTIME_ORPHAN_JOB_GRACE_MS,
    private readonly tmuxRuntime = new TmuxRuntime(),
  ) {}

  start() {
    if (this.timer) return;

    console.log(`[ExecutionJobScheduler] started interval_ms=${this.pollIntervalMs} worker=${this.workerId}`);
    void this.pollOnce().catch((error: unknown) => {
      console.error(
        '[ExecutionJobScheduler] initial poll failed:',
        error instanceof Error ? error.message : String(error),
      );
    });

    this.timer = setInterval(() => {
      void this.pollOnce().catch((error: unknown) => {
        console.error(
          '[ExecutionJobScheduler] interval poll failed:',
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
    console.log('[ExecutionJobScheduler] stopped');
  }

  async pollOnce(limit = 4): Promise<ExecutionJobSchedulerPollResult> {
    if (this.running) {
      return {
        claimed: 0,
        started: 0,
        deferred: 0,
        failed: 0,
        orphaned: 0,
        busy: true,
        recovered: { requeued: 0, dead: 0 },
      };
    }

    this.running = true;
    const result: ExecutionJobSchedulerPollResult = {
      claimed: 0,
      started: 0,
      deferred: 0,
      failed: 0,
      orphaned: 0,
      busy: false,
      recovered: { requeued: 0, dead: 0 },
    };

    try {
      const now = new Date().toISOString();
      const recovered = this.executionPipeline.recoverExpiredClaims({
        now,
        retryDelayMs: this.retryDelayMs,
        limit,
      });
      result.recovered.requeued = recovered.requeued.length;
      result.recovered.dead = recovered.dead.length;
      result.orphaned = await this.recoverOrphanedRunningJobs(now, limit);

      for (let index = 0; index < limit; index += 1) {
        const claimed = this.executionPipeline.claimNextRunnableJob({
          workerId: this.workerId,
        });
        if (!claimed) break;

        result.claimed += 1;
        const outcome = await this.launchClaimedJob(claimed);
        if (outcome === 'started') {
          result.started += 1;
        } else if (outcome === 'deferred') {
          result.deferred += 1;
        } else {
          result.failed += 1;
        }
      }

      if (
        result.claimed > 0 ||
        result.failed > 0 ||
        result.deferred > 0 ||
        result.recovered.requeued > 0 ||
        result.recovered.dead > 0 ||
        result.orphaned > 0
      ) {
        console.log(
          `[ExecutionJobScheduler] poll claimed=${result.claimed} started=${result.started} deferred=${result.deferred} failed=${result.failed} orphaned=${result.orphaned} recovered_requeued=${result.recovered.requeued} recovered_dead=${result.recovered.dead}`,
        );
      }

      return result;
    } finally {
      this.running = false;
    }
  }

  private async launchClaimedJob(claimed: ClaimedExecutionJob) {
    const now = new Date().toISOString();

    try {
      await this.orchestrator.launchExecutionJob({
        executionJobId: claimed.job.id,
        claimToken: claimed.claimToken,
        workerId: this.workerId,
      });
      return 'started' as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentJob = getRalphitoRepositories().executionJobs.getById(claimed.job.id);

      if (
        message.includes('LOCK_CONFLICT') &&
        currentJob?.status === 'claimed' &&
        currentJob.claimToken === claimed.claimToken
      ) {
        this.executionPipeline.releaseClaim({
          executionJobId: claimed.job.id,
          claimToken: claimed.claimToken,
          nextAttemptAt: addMs(now, this.retryDelayMs),
          reason: message,
        });
        return 'deferred' as const;
      }

      if (currentJob?.status === 'claimed' && currentJob.claimToken === claimed.claimToken) {
        try {
          this.executionPipeline.requeueClaimedJob({
            executionJobId: claimed.job.id,
            claimToken: claimed.claimToken,
            summary: message,
            reason: 'spawn_failed',
            errorCode: 'spawn_failed',
            retryDelayMs: this.retryDelayMs,
            payload: {
              kind: 'spawn_failed',
            },
          });
        } catch (requeueError) {
          console.error(
            '[ExecutionJobScheduler] requeue failed:',
            requeueError instanceof Error ? requeueError.message : String(requeueError),
          );
        }
      }

      return 'failed' as const;
    }
  }

  private async recoverOrphanedRunningJobs(now: string, limit: number) {
    const cutoff = addMs(now, -this.orphanJobGraceMs);
    const runningJobs = getRalphitoRepositories().executionJobs.listByStatuses(['running'], limit * 4);
    let recovered = 0;

    for (const job of runningJobs) {
      const session = job.runtimeSessionId
        ? this.runtimeSessionRepository.getByRuntimeSessionId(job.runtimeSessionId)
        : null;
      const staleHeartbeat = (session?.heartbeatAt || job.lastHeartbeatAt || job.updatedAt) < cutoff;
      const terminalSession = session
        ? session.status === 'done' || session.status === 'failed' || session.status === 'cancelled' || session.status === 'stuck'
        : false;
      const needsTmuxCheck = !job.runtimeSessionId || !session || terminalSession || staleHeartbeat;

      if (!needsTmuxCheck) continue;

      let alive = false;
      if (job.runtimeSessionId) {
        try {
          alive = await this.tmuxRuntime.isAlive(job.runtimeSessionId);
        } catch {
          alive = false;
        }
      }
      if (alive) continue;

      const summary = !job.runtimeSessionId
        ? `Execution job ${job.id} quedo running sin runtime_session_id.`
        : !session
          ? `Execution job ${job.id} quedo running sin runtime session persistida (${job.runtimeSessionId}).`
          : terminalSession
            ? `Execution job ${job.id} quedo running pero la runtime ${job.runtimeSessionId} ya esta ${session.status}.`
            : `Execution job ${job.id} quedo running sin heartbeat viva reciente.`;
      const guardrail = recordGuardrailEvent(createGuardrailRecord({
        kind: 'orphan_job',
        scope: 'execution_job',
        summary,
        reasonCode: !job.runtimeSessionId
          ? 'missing_runtime_session_id'
          : !session
            ? 'missing_runtime_session'
            : terminalSession
              ? `runtime_${session.status}`
              : 'stale_heartbeat',
        detectedAt: now,
        taskId: job.taskId,
        executionJobId: job.id,
        runtimeSessionId: job.runtimeSessionId,
        metadata: {
          jobStatus: job.status,
          lastHeartbeatAt: job.lastHeartbeatAt,
          runtimeSessionStatus: session?.status || null,
          runtimeHeartbeatAt: session?.heartbeatAt || null,
        },
      }), 'error');

      this.executionPipeline.markJobFailed({
        executionJobId: job.id,
        runtimeSessionId: job.runtimeSessionId,
        summary,
        reason: guardrail.kind,
        errorCode: guardrail.kind,
        payload: {
          recoveredBy: this.workerId,
        },
        guardrail,
      });
      BeadLifecycleService.blockTask({ taskId: job.taskId, failureReason: summary });
      recovered += 1;
    }

    return recovered;
  }
}
