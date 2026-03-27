import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRegistryService } from '../../core/services/AgentRegistry.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';
import { loadAgentRegistry } from './agentRegistry.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-telegram-agent-registry-');
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

test('loadAgentRegistry usa agent_registry y refleja provider/model persistidos', async () => {
  await withTempDb(() => {
    AgentRegistryService.updateAgentConfig('poncho', {
      primary_provider: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
      provider_profile: 'martapa',
      execution_harness: 'codex',
      execution_profile: 'jopen',
      tool_calling_mode: 'allowed',
      allowed_tools_json: JSON.stringify(['write_spec_document']),
    });

    const agents = loadAgentRegistry();
    const poncho = agents.find((agent) => agent.id === 'poncho');
    const defaultAgent = agents.find((agent) => agent.id === 'default');

    assert.ok(poncho);
    assert.equal(poncho.provider, 'codex');
    assert.equal(poncho.model, 'gpt-5.4');
    assert.equal(poncho.providerProfile, 'martapa');
    assert.equal(poncho.executionProfile, 'jopen');
    assert.deepEqual(poncho.allowedTools, ['write_spec_document']);
    assert.equal(defaultAgent, undefined);
  });
});
