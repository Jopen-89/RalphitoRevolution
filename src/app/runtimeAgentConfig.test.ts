import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import { writeRuntimeSessionFile } from '../core/engine/runtimeFiles.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../infrastructure/persistence/db/index.js';
import { resolveRuntimeAgentConfig } from './runtimeAgentConfig.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const tmpDir = createTempDirectory('rr-runtime-agent-config-');
  const repoRoot = path.join(tmpDir, 'repo-root');
  const worktreeRoot = path.join(tmpDir, 'worktrees-root');

  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('resolveRuntimeAgentConfig congela snapshot y corrige alias backend-team -> default', async () => {
  await withTempDb(({ worktreeRoot }) => {
    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      tool_calling_mode: 'allowed',
      allowed_tools_json: JSON.stringify(['finish_task']),
    });
    AgentRegistryService.updateAgentConfig('ralphito', {
      primary_provider: 'openai',
      provider: 'openai',
      model: 'gpt-5.4',
      tool_calling_mode: 'none',
      allowed_tools_json: JSON.stringify([]),
    });

    const now = new Date().toISOString();
    const worktreePath = path.join(worktreeRoot, 'runtime-1');
    mkdirSync(worktreePath, { recursive: true });
    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId: 'runtime-1',
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/runtime-1',
      worktreePath,
      tmuxSessionId: 'runtime-1',
      pid: null,
      prompt: 'test',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      agentConfigSnapshot: {
        primaryProvider: 'opencode',
        model: 'minimax-m2.7',
        providerProfile: null,
        executionHarness: 'codex',
        executionProfile: 'jopen',
        toolMode: 'allowed',
        allowedTools: ['finish_task'],
        fallbacks: [],
        resolvedAt: now,
      },
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'openai',
      provider: 'openai',
      model: 'gpt-5.4',
      tool_calling_mode: 'none',
      allowed_tools_json: JSON.stringify([]),
    });

    const resolved = resolveRuntimeAgentConfig(worktreePath);

    assert.ok(resolved);
    assert.equal(resolved?.resolvedAgentId, 'default');
    assert.equal(resolved?.agentConfig.primaryProvider, 'opencode');
    assert.equal(resolved?.agentConfig.model, 'minimax-m2.7');
    assert.equal(resolved?.agentConfig.executionHarness, 'codex');
    assert.equal(resolved?.agentConfig.executionProfile, 'jopen');
    assert.equal(resolved?.agentConfig.toolMode, 'allowed');
    assert.deepEqual(resolved?.agentConfig.allowedTools, ['finish_task']);
  });
});
