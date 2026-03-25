import path from 'path';

export function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Parameter '${name}' must be a non-empty string.`);
  }

  return value;
}

export function requireStringArray(value: unknown, name: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Parameter '${name}' must be a non-empty array.`);
  }

  const normalized = value.map((entry) => requireString(entry, `${name}[]`).trim());
  if (normalized.some((entry) => entry.length === 0)) {
    throw new Error(`Parameter '${name}' must contain non-empty strings.`);
  }

  return normalized;
}

export function requireWorktreePath(worktreePath: string | undefined) {
  if (!worktreePath || typeof worktreePath !== 'string' || !worktreePath.trim()) {
    throw new Error('worktreePath is required for system tools.');
  }

  return worktreePath;
}

export function resolvePathInsideRoot(rootPath: string, targetPath: string) {
  const normalizedRoot = path.resolve(rootPath);
  const sanitizedTarget = targetPath.replace(/\\/g, '/');
  const resolvedPath = path.resolve(normalizedRoot, sanitizedTarget);
  const relativePath = path.relative(normalizedRoot, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path traversal detected: ${targetPath}`);
  }

  return resolvedPath;
}

export function ensureRelativeWorktreePath(targetPath: string, worktreePath: string) {
  const resolvedPath = resolvePathInsideRoot(worktreePath, targetPath);
  return path.relative(path.resolve(worktreePath), resolvedPath) || '.';
}
