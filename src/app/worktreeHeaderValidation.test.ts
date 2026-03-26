import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../infrastructure/persistence/db/index.js';
import { validateManagedWorktreeHeader } from './worktreeHeaderValidation.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { worktreeRoot: string; outsideRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const tmpDir = createTempDirectory('rr-worktree-header-');
  const worktreeRoot = path.join(tmpDir, 'managed-worktrees');
  const outsideRoot = path.join(tmpDir, 'outside');
  mkdirSync(worktreeRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ worktreeRoot, outsideRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;
      rmSync(tmpDir, { recursive: true, force: true });
    });
}

test('validateManagedWorktreeHeader accepts managed absolute worktree paths', async () => {
  await withTempDb(async ({ worktreeRoot }) => {
    const managedPath = path.join(worktreeRoot, 'runtime-abc');
    mkdirSync(managedPath, { recursive: true });

    assert.deepEqual(validateManagedWorktreeHeader(managedPath), {
      ok: true,
      worktreePath: managedPath,
    });
  });
});

test('validateManagedWorktreeHeader rejects relative, missing, and unmanaged paths', async () => {
  await withTempDb(async ({ worktreeRoot, outsideRoot }) => {
    const missingPath = path.join(worktreeRoot, 'missing-runtime');
    const unmanagedPath = path.join(outsideRoot, 'runtime-xyz');
    mkdirSync(unmanagedPath, { recursive: true });

    assert.equal(validateManagedWorktreeHeader('relative/worktree').ok, false);
    assert.equal(validateManagedWorktreeHeader(missingPath).ok, false);
    assert.equal(validateManagedWorktreeHeader(unmanagedPath).ok, false);
  });
});
