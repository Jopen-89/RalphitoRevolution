import path from 'path';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';
import { SessionSupervisor, type SpawnRuntimeSessionInput } from './sessionSupervisor.js';
import { getEngineSessionsStatus, type EngineStatusSession } from './status.js';
import { resumeRuntimeSession } from './resume.js';
import { ENGINE_WORKTREE_ROOT, RUNTIME_GUARDRAIL_LOG_NAME } from './constants.js';

export interface RaymonSpawnInput {
  project: string;
  prompt: string;
  beadPath?: string;
  workItemKey?: string;
  model?: string;
  beadSpecHash?: string;
  beadSpecVersion?: string;
  qaConfig?: unknown;
  originThreadId?: number;
  notificationChatId?: string;
}

export interface RaymonSpawnResult {
  runtimeSessionId: string;
  baseCommitHash: string;
  worktreePath: string;
  branchName: string;
}

export interface RaymonResumeResult {
  success: boolean;
  message: string;
}

export interface GuardrailFailure {
  sessionId: string;
  worktreePath: string;
  errorSnippet: string;
}

export interface RaymonStatusResult {
  sessions: EngineStatusSession[];
  guardrailFailures: GuardrailFailure[];
  autopilotActive: boolean;
}

export interface RaymonDivergenceResult {
  status: 'success' | 'partial' | 'error';
  message: string;
  failedTeams?: string[];
}

export class RaymonOrchestrator {
  constructor(
    private readonly sessionSupervisor = new SessionSupervisor(),
    private readonly repoRoot = process.cwd(),
  ) {}

  async spawn(input: RaymonSpawnInput): Promise<RaymonSpawnResult> {
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
      ...(input.model ? { model: input.model } : {}),
      ...(input.beadSpecHash ? { beadSpecHash: input.beadSpecHash } : {}),
      ...(input.beadSpecVersion ? { beadSpecVersion: input.beadSpecVersion } : {}),
      ...(input.qaConfig ? { qaConfig: input.qaConfig } : {}),
      ...(input.originThreadId ? { originThreadId: input.originThreadId } : {}),
      ...(input.notificationChatId ? { notificationChatId: input.notificationChatId } : {}),
    };

    return this.sessionSupervisor.spawn(spawnInput);
  }

  async resume(runtimeSessionId: string): Promise<RaymonResumeResult> {
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

  async getStatus(): Promise<RaymonStatusResult> {
    const sessions = await getEngineSessionsStatus();
    const guardrailFailures = this.findGuardrailFailures();
    const autopilotActive = sessions.some((s) => s.alive && s.status === 'running');
    return { sessions, guardrailFailures, autopilotActive };
  }

  async launchDivergence(projectId: string, seedIdea: string): Promise<RaymonDivergenceResult> {
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
    const worktreeRoot = path.join(this.repoRoot, ENGINE_WORKTREE_ROOT);
    if (!existsSync(worktreeRoot)) return null;
    const candidate = path.join(worktreeRoot, runtimeSessionId);
    return existsSync(candidate) ? candidate : null;
  }

  private findGuardrailFailures(): GuardrailFailure[] {
    const worktreeRoot = path.join(this.repoRoot, ENGINE_WORKTREE_ROOT);
    if (!existsSync(worktreeRoot)) return [];

    const failures: GuardrailFailure[] = [];
    try {
      const entries = readdirSync(worktreeRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const guardrailLogPath = path.join(worktreeRoot, entry.name, RUNTIME_GUARDRAIL_LOG_NAME);
        if (existsSync(guardrailLogPath)) {
          const lines = readFileSync(guardrailLogPath, 'utf8').trim().split('\n');
          const snippet = lines.slice(-15).join('\n');
          failures.push({
            sessionId: entry.name,
            worktreePath: path.join(worktreeRoot, entry.name),
            errorSnippet: snippet,
          });
        }
      }
    } catch {
      // directory may not exist or be readable
    }
    return failures;
  }
}

let raymonOrchestrator: RaymonOrchestrator | null = null;

export function getRaymonOrchestrator(repoRoot = process.cwd()): RaymonOrchestrator {
  if (!raymonOrchestrator || raymonOrchestrator['repoRoot'] !== repoRoot) {
    raymonOrchestrator = new RaymonOrchestrator(new SessionSupervisor(), repoRoot);
  }
  return raymonOrchestrator;
}
