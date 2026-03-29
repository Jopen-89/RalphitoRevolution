import { randomUUID } from 'crypto';
import type { AgentFallbackRoute, ExecutionHarness, Provider, ToolMode } from '../domain/gateway.types.js';
import {
  DEFAULT_EXECUTION_JOB_CLAIM_LEASE_MS,
  DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS,
  DEFAULT_EXECUTION_JOB_RETRY_BASE_MS,
} from '../domain/constants.js';
import { refreshRuntimeSessionSummary, refreshTaskSummary } from './summaryService.js';
import { BeadLifecycleService, type LifecycleTaskRecord } from './BeadLifecycleService.js';
import {
  attachGuardrailPayload,
  type ExecutionGuardrailRecord,
} from './guardrails.js';
import {
  getRalphitoRepositories,
  type ExecutionJobRecord,
  type ExecutionResultRecord,
  type ExecutionResultStatus,
} from '../../infrastructure/persistence/db/index.js';
import { getRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';

const ACTIVE_RUNTIME_SESSION_STATUSES = new Set(['queued', 'running', 'suspended_human_input']);

export interface ExecutionTaskReferenceInput {
  taskId?: string | null;
  beadPath?: string | null;
  projectId?: string | null;
}

export interface CreateExecutionJobInput {
  task: LifecycleTaskRecord;
  executorAgentId: string;
  agentConfigId?: string | null;
  executionHarness: ExecutionHarness;
  executionProfile?: string | null;
  provider?: Provider | null;
  model?: string | null;
  providerProfile?: string | null;
  toolMode?: ToolMode;
  allowedTools?: string[];
  fallbacks?: AgentFallbackRoute[];
  prompt?: string | null;
  requestedByAgentId?: string | null;
  originThreadId?: number | null;
  notificationChatId?: string | null;
}

export interface MarkExecutionJobRunningInput {
  executionJobId: string;
  claimToken: string;
  runtimeSessionId: string;
  branchName: string;
  baseCommitHash: string;
  startedAt?: string;
}

export interface ClaimExecutionJobInput {
  executionJobId: string;
  workerId: string;
  leaseMs?: number;
  claimedAt?: string;
}

export interface ClaimNextExecutionJobInput {
  workerId: string;
  leaseMs?: number;
  claimedAt?: string;
}

export interface ClaimedExecutionJob {
  claimToken: string;
  job: ExecutionJobRecord;
}

export interface RequeueClaimedExecutionJobInput {
  executionJobId: string;
  claimToken: string;
  summary: string;
  reason?: string | null;
  errorCode?: string | null;
  retryDelayMs?: number;
  failedAt?: string;
  payload?: unknown;
}

export interface RecoverExpiredClaimsResult {
  requeued: string[];
  dead: string[];
}

export interface RecordExecutionTerminalResultInput {
  executionJobId: string;
  status: ExecutionResultStatus;
  runtimeSessionId?: string | null;
  summary?: string | null;
  reason?: string | null;
  errorCode?: string | null;
  branchName?: string | null;
  baseCommitHash?: string | null;
  payload?: unknown;
  guardrail?: ExecutionGuardrailRecord | null;
}

function normalizeText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function addMs(iso: string, deltaMs: number) {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

function requireExecutableTask(task: LifecycleTaskRecord | null, input: ExecutionTaskReferenceInput) {
  if (!task) {
    throw new Error(
      `Task persistida requerida. Usa taskId o beadPath registrado en SQLite.${input.taskId ? ` taskId=${input.taskId}` : ''}${input.beadPath ? ` beadPath=${input.beadPath}` : ''}`,
    );
  }

  const executionBeadPath = normalizeText(task.beadPath) || normalizeText(task.sourceSpecPath);
  if (!executionBeadPath) {
    throw new Error(`Task ${task.id} no tiene beadPath/sourceSpecPath. No se puede lanzar ejecución sin bead persistida.`);
  }

  if (task.status === 'done' || task.status === 'cancelled') {
    throw new Error(`Task ${task.id} está ${task.status}. Reabre o crea una task hija antes de ejecutar.`);
  }

  const activeRuntimeSessionId = normalizeText(task.runtimeSessionId);
  if (activeRuntimeSessionId) {
    const session = getRuntimeSessionRepository().getByRuntimeSessionId(activeRuntimeSessionId);
    if (session && ACTIVE_RUNTIME_SESSION_STATUSES.has(session.status)) {
      throw new Error(`Task ${task.id} ya tiene ejecución activa: ${activeRuntimeSessionId}.`);
    }
  }

  return task;
}

export function resolveExecutionTask(input: ExecutionTaskReferenceInput) {
  const task = input.taskId
    ? BeadLifecycleService.getTaskById(input.taskId)
    : BeadLifecycleService.resolveTask({
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.beadPath ? { beadPath: input.beadPath } : {}),
      });

  return requireExecutableTask(task, input);
}

function appendTaskExecutionEvent(taskId: string, eventType: string, payload: Record<string, unknown>) {
  getRalphitoRepositories().taskEvents.append({
    taskId,
    eventType,
    payloadJson: JSON.stringify(payload),
  });
  refreshTaskSummary(taskId);
}

export class ExecutionPipelineService {
  createJob(input: CreateExecutionJobInput) {
    const repos = getRalphitoRepositories();
    const task = requireExecutableTask(input.task, { taskId: input.task.id });
    const activeJob = repos.executionJobs.findActiveByTaskId(task.id);
    if (activeJob) {
      throw new Error(`Task ${task.id} ya tiene execution job activa: ${activeJob.id}.`);
    }

    const prompt = normalizeText(input.prompt) || `Implementa la task ${task.id}: ${task.title}`;
    const job = repos.executionJobs.create({
      id: randomUUID(),
      taskId: task.id,
      projectId: task.projectId || input.executorAgentId,
      agentId: input.executorAgentId,
      agentConfigId: input.agentConfigId || null,
      executionHarness: input.executionHarness,
      executionProfile: input.executionProfile || null,
      provider: input.provider || null,
      model: input.model || null,
      providerProfile: input.providerProfile || null,
      toolMode: input.toolMode || 'none',
      allowedTools: [...(input.allowedTools || [])],
      fallbacks: [...(input.fallbacks || [])],
      status: 'pending',
      prompt,
      beadPath: task.beadPath || task.sourceSpecPath,
      requestedByAgentId: input.requestedByAgentId || null,
      originThreadId: input.originThreadId ?? null,
      notificationChatId: input.notificationChatId || null,
      maxAttempts: DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS,
    });
    if (!job) {
      throw new Error(`No pude persistir execution job para task ${task.id}`);
    }

    appendTaskExecutionEvent(task.id, 'execution_job_created', {
      executionJobId: job.id,
      status: 'pending',
      agentId: input.executorAgentId,
      agentConfigId: input.agentConfigId || null,
      executionHarness: input.executionHarness,
      executionProfile: input.executionProfile || null,
      provider: input.provider || null,
      model: input.model || null,
      toolMode: input.toolMode || 'none',
    });

    return job;
  }

  claimJob(input: ClaimExecutionJobInput): ClaimedExecutionJob | null {
    const repos = getRalphitoRepositories();
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claimToken = randomUUID();
    const job = repos.executionJobs.claim({
      id: input.executionJobId,
      workerId: input.workerId,
      claimToken,
      claimedAt,
      claimExpiresAt: addMs(claimedAt, input.leaseMs ?? DEFAULT_EXECUTION_JOB_CLAIM_LEASE_MS),
    });
    if (!job) return null;

    appendTaskExecutionEvent(job.taskId, 'execution_job_claimed', {
      executionJobId: job.id,
      status: 'claimed',
      claimedBy: input.workerId,
      claimedAt,
    });

    return { claimToken, job };
  }

  claimNextRunnableJob(input: ClaimNextExecutionJobInput): ClaimedExecutionJob | null {
    const repos = getRalphitoRepositories();
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claimToken = randomUUID();
    const job = repos.executionJobs.claimNext({
      workerId: input.workerId,
      claimToken,
      claimedAt,
      claimExpiresAt: addMs(claimedAt, input.leaseMs ?? DEFAULT_EXECUTION_JOB_CLAIM_LEASE_MS),
    });
    if (!job) return null;

    appendTaskExecutionEvent(job.taskId, 'execution_job_claimed', {
      executionJobId: job.id,
      status: 'claimed',
      claimedBy: input.workerId,
      claimedAt,
    });

    return { claimToken, job };
  }

  heartbeatClaim(input: {
    executionJobId: string;
    claimToken: string;
    heartbeatAt?: string;
    leaseMs?: number;
  }) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    const job = getRalphitoRepositories().executionJobs.heartbeatClaim({
      id: input.executionJobId,
      claimToken: input.claimToken,
      heartbeatAt,
      claimExpiresAt: addMs(heartbeatAt, input.leaseMs ?? DEFAULT_EXECUTION_JOB_CLAIM_LEASE_MS),
    });

    if (!job) {
      throw new Error(`Execution job claim missing: ${input.executionJobId}`);
    }

    return job;
  }

  releaseClaim(input: {
    executionJobId: string;
    claimToken: string;
    nextAttemptAt?: string | null;
    reason?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'claimed' || existing.claimToken !== input.claimToken) {
      throw new Error(`Execution job claim mismatch: ${input.executionJobId}`);
    }

    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'pending',
      claimToken: null,
      claimedBy: existing.claimedBy,
      claimedAt: existing.claimedAt,
      claimExpiresAt: null,
      nextAttemptAt: input.nextAttemptAt ?? new Date().toISOString(),
      lastHeartbeatAt: existing.lastHeartbeatAt,
      failureReason: normalizeText(input.reason),
    });
    if (!job) {
      throw new Error(`Execution job release failed: ${input.executionJobId}`);
    }

    appendTaskExecutionEvent(job.taskId, 'execution_job_released', {
      executionJobId: job.id,
      status: 'pending',
      reason: normalizeText(input.reason),
      nextAttemptAt: job.nextAttemptAt,
    });

    return job;
  }

  recoverExpiredClaims(input: {
    now?: string;
    retryDelayMs?: number;
    limit?: number;
  } = {}): RecoverExpiredClaimsResult {
    const now = input.now || new Date().toISOString();
    const expiredJobs = getRalphitoRepositories().executionJobs.listExpiredClaims(now, input.limit ?? 20);
    const result: RecoverExpiredClaimsResult = { requeued: [], dead: [] };

    for (const job of expiredJobs) {
      if (!job.claimToken) continue;

      const recovered = this.requeueClaimedJob({
        executionJobId: job.id,
        claimToken: job.claimToken,
        summary: 'Execution job claim expired.',
        reason: 'claim_expired',
        errorCode: 'claim_expired',
        retryDelayMs: input.retryDelayMs ?? DEFAULT_EXECUTION_JOB_RETRY_BASE_MS,
        failedAt: now,
        payload: {
          claimExpiredAt: job.claimExpiresAt,
        },
      });

      if ('result' in recovered && recovered.result) {
        result.dead.push(recovered.job.id);
      } else {
        result.requeued.push(recovered.job.id);
      }
    }

    return result;
  }

  markJobRunning(input: MarkExecutionJobRunningInput) {
    const repos = getRalphitoRepositories();
    const startedAt = input.startedAt || new Date().toISOString();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'claimed' || existing.claimToken !== input.claimToken) {
      throw new Error(`Execution job claim mismatch: ${input.executionJobId}`);
    }

    const job = repos.executionJobs.updateStatus({
      id: input.executionJobId,
      status: 'running',
      runtimeSessionId: input.runtimeSessionId,
      branchName: input.branchName,
      baseCommitHash: input.baseCommitHash,
      startedAt,
      finishedAt: null,
      failureReason: null,
       claimToken: null,
       claimedBy: existing.claimedBy,
       claimedAt: existing.claimedAt,
       claimExpiresAt: null,
       nextAttemptAt: null,
       lastHeartbeatAt: startedAt,
       lastErrorCode: null,
       lastErrorSummary: null,
    });

    if (!job) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }

    appendTaskExecutionEvent(job.taskId, 'execution_job_started', {
      executionJobId: job.id,
      runtimeSessionId: input.runtimeSessionId,
      branchName: input.branchName,
      baseCommitHash: input.baseCommitHash,
      status: 'running',
    });
    refreshRuntimeSessionSummary(input.runtimeSessionId);

    return job;
  }

  markJobReviewRequested(input: {
    executionJobId: string;
    summary?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'running') {
      return existing;
    }

    const reviewedAt = new Date().toISOString();
    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'review',
      lastHeartbeatAt: reviewedAt,
      failureReason: null,
      lastErrorCode: null,
      lastErrorSummary: normalizeText(input.summary),
    });
    if (!job) {
      throw new Error(`Execution job review transition failed: ${input.executionJobId}`);
    }

    appendTaskExecutionEvent(job.taskId, 'execution_job_review_requested', {
      executionJobId: job.id,
      status: 'review',
      summary: normalizeText(input.summary),
    });
    if (job.runtimeSessionId) {
      refreshRuntimeSessionSummary(job.runtimeSessionId);
    }

    return job;
  }

  markJobReviewRequestedByRuntimeSessionId(input: {
    runtimeSessionId: string;
    summary?: string | null;
  }) {
    const job = getRalphitoRepositories().executionJobs.getByRuntimeSessionId(input.runtimeSessionId);
    if (!job) return null;

    return this.markJobReviewRequested({
      executionJobId: job.id,
      summary: input.summary || null,
    });
  }

  markJobReviewApproved(input: {
    executionJobId: string;
    summary?: string | null;
    provider?: string | null;
    model?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'review') {
      return existing;
    }

    const reviewedAt = new Date().toISOString();
    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'done',
      failureReason: null,
      finishedAt: existing.finishedAt || reviewedAt,
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: null,
      lastHeartbeatAt: reviewedAt,
      lastErrorCode: null,
      lastErrorSummary: null,
    });
    if (!job) {
      throw new Error(`Execution job approval transition failed: ${input.executionJobId}`);
    }

    BeadLifecycleService.completeTask({ taskId: job.taskId });
    appendTaskExecutionEvent(job.taskId, 'execution_review_approved', {
      executionJobId: job.id,
      summary: normalizeText(input.summary),
      provider: normalizeText(input.provider),
      model: normalizeText(input.model),
    });
    if (job.runtimeSessionId) {
      refreshRuntimeSessionSummary(job.runtimeSessionId);
    }

    return job;
  }

  markJobReviewRejected(input: {
    executionJobId: string;
    summary: string;
    reworkTaskId?: string | null;
    provider?: string | null;
    model?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'review') {
      return existing;
    }

    const reviewedAt = new Date().toISOString();
    const normalizedSummary = normalizeText(input.summary) || 'review_rejected';
    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'failed',
      failureReason: normalizedSummary,
      finishedAt: existing.finishedAt || reviewedAt,
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: null,
      lastHeartbeatAt: reviewedAt,
      lastErrorCode: 'review_rejected',
      lastErrorSummary: normalizedSummary,
    });
    if (!job) {
      throw new Error(`Execution job rejection transition failed: ${input.executionJobId}`);
    }

    BeadLifecycleService.blockTask({ taskId: job.taskId, failureReason: normalizedSummary });
    appendTaskExecutionEvent(job.taskId, 'execution_review_rejected', {
      executionJobId: job.id,
      summary: normalizedSummary,
      reworkTaskId: input.reworkTaskId || null,
      provider: normalizeText(input.provider),
      model: normalizeText(input.model),
    });
    if (job.runtimeSessionId) {
      refreshRuntimeSessionSummary(job.runtimeSessionId);
    }

    return job;
  }

  markJobReviewFailed(input: {
    executionJobId: string;
    summary: string;
    errorCode?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'review') {
      return existing;
    }

    const reviewedAt = new Date().toISOString();
    const normalizedSummary = normalizeText(input.summary) || 'review_failed';
    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'failed',
      failureReason: normalizedSummary,
      finishedAt: existing.finishedAt || reviewedAt,
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: null,
      lastHeartbeatAt: reviewedAt,
      lastErrorCode: normalizeText(input.errorCode) || 'review_failed',
      lastErrorSummary: normalizedSummary,
    });
    if (!job) {
      throw new Error(`Execution job review failure transition failed: ${input.executionJobId}`);
    }

    BeadLifecycleService.blockTask({ taskId: job.taskId, failureReason: normalizedSummary });
    appendTaskExecutionEvent(job.taskId, 'execution_review_failed', {
      executionJobId: job.id,
      summary: normalizedSummary,
      errorCode: normalizeText(input.errorCode) || 'review_failed',
    });
    if (job.runtimeSessionId) {
      refreshRuntimeSessionSummary(job.runtimeSessionId);
    }

    return job;
  }

  markJobFailed(input: {
    executionJobId: string;
    runtimeSessionId?: string | null;
    summary: string;
    reason?: string | null;
    errorCode?: string | null;
    payload?: unknown;
    guardrail?: ExecutionGuardrailRecord | null;
  }) {
    return this.recordTerminalResult({
      executionJobId: input.executionJobId,
      status: 'failed',
      runtimeSessionId: input.runtimeSessionId || null,
      summary: input.summary,
      reason: input.reason || null,
      errorCode: input.errorCode || null,
      payload: input.payload,
      guardrail: input.guardrail || null,
    });
  }

  requeueClaimedJob(input: RequeueClaimedExecutionJobInput) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (existing.status !== 'claimed' || existing.claimToken !== input.claimToken) {
      throw new Error(`Execution job claim mismatch: ${input.executionJobId}`);
    }

    const failedAt = input.failedAt || new Date().toISOString();
    const attemptCount = existing.attemptCount + 1;
    const summary = normalizeText(input.summary) || 'Execution job failed before runtime start.';
    const reason = normalizeText(input.reason);
    const errorCode = normalizeText(input.errorCode);

    if (attemptCount >= existing.maxAttempts) {
      return this.recordTerminalResult({
        executionJobId: existing.id,
        runtimeSessionId: existing.runtimeSessionId,
        status: 'dead',
        summary,
        reason: reason || errorCode || 'retry_exhausted',
        payload: input.payload,
      });
    }

    const job = repos.executionJobs.updateStatus({
      id: existing.id,
      status: 'pending',
      failureReason: summary,
      claimToken: null,
      claimedBy: existing.claimedBy,
      claimedAt: existing.claimedAt,
      claimExpiresAt: null,
      attemptCount,
      nextAttemptAt: addMs(failedAt, input.retryDelayMs ?? DEFAULT_EXECUTION_JOB_RETRY_BASE_MS),
      lastHeartbeatAt: failedAt,
      lastErrorCode: errorCode,
      lastErrorSummary: summary,
    });
    if (!job) {
      throw new Error(`Execution job retry scheduling failed: ${input.executionJobId}`);
    }

    appendTaskExecutionEvent(job.taskId, 'execution_job_requeued', {
      executionJobId: job.id,
      status: 'pending',
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: job.nextAttemptAt,
      reason,
      errorCode,
      summary,
    });

    return { job, result: null } satisfies RecordedExecutionRetryState;
  }

  recordTerminalResult(input: RecordExecutionTerminalResultInput) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }

    const finishedAt = new Date().toISOString();
    const nextJobStatus = existing.status === 'review' && input.status === 'done'
      ? 'review'
      : input.status;
    const job = repos.executionJobs.updateStatus({
      id: input.executionJobId,
      status: nextJobStatus,
      runtimeSessionId: input.runtimeSessionId ?? existing.runtimeSessionId,
      branchName: input.branchName ?? existing.branchName,
      baseCommitHash: input.baseCommitHash ?? existing.baseCommitHash,
      failureReason: input.status === 'done' ? null : normalizeText(input.summary) || normalizeText(input.reason),
      startedAt: existing.startedAt,
      finishedAt,
      claimToken: null,
      claimedBy: existing.claimedBy,
      claimedAt: existing.claimedAt,
      claimExpiresAt: null,
      nextAttemptAt: null,
      lastHeartbeatAt: finishedAt,
      lastErrorCode: input.status === 'done'
        ? null
        : normalizeText(input.errorCode)
          || normalizeText(input.guardrail?.kind)
          || normalizeText(input.reason),
      lastErrorSummary: input.status === 'done' ? null : normalizeText(input.summary) || normalizeText(input.reason),
    });

    if (!job) {
      throw new Error(`Execution job missing after update: ${input.executionJobId}`);
    }

    const payloadJson = attachGuardrailPayload(input.payload, input.guardrail);
    const result = repos.executionResults.upsert({
      id: repos.executionResults.getByExecutionJobId(job.id)?.id || randomUUID(),
      executionJobId: job.id,
      taskId: job.taskId,
      runtimeSessionId: input.runtimeSessionId ?? job.runtimeSessionId,
      status: input.status,
      summary: normalizeText(input.summary),
      reason: normalizeText(input.reason),
      branchName: input.branchName ?? job.branchName,
      baseCommitHash: input.baseCommitHash ?? job.baseCommitHash,
      payloadJson: payloadJson === null ? null : JSON.stringify(payloadJson),
      createdAt: finishedAt,
      updatedAt: finishedAt,
    });
    if (!result) {
      throw new Error(`No pude persistir execution result para job ${job.id}`);
    }

    appendTaskExecutionEvent(job.taskId, 'execution_job_finished', {
      executionJobId: job.id,
      runtimeSessionId: input.runtimeSessionId ?? job.runtimeSessionId,
      resultStatus: input.status,
      summary: normalizeText(input.summary),
      reason: normalizeText(input.reason),
      guardrailKind: input.guardrail?.kind || null,
    });
    if (input.runtimeSessionId ?? job.runtimeSessionId) {
      refreshRuntimeSessionSummary((input.runtimeSessionId ?? job.runtimeSessionId)!);
    }

    return { job, result };
  }

  recordTerminalResultByRuntimeSessionId(input: {
    runtimeSessionId: string;
    status: ExecutionResultStatus;
    summary?: string | null;
    reason?: string | null;
    payload?: unknown;
    guardrail?: ExecutionGuardrailRecord | null;
  }) {
    const job = getRalphitoRepositories().executionJobs.getByRuntimeSessionId(input.runtimeSessionId);
    if (!job) return null;

    return this.recordTerminalResult({
      executionJobId: job.id,
      runtimeSessionId: input.runtimeSessionId,
      status: input.status,
      summary: input.summary || null,
      reason: input.reason || null,
      payload: input.payload,
      guardrail: input.guardrail || null,
    });
  }
}

export interface RecordedExecutionTerminalState {
  job: ExecutionJobRecord;
  result: ExecutionResultRecord;
}

export interface RecordedExecutionRetryState {
  job: ExecutionJobRecord;
  result: ExecutionResultRecord | null;
}
