import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../infrastructure/persistence/db/index.js';
import { buildCliUpdateBody, listAgentsForCli, setAgentForCli } from './agentRegistryCli.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-agent-cli-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('buildCliUpdateBody parsea arrays, null y bool', () => {
  const body = buildCliUpdateBody([
    'providerProfile',
    'null',
    'allowedTools',
    'finish_task,git_status',
    'fallbacks',
    'openai:gpt-5.4,codex:gpt-5.4@jopen',
    'isActive',
    'false',
  ]);

  assert.equal(body.providerProfile, null);
  assert.deepEqual(body.allowedTools, ['finish_task', 'git_status']);
  assert.deepEqual(body.fallbacks, [
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'codex', model: 'gpt-5.4', providerProfile: 'jopen' },
  ]);
  assert.equal(body.isActive, false);
});

test('setAgentForCli actualiza config y listAgentsForCli lo expone', async () => {
  await withTempDb(() => {
    const result = setAgentForCli('poncho', [
      'executionHarness',
      'codex',
      'toolMode',
      'allowed',
      'allowedTools',
      'finish_task',
    ]);

    assert.equal(result.success, true);
    assert.equal(result.appliesTo, 'new_sessions_only');
    assert.equal(result.agent.executionHarness, 'codex');
    assert.equal(result.agent.toolMode, 'allowed');
    assert.deepEqual(result.agent.allowedTools, ['finish_task']);

    const listed = listAgentsForCli();
    const poncho = listed.find((agent) => agent.agentId === 'poncho');
    assert.ok(poncho);
    assert.equal(poncho?.executionHarness, 'codex');
  });
});
