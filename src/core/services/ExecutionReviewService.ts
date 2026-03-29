import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { ILLMProvider, Message, Provider } from '../domain/gateway.types.js';
import {
  DEFAULT_EXECUTION_REVIEW_CLAIM_LEASE_MS,
  DEFAULT_EXECUTION_REVIEW_MAX_ATTEMPTS,
  DEFAULT_EXECUTION_REVIEW_RETRY_BASE_MS,
} from '../domain/constants.js';
import { ProjectService } from './ProjectService.js';
import { AgentRegistryService } from './AgentRegistry.js';
import { BeadLifecycleService } from './BeadLifecycleService.js';
import { ExecutionPipelineService } from './ExecutionPipelineService.js';
import { refreshTaskSummary } from './summaryService.js';
import {
  getRalphitoRepositories,
  type ExecutionJobRecord,
  type ExecutionReviewRecord,
  type ExecutionResultRecord,
} from '../../infrastructure/persistence/db/index.js';
import { readRuntimeSessionFile, resolveRuntimeBeadPath } from '../engine/runtimeFiles.js';
import { GitService } from '../../gateway/tools/git/gitService.js';
import { ProviderFactory } from '../../gateway/providers/provider.factory.js';
import { buildProviderAuth } from '../../gateway/providers/providerAuth.js';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';
import {
  createGuardrailRecord,
  recordGuardrailEvent,
  type ExecutionGuardrailRecord,
} from './guardrails.js';

const REVIEWER_AGENT_ID = 'juez';
const DEFAULT_DEFER_MS = 5_000;
const MAX_DIFF_CHARS = 120_000;
const MAX_BEAD_CHARS = 40_000;
const REVIEW_ROLE_PATH = path.join(process.cwd(), 'src', 'core', 'prompt', 'roles', 'CodeReviewer(Juez).md');

export interface ExecutionReviewFinding {
  severity: 'high' | 'medium' | 'low';
  file: string | null;
  line: number | null;
  message: string;
}

export interface ExecutionReviewInputSnapshot {
  reviewRequestedAt: string;
  verificationSummary: string | null;
  beadPath: string | null;
  beadContent: string | null;
  branchName: string | null;
  baseCommitHash: string | null;
  diffCached: string | null;
  diffWorkingTree: string | null;
  diffFromBase: string | null;
  gitStatus: {
    branch: string;
    upstream: string | null;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
    aheadCount: number;
    behindCount: number;
    isClean: boolean;
  } | null;
}

export interface ExecutionReviewDecision {
  verdict: 'approved' | 'rejected';
  summary: string;
  findings: ExecutionReviewFinding[];
  reworkTitle: string | null;
}

export interface ClaimedExecutionReview {
  claimToken: string;
  review: ExecutionReviewRecord;
}

export interface ExecutionReviewRecoveryResult {
  requeued: string[];
  failed: string[];
}

type ReviewProviderResolver = (input: {
  provider: Provider;
  model: string;
  providerProfile?: string;
}) => Promise<ILLMProvider>;

function addMs(iso: string, deltaMs: number) {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString();
}

function trimText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function clampText(value: string | null | undefined, maxLength: number) {
  const normalized = trimText(value);
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeSeverity(value: unknown): ExecutionReviewFinding['severity'] {
  return value === 'high' || value === 'low' ? value : 'medium';
}

function loadReviewerRolePrompt() {
  try {
    return readFileSync(REVIEW_ROLE_PATH, 'utf8').trim();
  } catch {
    return 'Eres Juez. Revisa el diff, la bead y el resultado. Devuelve JSON valido.';
  }
}

async function defaultProviderResolver(input: {
  provider: Provider;
  model: string;
  providerProfile?: string;
}) {
  const auth = await buildProviderAuth(input.provider);
  return ProviderFactory.create(input.provider, input.model, auth, input.providerProfile);
}

function appendReviewEvent(taskId: string, eventType: string, payload: Record<string, unknown>) {
  getRalphitoRepositories().taskEvents.append({
    taskId,
    eventType,
    payloadJson: JSON.stringify(payload),
  });
  refreshTaskSummary(taskId);
}

function sameSignature(job: ExecutionJobRecord, reviewer: { provider: Provider; model: string }) {
  return job.provider === reviewer.provider && job.model === reviewer.model;
}

export class ExecutionReviewService {
  constructor(
    private readonly executionPipeline = new ExecutionPipelineService(),
    private readonly commandRunner = new CommandRunner(),
    private readonly resolveProvider: ReviewProviderResolver = defaultProviderResolver,
  ) {}

  async requestReviewForRuntimeSession(input: {
    runtimeSessionId: string;
    worktreePath: string;
    verificationSummary?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const job = repos.executionJobs.getByRuntimeSessionId(input.runtimeSessionId);
    if (!job) return null;

    const reviewJob = this.executionPipeline.markJobReviewRequested({
      executionJobId: job.id,
      summary: input.verificationSummary || null,
    });
    const snapshot = await this.captureReviewSnapshot({
      worktreePath: input.worktreePath,
      verificationSummary: input.verificationSummary || null,
    });
    const existing = repos.executionReviews.getByExecutionJobId(job.id);
    const review = repos.executionReviews.upsert({
      id: existing?.id || randomUUID(),
      executionJobId: job.id,
      taskId: job.taskId,
      runtimeSessionId: input.runtimeSessionId,
      reviewerAgentId: REVIEWER_AGENT_ID,
      status: existing?.status || 'pending',
      inputJson: JSON.stringify(snapshot),
      attemptCount: existing?.attemptCount ?? 0,
      maxAttempts: existing?.maxAttempts ?? DEFAULT_EXECUTION_REVIEW_MAX_ATTEMPTS,
      nextAttemptAt: new Date().toISOString(),
    });

    appendReviewEvent(job.taskId, 'execution_review_requested', {
      executionJobId: job.id,
      reviewId: review?.id || null,
      verificationSummary: trimText(input.verificationSummary),
      jobStatus: reviewJob.status,
    });

    return review;
  }

  claimNextRunnableReview(input: {
    workerId: string;
    leaseMs?: number;
    claimedAt?: string;
  }) {
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claimToken = randomUUID();
    const review = getRalphitoRepositories().executionReviews.claimNext({
      workerId: input.workerId,
      claimToken,
      claimedAt,
      claimExpiresAt: addMs(claimedAt, input.leaseMs ?? DEFAULT_EXECUTION_REVIEW_CLAIM_LEASE_MS),
    });
    if (!review) return null;

    appendReviewEvent(review.taskId, 'execution_review_claimed', {
      executionJobId: review.executionJobId,
      reviewId: review.id,
      claimedBy: input.workerId,
      claimedAt,
    });

    return { claimToken, review } satisfies ClaimedExecutionReview;
  }

  releaseClaim(input: {
    reviewId: string;
    claimToken: string;
    nextAttemptAt?: string | null;
    reason?: string | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionReviews.getById(input.reviewId);
    if (!existing) {
      throw new Error(`Execution review missing: ${input.reviewId}`);
    }
    if (existing.status !== 'claimed' || existing.claimToken !== input.claimToken) {
      throw new Error(`Execution review claim mismatch: ${input.reviewId}`);
    }

    const review = repos.executionReviews.updateStatus({
      id: existing.id,
      status: 'pending',
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: input.nextAttemptAt ?? new Date().toISOString(),
      lastError: trimText(input.reason),
    });
    if (!review) {
      throw new Error(`Execution review release failed: ${input.reviewId}`);
    }

    appendReviewEvent(review.taskId, 'execution_review_deferred', {
      executionJobId: review.executionJobId,
      reviewId: review.id,
      reason: trimText(input.reason),
      nextAttemptAt: review.nextAttemptAt,
    });

    return review;
  }

  recoverExpiredClaims(input: {
    now?: string;
    retryDelayMs?: number;
    limit?: number;
  } = {}): ExecutionReviewRecoveryResult {
    const now = input.now || new Date().toISOString();
    const expiredReviews = getRalphitoRepositories().executionReviews.listExpiredClaims(now, input.limit ?? 20);
    const result: ExecutionReviewRecoveryResult = { requeued: [], failed: [] };

    for (const review of expiredReviews) {
      if (!review.claimToken) continue;

      const guardrail = createGuardrailRecord({
        kind: 'stale_review',
        scope: 'execution_review',
        summary: `Execution review ${review.id} expiro sin veredicto.`,
        reasonCode: 'claim_expired',
        detectedAt: now,
        taskId: review.taskId,
        executionJobId: review.executionJobId,
        runtimeSessionId: review.runtimeSessionId,
        reviewId: review.id,
        metadata: {
          claimExpiresAt: review.claimExpiresAt,
          attemptCount: review.attemptCount,
          maxAttempts: review.maxAttempts,
        },
      });
      const recovered = this.requeueClaimedReview({
        reviewId: review.id,
        claimToken: review.claimToken,
        summary: guardrail.summary,
        retryDelayMs: input.retryDelayMs ?? DEFAULT_EXECUTION_REVIEW_RETRY_BASE_MS,
        errorCode: 'stale_review',
        guardrail,
      });

      if (recovered.status === 'failed') {
        result.failed.push(review.id);
      } else {
        result.requeued.push(review.id);
      }
    }

    return result;
  }

  requeueClaimedReview(input: {
    reviewId: string;
    claimToken: string;
    summary: string;
    retryDelayMs?: number;
    errorCode?: string | null;
    guardrail?: ExecutionGuardrailRecord | null;
  }) {
    const repos = getRalphitoRepositories();
    const existing = repos.executionReviews.getById(input.reviewId);
    if (!existing) {
      throw new Error(`Execution review missing: ${input.reviewId}`);
    }
    if (existing.status !== 'claimed' || existing.claimToken !== input.claimToken) {
      throw new Error(`Execution review claim mismatch: ${input.reviewId}`);
    }

    const failedAt = new Date().toISOString();
    const attemptCount = existing.attemptCount + 1;
    const maxAttempts = existing.maxAttempts || DEFAULT_EXECUTION_REVIEW_MAX_ATTEMPTS;
    const normalizedSummary = trimText(input.summary) || 'review_failed';
    const errorCode = trimText(input.errorCode) || 'review_failed';

    if (attemptCount >= maxAttempts) {
      const review = repos.executionReviews.updateStatus({
        id: existing.id,
        status: 'failed',
        summary: normalizedSummary,
        claimToken: null,
        claimExpiresAt: null,
        attemptCount,
        maxAttempts,
        lastError: normalizedSummary,
        finishedAt: failedAt,
      });
      if (!review) {
        throw new Error(`Execution review terminal failure transition failed: ${input.reviewId}`);
      }

      this.executionPipeline.markJobReviewFailed({
        executionJobId: review.executionJobId,
        summary: normalizedSummary,
        errorCode,
      });
      if (input.guardrail) {
        recordGuardrailEvent(input.guardrail, 'error');
      }
      appendReviewEvent(review.taskId, 'execution_review_failed', {
        executionJobId: review.executionJobId,
        reviewId: review.id,
        attemptCount,
        maxAttempts,
        summary: normalizedSummary,
        errorCode,
        guardrailKind: input.guardrail?.kind || null,
      });
      return { status: 'failed' as const, review };
    }

    const review = repos.executionReviews.updateStatus({
      id: existing.id,
      status: 'pending',
      claimToken: null,
      claimExpiresAt: null,
      attemptCount,
      maxAttempts,
      nextAttemptAt: addMs(failedAt, input.retryDelayMs ?? DEFAULT_EXECUTION_REVIEW_RETRY_BASE_MS),
      lastError: errorCode,
    });
    if (!review) {
      throw new Error(`Execution review retry scheduling failed: ${input.reviewId}`);
    }

    if (input.guardrail) {
      recordGuardrailEvent(input.guardrail);
    }
    appendReviewEvent(review.taskId, 'execution_review_requeued', {
      executionJobId: review.executionJobId,
      reviewId: review.id,
      attemptCount,
      maxAttempts,
      nextAttemptAt: review.nextAttemptAt,
      summary: normalizedSummary,
      errorCode,
      guardrailKind: input.guardrail?.kind || null,
    });
    return { status: 'requeued' as const, review };
  }

  async processClaimedReview(claimed: ClaimedExecutionReview) {
    const now = new Date().toISOString();
    const repos = getRalphitoRepositories();
    const currentReview = repos.executionReviews.getById(claimed.review.id);
    if (!currentReview || currentReview.status !== 'claimed' || currentReview.claimToken !== claimed.claimToken) {
      return 'failed' as const;
    }

    const job = repos.executionJobs.getById(currentReview.executionJobId);
    if (!job) {
      repos.executionReviews.updateStatus({
        id: currentReview.id,
        status: 'failed',
        summary: 'Execution job missing for review.',
        lastError: 'Execution job missing for review.',
        claimToken: null,
        claimExpiresAt: null,
        finishedAt: now,
      });
      return 'failed' as const;
    }

    const result = repos.executionResults.getByExecutionJobId(job.id);
    if (!result) {
      this.releaseClaim({
        reviewId: currentReview.id,
        claimToken: claimed.claimToken,
        nextAttemptAt: addMs(now, DEFAULT_DEFER_MS),
        reason: 'waiting_execution_result',
      });
      return 'deferred' as const;
    }

    if (result.status !== 'done') {
      repos.executionReviews.updateStatus({
        id: currentReview.id,
        status: 'failed',
        summary: `Execution result ${result.status}; review abortada.`,
        lastError: `execution_result_${result.status}`,
        claimToken: null,
        claimExpiresAt: null,
        finishedAt: now,
      });
      return 'failed' as const;
    }

    const reviewer = this.resolveReviewer(job);
    const provider = await this.resolveProvider(reviewer);
    const decision = this.parseDecision(
      await provider.generateResponse(await this.buildReviewMessages(job, currentReview, result, reviewer.sameSignature)),
    );

    if (decision.verdict === 'approved') {
      const review = repos.executionReviews.updateStatus({
        id: currentReview.id,
        status: 'approved',
        provider: reviewer.provider,
        model: reviewer.model,
        summary: decision.summary,
        findingsJson: JSON.stringify(decision.findings),
        claimToken: null,
        claimExpiresAt: null,
        startedAt: currentReview.startedAt || now,
        finishedAt: now,
        lastError: reviewer.sameSignature ? 'same_signature_review' : null,
      });
      if (!review) {
        throw new Error(`Execution review approval persistence failed: ${currentReview.id}`);
      }

      this.executionPipeline.markJobReviewApproved({
        executionJobId: currentReview.executionJobId,
        summary: decision.summary,
        provider: reviewer.provider,
        model: reviewer.model,
      });
      return 'approved' as const;
    }

    const reworkTask = this.createReworkTask(job, decision);
    const review = repos.executionReviews.updateStatus({
      id: currentReview.id,
      status: 'rejected',
      provider: reviewer.provider,
      model: reviewer.model,
      summary: decision.summary,
      findingsJson: JSON.stringify(decision.findings),
      reworkTaskId: reworkTask.id,
      claimToken: null,
      claimExpiresAt: null,
      startedAt: currentReview.startedAt || now,
      finishedAt: now,
      lastError: reviewer.sameSignature ? 'same_signature_review' : null,
    });
    if (!review) {
      throw new Error(`Execution review rejection persistence failed: ${currentReview.id}`);
    }

    this.executionPipeline.markJobReviewRejected({
      executionJobId: currentReview.executionJobId,
      summary: decision.summary,
      reworkTaskId: reworkTask.id,
      provider: reviewer.provider,
      model: reviewer.model,
    });
    return 'rejected' as const;
  }

  private async captureReviewSnapshot(input: {
    worktreePath: string;
    verificationSummary: string | null;
  }) {
    const sessionFile = readRuntimeSessionFile(input.worktreePath);
    const git = new GitService(input.worktreePath);
    const status = await git.status().catch(() => null);
    const beadPath = sessionFile
      ? resolveRuntimeBeadPath(
          {
            beadPath: sessionFile.beadPath,
            beadSnapshotPath: sessionFile.beadSnapshotPath || null,
          },
          { worktreePath: input.worktreePath },
        )
      : null;
    const beadContent = beadPath && existsSync(beadPath)
      ? clampText(readFileSync(beadPath, 'utf8'), MAX_BEAD_CHARS)
      : null;

    return {
      reviewRequestedAt: new Date().toISOString(),
      verificationSummary: trimText(input.verificationSummary),
      beadPath,
      beadContent,
      branchName: sessionFile?.branchName || null,
      baseCommitHash: sessionFile?.baseCommitHash || null,
      diffCached: clampText(await git.diff({ cached: true }).catch(() => null), MAX_DIFF_CHARS),
      diffWorkingTree: clampText(await git.diff().catch(() => null), MAX_DIFF_CHARS),
      diffFromBase: clampText(
        sessionFile?.baseCommitHash
          ? await git.diff({ range: `${sessionFile.baseCommitHash}..HEAD` }).catch(() => null)
          : null,
        MAX_DIFF_CHARS,
      ),
      gitStatus: status,
    } satisfies ExecutionReviewInputSnapshot;
  }

  private resolveReviewer(job: ExecutionJobRecord) {
    const config = AgentRegistryService.getAgentConfig(REVIEWER_AGENT_ID);
    if (!config) {
      throw new Error('Agent config missing: juez');
    }

    const primary = {
      provider: config.primaryProvider,
      model: config.model,
      ...(config.providerProfile ? { providerProfile: config.providerProfile } : {}),
    };
    if (!sameSignature(job, primary)) {
      return { ...primary, sameSignature: false };
    }

    const alternative = config.fallbacks.find((fallback) => !sameSignature(job, fallback));
    if (alternative) {
      return {
        provider: alternative.provider,
        model: alternative.model,
        ...(alternative.providerProfile ? { providerProfile: alternative.providerProfile } : {}),
        sameSignature: false,
      };
    }

    return { ...primary, sameSignature: true };
  }

  private async buildReviewMessages(
    job: ExecutionJobRecord,
    review: ExecutionReviewRecord,
    result: ExecutionResultRecord,
    sameSignatureReview: boolean,
  ): Promise<Message[]> {
    const task = BeadLifecycleService.getTaskById(job.taskId);
    const snapshot = safeJsonParse<ExecutionReviewInputSnapshot>(review.inputJson, {
      reviewRequestedAt: review.createdAt,
      verificationSummary: null,
      beadPath: null,
      beadContent: null,
      branchName: null,
      baseCommitHash: null,
      diffCached: null,
      diffWorkingTree: null,
      diffFromBase: null,
      gitStatus: null,
    });
    const executionPayload = safeJsonParse<Record<string, unknown>>(result.payloadJson, {});

    const reviewPayload = {
      taskId: job.taskId,
      taskTitle: task?.title || null,
      branchName: result.branchName || job.branchName,
      baseCommitHash: result.baseCommitHash || job.baseCommitHash,
      verificationSummary: snapshot.verificationSummary,
      beadPath: snapshot.beadPath || task?.beadPath || null,
      beadContent: snapshot.beadContent,
      finalDiff: await this.readFinalBranchDiff(job, result, snapshot.diffFromBase),
      stagedDiffAtRequest: snapshot.diffCached,
      workingTreeDiffAtRequest: snapshot.diffWorkingTree,
      gitStatusAtRequest: snapshot.gitStatus,
      executionResult: {
        status: result.status,
        summary: result.summary,
        reason: result.reason,
        payload: executionPayload,
      },
      policy: {
        sameSignatureReview,
      },
    };

    return [
      {
        role: 'system',
        content: [
          loadReviewerRolePrompt(),
          'Responde SOLO JSON valido con: verdict, summary, findings, reworkTitle.',
          'verdict solo puede ser approved o rejected.',
          'findings es un array de objetos { severity, file, line, message }.',
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: JSON.stringify(reviewPayload, null, 2),
      },
    ];
  }

  private async readFinalBranchDiff(
    job: ExecutionJobRecord,
    result: { branchName: string | null; baseCommitHash: string | null },
    fallback: string | null,
  ) {
    const branchName = trimText(result.branchName) || trimText(job.branchName);
    const baseCommitHash = trimText(result.baseCommitHash) || trimText(job.baseCommitHash);
    if (!branchName || !baseCommitHash) return fallback;

    const project = ProjectService.resolve(job.projectId || 'system');
    try {
      const diff = await this.commandRunner.run('git', ['diff', `${baseCommitHash}..${branchName}`], {
        cwd: project.path,
        timeoutMs: 600_000,
        maxBuffer: 1024 * 1024 * 16,
      });
      return clampText(diff.stdout, MAX_DIFF_CHARS);
    } catch {
      return fallback;
    }
  }

  private parseDecision(raw: string): ExecutionReviewDecision {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const candidate = fenced?.[1]?.trim() || trimmed;
    const parsed = JSON.parse(candidate) as {
      verdict?: unknown;
      summary?: unknown;
      findings?: unknown;
      reworkTitle?: unknown;
    };

    if (parsed.verdict !== 'approved' && parsed.verdict !== 'rejected') {
      throw new Error('Invalid review verdict.');
    }

    const summary = trimText(typeof parsed.summary === 'string' ? parsed.summary : null);
    if (!summary) {
      throw new Error('Review summary missing.');
    }

    const findings = Array.isArray(parsed.findings)
      ? parsed.findings
          .map((finding) => {
            if (!finding || typeof finding !== 'object') return null;
            const candidateFinding = finding as Record<string, unknown>;
            const message = trimText(typeof candidateFinding.message === 'string' ? candidateFinding.message : null);
            if (!message) return null;

            return {
              severity: normalizeSeverity(candidateFinding.severity),
              file: trimText(typeof candidateFinding.file === 'string' ? candidateFinding.file : null),
              line: typeof candidateFinding.line === 'number' && Number.isFinite(candidateFinding.line)
                ? Math.trunc(candidateFinding.line)
                : null,
              message,
            } satisfies ExecutionReviewFinding;
          })
          .filter(Boolean) as ExecutionReviewFinding[]
      : [];

    return {
      verdict: parsed.verdict,
      summary,
      findings,
      reworkTitle: trimText(typeof parsed.reworkTitle === 'string' ? parsed.reworkTitle : null),
    };
  }

  private createReworkTask(job: ExecutionJobRecord, decision: ExecutionReviewDecision) {
    const task = BeadLifecycleService.getTaskById(job.taskId);
    if (!task) {
      throw new Error(`Task missing for execution review rejection: ${job.taskId}`);
    }

    const taskId = `${task.id}-rework-${randomUUID().slice(0, 8)}`;
    const title = decision.reworkTitle || `Rework: ${task.title}`;
    const reworkTask = BeadLifecycleService.createTask({
      taskId,
      title,
      projectId: task.projectId || job.projectId || 'system',
      projectKey: task.projectKey || task.projectId || job.projectId || 'system',
      parentTaskId: task.id,
      beadPath: task.beadPath,
      sourceSpecPath: task.sourceSpecPath,
      componentPath: task.componentPath,
      assignedAgent: job.agentId,
      priority: task.priority,
      status: 'pending',
    });

    appendReviewEvent(task.id, 'execution_review_rework_created', {
      executionJobId: job.id,
      reworkTaskId: reworkTask?.id || taskId,
      parentTaskId: task.id,
    });
    return reworkTask || BeadLifecycleService.getTaskById(taskId)!;
  }
}
