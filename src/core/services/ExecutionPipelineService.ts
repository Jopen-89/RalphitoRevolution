import { randomUUID } from 'crypto';
import type { ExecutionHarness, Provider } from '../domain/gateway.types.js';
import { refreshRuntimeSessionSummary, refreshTaskSummary } from './summaryService.js';
import { BeadLifecycleService, type LifecycleTaskRecord } from './BeadLifecycleService.js';
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
  executionHarness: ExecutionHarness;
  executionProfile?: string | null;
  provider?: Provider | null;
  model?: string | null;
  providerProfile?: string | null;
  prompt?: string | null;
  requestedByAgentId?: string | null;
  originThreadId?: number | null;
  notificationChatId?: string | null;
}

export interface MarkExecutionJobRunningInput {
  executionJobId: string;
  runtimeSessionId: string;
  branchName: string;
  baseCommitHash: string;
  startedAt?: string;
}

export interface RecordExecutionTerminalResultInput {
  executionJobId: string;
  status: ExecutionResultStatus;
  runtimeSessionId?: string | null;
  summary?: string | null;
  reason?: string | null;
  branchName?: string | null;
  baseCommitHash?: string | null;
  payload?: unknown;
}

function normalizeText(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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
      executionHarness: input.executionHarness,
      executionProfile: input.executionProfile || null,
      provider: input.provider || null,
      model: input.model || null,
      providerProfile: input.providerProfile || null,
      status: 'pending',
      prompt,
      beadPath: task.beadPath || task.sourceSpecPath,
      requestedByAgentId: input.requestedByAgentId || null,
      originThreadId: input.originThreadId ?? null,
      notificationChatId: input.notificationChatId || null,
    });
    if (!job) {
      throw new Error(`No pude persistir execution job para task ${task.id}`);
    }

    appendTaskExecutionEvent(task.id, 'execution_job_created', {
      executionJobId: job.id,
      status: 'pending',
      agentId: input.executorAgentId,
      executionHarness: input.executionHarness,
      executionProfile: input.executionProfile || null,
      provider: input.provider || null,
      model: input.model || null,
    });

    return job;
  }

  markJobRunning(input: MarkExecutionJobRunningInput) {
    const repos = getRalphitoRepositories();
    const startedAt = input.startedAt || new Date().toISOString();
    const job = repos.executionJobs.updateStatus({
      id: input.executionJobId,
      status: 'running',
      runtimeSessionId: input.runtimeSessionId,
      branchName: input.branchName,
      baseCommitHash: input.baseCommitHash,
      startedAt,
      finishedAt: null,
      failureReason: null,
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

  markJobFailed(input: {
    executionJobId: string;
    runtimeSessionId?: string | null;
    summary: string;
    reason?: string | null;
    payload?: unknown;
  }) {
    return this.recordTerminalResult({
      executionJobId: input.executionJobId,
      status: 'failed',
      runtimeSessionId: input.runtimeSessionId || null,
      summary: input.summary,
      reason: input.reason || null,
      payload: input.payload,
    });
  }

  recordTerminalResult(input: RecordExecutionTerminalResultInput) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionJobs.getById(input.executionJobId);
    if (!existing) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }

    const finishedAt = new Date().toISOString();
    const job = repos.executionJobs.updateStatus({
      id: input.executionJobId,
      status: input.status,
      runtimeSessionId: input.runtimeSessionId ?? existing.runtimeSessionId,
      branchName: input.branchName ?? existing.branchName,
      baseCommitHash: input.baseCommitHash ?? existing.baseCommitHash,
      failureReason: input.status === 'done' ? null : normalizeText(input.summary) || normalizeText(input.reason),
      startedAt: existing.startedAt,
      finishedAt,
    });

    if (!job) {
      throw new Error(`Execution job missing after update: ${input.executionJobId}`);
    }

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
      payloadJson: input.payload === undefined ? null : JSON.stringify(input.payload),
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
    });
  }
}

export interface RecordedExecutionTerminalState {
  job: ExecutionJobRecord;
  result: ExecutionResultRecord;
}
