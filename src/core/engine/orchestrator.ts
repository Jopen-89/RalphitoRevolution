import path from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import type { Provider } from '../domain/gateway.types.js';
import { resolveEngineProjectConfig } from './config.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';
import { getEngineSessionsStatus, type EngineStatusSession } from './status.js';
import type { RuntimeAgentConfigSnapshot } from './runtimeFiles.js';
import { resumeRuntimeSession } from './resume.js';
import { RUNTIME_GUARDRAIL_LOG_NAME } from '../domain/constants.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { getRalphitoRepositories, type ExecutionJobRecord } from '../../infrastructure/persistence/db/index.js';
import { ExecutionPipelineService, resolveExecutionTask } from '../services/ExecutionPipelineService.js';
import { SessionSupervisor, type SpawnRuntimeSessionResult } from '../services/SessionManager.js';

export interface OrchestratorSpawnInput {
  project?: string;
  prompt?: string;
  taskId?: string;
  workItemKey?: string;
  beadPath?: string;
  provider?: Provider;
  model?: string;
  beadSpecHash?: string;
  beadSpecVersion?: string;
  qaConfig?: unknown;
  originThreadId?: number;
  notificationChatId?: string;
}

export interface OrchestratorSpawnResult {
  taskId: string;
  executionJobId: string;
  status: 'pending';
}

export interface LaunchExecutionJobInput {
  executionJobId: string;
  claimToken: string;
  workerId?: string;
}

export interface OrchestratorResumeResult {
  success: boolean;
  runtimeSessionId: string;
  message: string;
}

export interface GuardrailFailure {
  sessionId: string;
  worktreePath: string;
  errorSnippet: string;
}

export interface OrchestratorStatusResult {
  sessions: EngineStatusSession[];
  guardrailFailures: GuardrailFailure[];
  autopilotActive: boolean;
}

export interface OrchestratorDivergenceResult {
  status: 'success' | 'partial' | 'error';
  message: string;
  failedTeams?: string[];
}

export class Orchestrator {
  constructor(
    private readonly sessionSupervisor = new SessionSupervisor(),
    private readonly executionPipeline = new ExecutionPipelineService(),
    private readonly lockRepository = getRuntimeLockRepository(),
    private readonly repoRoot = process.cwd(),
  ) {}

  async spawn(input: OrchestratorSpawnInput): Promise<OrchestratorSpawnResult> {
    const beadPath = input.beadPath || this.extractBeadPathFromPrompt(input.prompt || '');
    const task = resolveExecutionTask({
      taskId: input.taskId || input.workItemKey || null,
      ...(beadPath ? { beadPath } : {}),
      ...(input.project ? { projectId: input.project } : {}),
    });
    const targetProjectId = input.project || task.assignedAgent || task.projectId || 'system';
    const projectConfig = resolveEngineProjectConfig(targetProjectId);
    const prompt = input.prompt?.trim() || `Implementa la task ${task.id}: ${task.title}`;

    const executionJob = this.executionPipeline.createJob({
      task,
      executorAgentId: projectConfig.id,
      agentConfigId: projectConfig.agentConfigId,
      executionHarness: projectConfig.agent,
      executionProfile: projectConfig.executionProfile || null,
      provider: input.provider || projectConfig.provider,
      model: input.model || projectConfig.model,
      providerProfile: projectConfig.providerProfile || null,
      toolMode: projectConfig.toolMode,
      allowedTools: [...projectConfig.allowedTools],
      fallbacks: [...projectConfig.fallbacks],
      prompt,
      requestedByAgentId: 'raymon',
      originThreadId: input.originThreadId ?? null,
      notificationChatId: input.notificationChatId || null,
    });
    return {
      taskId: task.id,
      executionJobId: executionJob.id,
      status: 'pending',
    };
  }

  async launchExecutionJob(input: LaunchExecutionJobInput): Promise<SpawnRuntimeSessionResult> {
    const job = getRalphitoRepositories().executionJobs.getById(input.executionJobId);
    if (!job) {
      throw new Error(`Execution job missing: ${input.executionJobId}`);
    }
    if (job.status !== 'claimed') {
      throw new Error(`Execution job ${input.executionJobId} no está claimed.`);
    }
    if (job.claimToken !== input.claimToken) {
      throw new Error(`Execution job claim mismatch: ${input.executionJobId}`);
    }
    if (job.claimExpiresAt && job.claimExpiresAt <= new Date().toISOString()) {
      throw new Error(`Execution job claim expired: ${input.executionJobId}`);
    }

    const project = resolveEngineProjectConfig(job.projectId || job.agentId);
    const resolvedBeadPath = this.resolveBeadPath(job.beadPath, project.path);
    if (resolvedBeadPath) {
      const targets = resolveWriteScopeTargetsFromBeadFile(resolvedBeadPath, project.path);
      const conflict = this.lockRepository.findActiveConflict(targets);
      if (conflict) {
        throw new Error(`LOCK_CONFLICT: ${conflict.relation} ${conflict.requestedPath}`);
      }
    }

    const runtimeAgentConfigSnapshot = this.buildRuntimeAgentConfigSnapshot(job, project);
    const prompt = job.prompt?.trim() || `Implementa la task ${job.taskId}`;

    return this.sessionSupervisor.spawn({
      project: project.id,
      prompt,
      taskId: job.taskId,
      executionJobId: job.id,
      executionClaimToken: input.claimToken,
      ...(job.beadPath ? { beadPath: job.beadPath } : {}),
      workItemKey: job.taskId,
      ...(runtimeAgentConfigSnapshot.primaryProvider ? { provider: runtimeAgentConfigSnapshot.primaryProvider } : {}),
      ...(runtimeAgentConfigSnapshot.model ? { model: runtimeAgentConfigSnapshot.model } : {}),
      agentConfigId: job.agentConfigId || runtimeAgentConfigSnapshot.agentId || project.agentConfigId,
      agentConfigSnapshot: runtimeAgentConfigSnapshot,
      ...(typeof job.originThreadId === 'number' ? { originThreadId: job.originThreadId } : {}),
      ...(job.notificationChatId ? { notificationChatId: job.notificationChatId } : {}),
    });
  }

  async resume(runtimeSessionId: string): Promise<OrchestratorResumeResult> {
    try {
      await resumeRuntimeSession(runtimeSessionId);
      const worktreePath = this.findWorktreePath(runtimeSessionId);
      if (worktreePath) {
        const guardrailLogPath = path.join(worktreePath, RUNTIME_GUARDRAIL_LOG_NAME);
        if (existsSync(guardrailLogPath)) {
          unlinkSync(guardrailLogPath);
        }
      }
      return {
        success: true,
        runtimeSessionId,
        message: 'Ralphito resucitado. Error inyectado en su contexto.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, runtimeSessionId, message };
    }
  }

  async getStatus(): Promise<OrchestratorStatusResult> {
    const sessions = await getEngineSessionsStatus();
    const guardrailFailures = this.findGuardrailFailures();
    const autopilotActive = sessions.some((s) => s.alive && s.status === 'running');
    return { sessions, guardrailFailures, autopilotActive };
  }

  async launchDivergence(projectId: string, seedIdea: string): Promise<OrchestratorDivergenceResult> {
    return {
      status: 'success',
      message: 'Fase de Divergencia iniciada. 4 agentes lanzados en paralelo. (Skeleton - implementación pendiente)',
    };
  }

  private extractBeadPathFromPrompt(prompt: string): string | undefined {
    const match = prompt.match(/docs\/specs\/[^\s]*bead[^\s]*\.md/);
    return match?.[0];
  }

  private buildRuntimeAgentConfigSnapshot(
    job: ExecutionJobRecord,
    project: ReturnType<typeof resolveEngineProjectConfig>,
  ): RuntimeAgentConfigSnapshot {
    const primaryProvider = this.optionalProvider(job.provider) || project.provider || null;

    return {
      agentId: job.agentConfigId || project.agentConfigId,
      primaryProvider,
      model: job.model || project.model || null,
      providerProfile: job.providerProfile || project.providerProfile || null,
      executionHarness: job.executionHarness === 'codex' ? 'codex' : 'opencode',
      executionProfile: job.executionProfile || project.executionProfile || null,
      toolMode: job.toolMode,
      allowedTools: [...job.allowedTools],
      fallbacks: [...job.fallbacks],
      resolvedAt: job.createdAt,
    };
  }

  private optionalProvider(value: string | null): Provider | null {
    if (value === 'gemini' || value === 'openai' || value === 'opencode' || value === 'codex') {
      return value;
    }
    return null;
  }

  private resolveBeadPath(beadPath: string | null, projectPath: string) {
    const normalized = beadPath?.trim();
    if (!normalized) return null;
    if (path.isAbsolute(normalized) && existsSync(normalized)) return normalized;

    const projectRelative = path.join(projectPath, normalized);
    if (existsSync(projectRelative)) return projectRelative;

    const repoRelative = path.join(this.repoRoot, normalized);
    if (existsSync(repoRelative)) return repoRelative;

    return null;
  }

  private findWorktreePath(runtimeSessionId: string): string | null {
    return getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId)?.worktreePath || null;
  }

  private findGuardrailFailures(): GuardrailFailure[] {
    const failures: GuardrailFailure[] = [];
    for (const session of getRuntimeSessionRepository().listRecent()) {
      if (!session.worktreePath) continue;
      const guardrailLogPath = path.join(session.worktreePath, RUNTIME_GUARDRAIL_LOG_NAME);
      if (!existsSync(guardrailLogPath)) continue;

      const lines = readFileSync(guardrailLogPath, 'utf8').trim().split('\n');
      const snippet = lines.slice(-15).join('\n');
      failures.push({
        sessionId: session.runtimeSessionId,
        worktreePath: session.worktreePath,
        errorSnippet: snippet,
      });
    }
    return failures;
  }
}

let orchestrator: Orchestrator | null = null;

export function getOrchestrator(repoRoot = process.cwd()): Orchestrator {
  if (!orchestrator || orchestrator['repoRoot'] !== repoRoot) {
    orchestrator = new Orchestrator(new SessionSupervisor(), new ExecutionPipelineService(), getRuntimeLockRepository(), repoRoot);
  }
  return orchestrator;
}
