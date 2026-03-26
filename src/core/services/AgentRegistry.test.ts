import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRegistryService } from './AgentRegistry.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-agent-registry-');
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

test('getAgentConfig exposes provider profile and fallback profiles', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('raymon', {
      primary_provider: 'codex',
      provider: 'codex',
      provider_profile: 'jopen',
      model: 'gpt-5.4',
      fallbacks_json: JSON.stringify([
        { provider: 'codex', model: 'gpt-5.4', providerProfile: 'martapa' },
        { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
      ]),
    });

    const config = AgentRegistryService.getAgentConfig('raymon');

    assert.ok(config);
    assert.equal(config.primaryProvider, 'codex');
    assert.equal(config.providerProfile, 'jopen');
    assert.deepEqual(config.fallbacks, [
      { provider: 'codex', model: 'gpt-5.4', providerProfile: 'martapa' },
      { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
    ]);
  });
});

test('sync removes Raymon-only tools from specialist persisted config', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('poncho', {
      tool_mode: 'allowed',
      allowed_tools_json: JSON.stringify(['write_spec_document', 'summon_agent_to_chat']),
    });

    AgentRegistryService.sync();

    const config = AgentRegistryService.getAgentConfig('poncho');
    assert.ok(config);
    assert.deepEqual(config.allowedTools, ['write_spec_document']);
  });
});
