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
} from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-engine-config-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  closeRalphitoDatabase();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('resolveEngineProjectConfig reads provider and model from agent_registry', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
    });

    const config = resolveEngineProjectConfig('backend-team');

    assert.equal(config.id, 'backend-team');
    assert.equal(config.agent, 'opencode');
    assert.equal(config.provider, 'opencode');
    assert.equal(config.model, 'minimax-m2.7');
    assert.equal(config.path, process.cwd());
    assert.ok(config.worktreeRoot.endsWith(path.join('.ralphito', 'worktrees')));
    assert.equal(config.agentRulesFile, 'AGENTS.md');
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
