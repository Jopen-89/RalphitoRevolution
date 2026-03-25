import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig, GatewayConfig } from '../interfaces/gateway.types.js';
import { createDocumentTools } from './documentTools.js';
import { createAllToolDefinitions, resolveAllowedToolDefinitions } from './toolCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gatewayConfigPath = path.join(__dirname, '..', 'gateway.config.json');

function loadAgentConfig(agentId: string): AgentConfig {
  const config = JSON.parse(fs.readFileSync(gatewayConfigPath, 'utf8')) as GatewayConfig;
  const agent = config.agents.find((entry) => entry.agentId === agentId);
  assert.ok(agent, `agent config missing for ${agentId}`);
  return agent;
}

test('resolveAllowedToolDefinitions usa gateway.config.json para raymon', () => {
  const raymonConfig = loadAgentConfig('raymon');
  const { allowed, unknownNames } = resolveAllowedToolDefinitions(raymonConfig);
  const names = allowed.map((tool) => tool.name).sort();

  assert.deepEqual(unknownNames, []);
  assert.ok(names.includes('spawn_executor'));
  assert.ok(names.includes('read_workspace_file'));
  assert.ok(names.includes('inspect_workspace_path'));
});

test('resolveAllowedToolDefinitions usa gateway.config.json para poncho', () => {
  const ponchoConfig = loadAgentConfig('poncho');
  const { allowed, unknownNames } = resolveAllowedToolDefinitions(ponchoConfig);
  const names = allowed.map((tool) => tool.name).sort();

  assert.deepEqual(unknownNames, []);
  assert.ok(names.includes('write_bead_document'));
  assert.ok(names.includes('inspect_workspace_path'));
});

test('createAllToolDefinitions expone inspect_workspace_path', () => {
  const names = createAllToolDefinitions().map((tool) => tool.name);
  assert.ok(names.includes('inspect_workspace_path'));
});

test('inspect_workspace_path verifica disco real', async () => {
  const inspectTool = createDocumentTools().find((tool) => tool.name === 'inspect_workspace_path');
  assert.ok(inspectTool, 'inspect_workspace_path tool missing');

  const existing = await inspectTool.execute({ path: 'docs/specs/projects' }) as {
    exists: boolean;
    kind: string;
    resolvedPath: string;
  };
  assert.equal(existing.exists, true);
  assert.equal(existing.kind, 'directory');
  assert.ok(existing.resolvedPath.endsWith(path.join('docs', 'specs', 'projects')));

  const missing = await inspectTool.execute({ path: 'docs/specs/definitely-missing-for-test' }) as {
    exists: boolean;
    kind: string;
  };
  assert.equal(missing.exists, false);
  assert.equal(missing.kind, 'missing');
});
