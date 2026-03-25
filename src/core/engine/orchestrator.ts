import path from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import type { Provider } from '../domain/gateway.types.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';
import { SessionSupervisor, type SpawnRuntimeSessionInput } from '../services/SessionManager.js';
import { getEngineSessionsStatus, type EngineStatusSession } from './status.js';
import { resumeRuntimeSession } from './resume.js';
import { RUNTIME_GUARDRAIL_LOG_NAME } from '../domain/constants.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';

export interface OrchestratorSpawnInput {
  project: string;
  prompt: string;
  beadPath?: string;
  workItemKey?: string;
  provider?: Provider;
  model?: string;
  beadSpecHash?: string;
  beadSpecVersion?: string;
  qaConfig?: unknown;
  originThreadId?: number;
  notificationChatId?: string;
}

export interface OrchestratorSpawnResult {
  runtimeSessionId: string;
  baseCommitHash: string;
  worktreePath: string;
  branchName: string;
}

export interface OrchestratorResumeResult {
  success: boolean;
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
    private readonly repoRoot = process.cwd(),
  ) {}

  async spawn(input: OrchestratorSpawnInput): Promise<OrchestratorSpawnResult> {
    const lockRepository = getRuntimeLockRepository();
    const project = input.project;
    const prompt = input.prompt;
    let beadPath = input.beadPath;

    if (!beadPath) {
      beadPath = this.extractBeadPathFromPrompt(prompt);
    }

    const resolvedBeadPath = this.resolveBeadPath(beadPath);

    if (resolvedBeadPath) {
      const targets = resolveWriteScopeTargetsFromBeadFile(resolvedBeadPath, this.repoRoot);
      const conflict = lockRepository.findActiveConflict(targets);
      if (conflict) {
        throw new Error(`LOCK_CONFLICT: ${conflict.relation} lock on ${conflict.requestedPath} blocked by ${conflict.blockingLock.path} (session ${conflict.blockingLock.runtimeSessionId})`);
      }
    }

    const spawnInput: SpawnRuntimeSessionInput = {
      project,
      prompt,
      ...(resolvedBeadPath ? { beadPath: path.relative(this.repoRoot, resolvedBeadPath) } : {}),
      ...(input.workItemKey ? { workItemKey: input.workItemKey } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.beadSpecHash ? { beadSpecHash: input.beadSpecHash } : {}),
      ...(input.beadSpecVersion ? { beadSpecVersion: input.beadSpecVersion } : {}),
      ...(input.qaConfig ? { qaConfig: input.qaConfig } : {}),
      ...(input.originThreadId ? { originThreadId: input.originThreadId } : {}),
      ...(input.notificationChatId ? { notificationChatId: input.notificationChatId } : {}),
    };

    return this.sessionSupervisor.spawn(spawnInput);
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
      return { success: true, message: 'Ralphito resucitado. Error inyectado en su contexto.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
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

  private resolveBeadPath(beadPath: string | undefined): string | null {
    if (!beadPath) return null;
    if (existsSync(beadPath)) return beadPath;
    const relative = path.join(this.repoRoot, beadPath);
    if (existsSync(relative)) return relative;
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
    orchestrator = new Orchestrator(new SessionSupervisor(), repoRoot);
  }
  return orchestrator;
}
