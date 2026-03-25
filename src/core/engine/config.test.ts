import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEngineProjectConfig } from './config.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolveEngineProjectConfig reads explicit provider and model from yaml', () => {
  const repoRoot = createTempDirectory('rr-engine-config-');
  const opsPath = path.join(repoRoot, 'ops');
  const configPath = path.join(opsPath, 'agent-orchestrator.yaml');

  try {
    mkdirSync(opsPath, { recursive: true });
    writeFileSync(
      configPath,
      [
        'defaults:',
        '  agent: opencode',
        '  agentConfig:',
        '    provider: opencode',
        '    model: minimax-m2.7',
        'projects:',
        '  backend-team:',
        `    path: ${repoRoot}`,
        '    agentConfig:',
        '      provider: gemini',
        '      model: gemini-2.5-pro',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = resolveEngineProjectConfig('backend-team', configPath);

    assert.equal(config.agent, 'opencode');
    assert.equal(config.provider, 'gemini');
    assert.equal(config.model, 'gemini-2.5-pro');
    assert.equal(config.path, repoRoot);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});
