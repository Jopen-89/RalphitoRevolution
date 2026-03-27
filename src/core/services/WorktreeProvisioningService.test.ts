import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EngineProjectConfig } from './ProjectService.js';
import { WorktreeProvisioningService, createRuntimeSessionId } from './WorktreeProvisioningService.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';

const GIT_BIN = '/usr/bin/git';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(cwd: string, args: string[]) {
  execFileSync(GIT_BIN, args, { cwd, stdio: 'ignore' });
}

function createTempRepo() {
  const repoRoot = createTempDirectory('rr-worktree-provision-repo-');
  writeFileSync(path.join(repoRoot, 'package.json'), '{}\n', 'utf8');
  writeFileSync(path.join(repoRoot, 'AGENTS.md'), 'Usa finish_task.\n', 'utf8');

  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.name', 'Codex']);
  runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'seed']);

  const headRef = readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
  const refName = headRef.replace('ref: ', '');
  const headCommit = readFileSync(path.join(repoRoot, '.git', refName), 'utf8').trim();
  return { repoRoot, headCommit };
}

function createProject(repoRoot: string, worktreeRoot: string): EngineProjectConfig {
  return {
    id: 'system',
    name: 'System',
    canonicalId: 'system',
    aliases: [],
    sessionPrefix: 'sy',
    path: repoRoot,
    worktreeRoot,
    defaultBranch: 'master',
    agentRulesFile: 'AGENTS.md',
    agent: 'opencode',
    provider: 'opencode',
    model: 'minimax-m2.7',
    toolMode: 'none',
    allowedTools: [],
    fallbacks: [],
  };
}

test('createRuntimeSessionId uses session prefix', () => {
  const runtimeSessionId = createRuntimeSessionId('be');

  assert.match(runtimeSessionId, /^be-[a-z0-9]+-[a-f0-9]{6}$/);
});

test('WorktreeProvisioningService resolves HEAD and creates managed worktree', async () => {
  const { repoRoot, headCommit } = createTempRepo();
  const worktreeRoot = createTempDirectory('rr-worktree-provision-root-');
  mkdirSync(worktreeRoot, { recursive: true });

  try {
    const project = createProject(repoRoot, worktreeRoot);
    const worktreeManager = new WorktreeManager(project.path, project.worktreeRoot);
    const service = new WorktreeProvisioningService();

    const result = await service.provision({
      project,
      worktreeManager,
      runtimeSessionId: 'sy-test-123456',
    });

    assert.equal(result.project.id, 'system');
    assert.equal(result.runtimeSessionId, 'sy-test-123456');
    assert.equal(result.baseCommitHash, headCommit);
    assert.equal(result.branchName, 'jopen/sy-test-123456');
    assert.equal(result.worktreePath, path.join(worktreeRoot, 'sy-test-123456'));
    assert.equal(readFileSync(path.join(result.worktreePath, '.git'), 'utf8').includes('gitdir:'), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

test('WorktreeProvisioningService respects explicit branch name', async () => {
  const { repoRoot } = createTempRepo();
  const worktreeRoot = createTempDirectory('rr-worktree-provision-branch-');
  mkdirSync(worktreeRoot, { recursive: true });

  try {
    const project = createProject(repoRoot, worktreeRoot);
    const worktreeManager = new WorktreeManager(project.path, project.worktreeRoot);
    const service = new WorktreeProvisioningService();

    const result = await service.provision({
      project,
      worktreeManager,
      runtimeSessionId: 'sy-manual-branch',
      branchName: 'jopen/custom-stage3-branch',
    });

    const gitPointer = readFileSync(path.join(result.worktreePath, '.git'), 'utf8').trim();
    const gitDir = gitPointer.replace(/^gitdir:\s*/, '').trim();
    const headRef = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();

    assert.equal(result.branchName, 'jopen/custom-stage3-branch');
    assert.equal(headRef, 'ref: refs/heads/jopen/custom-stage3-branch');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(worktreeRoot, { recursive: true, force: true });
  }
});
