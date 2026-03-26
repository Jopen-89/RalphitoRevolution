import { existsSync, realpathSync } from 'fs';
import path from 'path';
import { getRalphitoRepositories } from '../infrastructure/persistence/db/index.js';

function isNestedPath(parentPath: string, targetPath: string) {
  const relativePath = path.relative(parentPath, targetPath);
  if (!relativePath || relativePath === '.') return true;
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function resolveExistingPath(targetPath: string) {
  const resolvedPath = path.resolve(targetPath);
  return existsSync(resolvedPath) ? realpathSync.native(resolvedPath) : resolvedPath;
}

export interface WorktreeHeaderValidationResult {
  ok: boolean;
  worktreePath?: string;
  error?: string;
}

export function validateManagedWorktreeHeader(rawWorktreePath: string | undefined): WorktreeHeaderValidationResult {
  if (!rawWorktreePath || typeof rawWorktreePath !== 'string' || !rawWorktreePath.trim()) {
    return { ok: true };
  }

  const trimmed = rawWorktreePath.trim();
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: 'x-ralphito-worktree-path must be absolute.' };
  }

  const resolvedWorktreePath = resolveExistingPath(trimmed);
  if (!existsSync(resolvedWorktreePath)) {
    return { ok: false, error: 'Managed worktree path does not exist.' };
  }

  const activeProjects = getRalphitoRepositories().projects.listActive();
  const managedProject = activeProjects.find((project) => {
    const resolvedRoot = resolveExistingPath(project.worktreeRoot);
    return existsSync(resolvedRoot) && isNestedPath(resolvedRoot, resolvedWorktreePath);
  });

  if (!managedProject) {
    return { ok: false, error: 'Worktree path is outside every managed project worktree root.' };
  }

  return { ok: true, worktreePath: resolvedWorktreePath };
}
