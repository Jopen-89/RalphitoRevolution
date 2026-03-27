import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEngineProjectConfig } from './config.js';
import { AgentRegistryService } from '../services/AgentRegistry.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const previousDefaultBranch = process.env.RALPHITO_DEFAULT_BRANCH;
  const tmpDir = createTempDirectory('rr-engine-config-');
  const repoRoot = path.join(tmpDir, 'repo-root');
  const worktreeRoot = path.join(tmpDir, 'worktrees-root');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  process.env.RALPHITO_DEFAULT_BRANCH = 'main';
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      if (previousRepoRoot) {
        process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      } else {
        delete process.env.RALPHITO_REPO_ROOT;
      }
      if (previousWorktreeRoot) {
        process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      } else {
        delete process.env.RALPHITO_WORKTREE_ROOT;
      }
      if (previousDefaultBranch) {
        process.env.RALPHITO_DEFAULT_BRANCH = previousDefaultBranch;
      } else {
        delete process.env.RALPHITO_DEFAULT_BRANCH;
      }
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('resolveEngineProjectConfig reads provider and model from agent_registry', async () => {
  await withTempDb(({ repoRoot, worktreeRoot }) => {
    AgentRegistryService.updateAgentConfig('default', {
      execution_harness: 'codex',
      primary_provider: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
    });

    const config = resolveEngineProjectConfig('backend-team');

    assert.equal(config.id, 'backend-team');
    assert.equal(config.canonicalId, 'system');
    assert.equal(config.agentConfigId, 'default');
    assert.equal(config.agent, 'codex');
    assert.equal(config.provider, 'opencode');
    assert.equal(config.model, 'minimax-m2.7');
    assert.equal(config.path, repoRoot);
    assert.equal(config.worktreeRoot, worktreeRoot);
    assert.equal(config.defaultBranch, 'main');
    assert.equal(config.agentRulesFile, 'AGENTS.md');
    assert.equal(config.toolMode, 'allowed');
    assert.ok(config.allowedTools.includes('finish_task'));
  });
});

test('resolveEngineProjectConfig reads direct role config from agent_registry', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('poncho', {
      primary_provider: 'openai',
      provider: 'openai',
      model: 'gpt-5.4',
    });

    const config = resolveEngineProjectConfig('poncho');

    assert.equal(config.id, 'poncho');
    assert.equal(config.name, 'Poncho');
    assert.equal(config.agentConfigId, 'poncho');
    assert.equal(config.provider, 'openai');
    assert.equal(config.model, 'gpt-5.4');
    assert.equal(config.agentRulesFile, 'AGENTS.md');
  });
});

test('resolveEngineProjectConfig includes provider profile from agent_registry', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('poncho', {
      primary_provider: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
      provider_profile: 'jopen',
    });

    const config = resolveEngineProjectConfig('poncho');

    assert.equal(config.provider, 'codex');
    assert.equal(config.model, 'gpt-5.4');
    assert.equal(config.providerProfile, 'jopen');
  });
});
