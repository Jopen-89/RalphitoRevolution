import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import path from 'path';

export type RuntimeLockPathKind = 'file' | 'directory';
export type RuntimePathCollisionRelation = 'same' | 'ancestor' | 'descendant';

export interface ResolvedWriteScopeTarget {
  path: string;
  pathKind: RuntimeLockPathKind;
  repoRelativePath: string;
  sourceGlobs: string[];
}

interface LockTargetLike {
  path: string;
  pathKind: RuntimeLockPathKind;
}

const WILDCARD_SEGMENT_PATTERN = /[*?[\]{}!]/;
const WRITE_ONLY_GLOBS_PATTERN = /^\[WRITE_ONLY_GLOBS\]:\s*(.+)$/m;

function resolveRepoRoot(repoRoot: string) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  return existsSync(absoluteRepoRoot) ? realpathSync.native(absoluteRepoRoot) : absoluteRepoRoot;
}

function resolveExistingPath(targetPath: string) {
  const absoluteTargetPath = path.resolve(targetPath);
  return existsSync(absoluteTargetPath) ? realpathSync.native(absoluteTargetPath) : absoluteTargetPath;
}

function ensurePathInsideRepo(repoRoot: string, targetPath: string) {
  const relativePath = path.relative(repoRoot, targetPath);

  if (relativePath === '' || relativePath === '.') return;
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) return;

  throw new Error(`WRITE_ONLY_GLOBS fuera del repo: ${targetPath}`);
}

function inferPathKind(pattern: string, resolvedPath: string, hasWildcards: boolean): RuntimeLockPathKind {
  if (hasWildcards) return 'directory';
  if (!existsSync(resolvedPath)) return path.extname(pattern) ? 'file' : 'directory';
  return statSync(resolvedPath).isDirectory() ? 'directory' : 'file';
}

function getBasePatternFromGlob(globPattern: string) {
  const normalizedPattern = globPattern.replace(/\\/g, '/');
  const segments = normalizedPattern.split('/').filter(Boolean);
  const baseSegments: string[] = [];

  for (const segment of segments) {
    if (WILDCARD_SEGMENT_PATTERN.test(segment)) break;
    baseSegments.push(segment);
  }

  return baseSegments.join('/');
}

function isDescendantPath(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function collapseWriteScopeTargets(targets: ResolvedWriteScopeTarget[]) {
  const sortedTargets = [...targets].sort((left, right) => {
    if (left.path.length !== right.path.length) return left.path.length - right.path.length;
    return left.path.localeCompare(right.path);
  });

  const collapsedTargets: ResolvedWriteScopeTarget[] = [];

  for (const target of sortedTargets) {
    const existingTarget = collapsedTargets.find((candidate) => {
      if (candidate.path === target.path) return true;
      return isDescendantPath(candidate.path, target.path);
    });

    if (!existingTarget) {
      collapsedTargets.push(target);
      continue;
    }

    existingTarget.sourceGlobs = Array.from(new Set([...existingTarget.sourceGlobs, ...target.sourceGlobs]));
  }

  return collapsedTargets;
}

export function parseWriteOnlyGlobsFromBeadFile(beadPath: string) {
  const beadContent = readFileSync(beadPath, 'utf8');
  const match = beadContent.match(WRITE_ONLY_GLOBS_PATTERN);

  if (!match?.[1]) return [];

  const parsedValue = JSON.parse(match[1]) as unknown;
  if (!Array.isArray(parsedValue) || parsedValue.some((value) => typeof value !== 'string')) {
    throw new Error(`WRITE_ONLY_GLOBS invalido en ${beadPath}`);
  }

  return parsedValue;
}

export function resolveWriteScopeTargetsFromGlobs(globs: string[], repoRoot = process.cwd()) {
  const resolvedRepoRoot = resolveRepoRoot(repoRoot);

  const resolvedTargets = globs.map((globPattern) => {
    const hasWildcards = WILDCARD_SEGMENT_PATTERN.test(globPattern);
    const basePattern = hasWildcards ? getBasePatternFromGlob(globPattern) : globPattern;
    const resolvedPath = resolveExistingPath(path.resolve(resolvedRepoRoot, basePattern || '.'));

    ensurePathInsideRepo(resolvedRepoRoot, resolvedPath);

    return {
      path: resolvedPath,
      pathKind: inferPathKind(basePattern || globPattern, resolvedPath, hasWildcards),
      repoRelativePath: path.relative(resolvedRepoRoot, resolvedPath) || '.',
      sourceGlobs: [globPattern],
    } satisfies ResolvedWriteScopeTarget;
  });

  return collapseWriteScopeTargets(resolvedTargets);
}

export function resolveWriteScopeTargetsFromBeadFile(beadPath: string, repoRoot = process.cwd()) {
  return resolveWriteScopeTargetsFromGlobs(parseWriteOnlyGlobsFromBeadFile(beadPath), repoRoot);
}

export function getRuntimePathCollisionRelation(leftPath: string, rightPath: string): RuntimePathCollisionRelation | null {
  if (leftPath === rightPath) return 'same';
  if (isDescendantPath(leftPath, rightPath)) return 'ancestor';
  if (isDescendantPath(rightPath, leftPath)) return 'descendant';
  return null;
}

export function collapseRuntimeLockTargets<T extends LockTargetLike>(targets: T[]) {
  const sortedTargets = [...targets].sort((left, right) => {
    if (left.path.length !== right.path.length) return left.path.length - right.path.length;
    return left.path.localeCompare(right.path);
  });

  const collapsedTargets: T[] = [];

  for (const target of sortedTargets) {
    const isCovered = collapsedTargets.some((candidate) => {
      if (candidate.path === target.path) return true;
      return isDescendantPath(candidate.path, target.path);
    });

    if (isCovered) continue;
    collapsedTargets.push(target);
  }

  return collapsedTargets;
}
