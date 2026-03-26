import { randomUUID } from 'crypto';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';
import type { EngineProjectConfig } from './ProjectService.js';

export interface WorktreeProvisionManager {
  createWorkspace(runtimeSessionId: string, baseCommitHash: string, branchName?: string): Promise<string>;
}

export interface ProvisionWorktreeInput {
  project: EngineProjectConfig;
  worktreeManager: WorktreeProvisionManager;
  runtimeSessionId?: string;
  branchName?: string;
}

export interface ProvisionWorktreeResult {
  project: EngineProjectConfig;
  runtimeSessionId: string;
  baseCommitHash: string;
  branchName: string;
  worktreePath: string;
}

export function createRuntimeSessionId(sessionPrefix: string) {
  return `${sessionPrefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

export class WorktreeProvisioningService {
  constructor(private readonly commandRunner = new CommandRunner()) {}

  async provision(input: ProvisionWorktreeInput): Promise<ProvisionWorktreeResult> {
    const runtimeSessionId = input.runtimeSessionId || createRuntimeSessionId(input.project.sessionPrefix);
    const branchName = input.branchName || `jopen/${runtimeSessionId}`;
    const { stdout } = await this.commandRunner.run('git', ['rev-parse', 'HEAD'], {
      cwd: input.project.path,
    });
    const baseCommitHash = stdout.trim();

    if (!baseCommitHash) {
      throw new Error(`No pude resolver HEAD para proyecto ${input.project.id}`);
    }

    const worktreePath = await input.worktreeManager.createWorkspace(runtimeSessionId, baseCommitHash, branchName);

    return {
      project: input.project,
      runtimeSessionId,
      baseCommitHash,
      branchName,
      worktreePath,
    };
  }
}
