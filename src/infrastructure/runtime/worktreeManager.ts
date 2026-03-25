import { execFile } from 'child_process';
import { existsSync, mkdirSync, realpathSync, rmSync } from 'fs';
import path from 'path';
import * as util from 'util';
import { ProjectService } from '../../core/services/ProjectService.js';

const execFileAsync = util.promisify(execFile);

function resolveRepoRoot(repoRoot: string) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  return existsSync(absoluteRepoRoot) ? realpathSync.native(absoluteRepoRoot) : absoluteRepoRoot;
}

function isNestedPath(parentPath: string, targetPath: string) {
  const relativePath = path.relative(parentPath, targetPath);
  if (relativePath === '' || relativePath === '.') return true;
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreeRootPath: string;

  constructor(repoRoot = process.cwd(), worktreeRootPath?: string) {
    this.repoRoot = resolveRepoRoot(repoRoot);
    this.worktreeRootPath = resolveRepoRoot(worktreeRootPath || ProjectService.resolve('default').worktreeRoot);
  }

  getWorktreeRootPath() {
    return this.worktreeRootPath;
  }

  getWorkspacePath(runtimeSessionId: string) {
    return path.join(this.worktreeRootPath, runtimeSessionId);
  }

  isManagedWorkspace(worktreePath: string) {
    const resolvedPath = path.resolve(worktreePath);
    return isNestedPath(this.worktreeRootPath, resolvedPath);
  }

  async createWorkspace(runtimeSessionId: string, baseCommit: string, branchName?: string) {
    mkdirSync(this.worktreeRootPath, { recursive: true });

    const workspacePath = this.getWorkspacePath(runtimeSessionId);
    if (existsSync(workspacePath)) {
      throw new Error(`Workspace ya existe para ${runtimeSessionId}: ${workspacePath}`);
    }

    if (branchName) {
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, workspacePath, baseCommit], {
        cwd: this.repoRoot,
      });
    } else {
      await execFileAsync('git', ['worktree', 'add', '--detach', workspacePath, baseCommit], {
        cwd: this.repoRoot,
      });
    }

    return workspacePath;
  }

  async teardownWorkspace(runtimeSessionId: string) {
    return this.teardownWorkspacePath(this.getWorkspacePath(runtimeSessionId));
  }

  async teardownWorkspacePath(worktreePath: string) {
    if (!this.isManagedWorkspace(worktreePath)) return false;

    const resolvedPath = path.resolve(worktreePath);
    let removed = false;

    if (existsSync(resolvedPath)) {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', resolvedPath], {
          cwd: this.repoRoot,
        });
      } catch {
        rmSync(resolvedPath, { force: true, recursive: true });
      }

      removed = true;
    }

    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: this.repoRoot });
    } catch {
      return removed;
    }

    return removed;
  }
}
