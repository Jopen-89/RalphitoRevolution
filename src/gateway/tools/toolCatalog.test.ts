import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { AgentRegistryService } from '../../core/services/AgentRegistry.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { createDocumentTools } from './documentTools.js';
import { createAllToolDefinitions, resolveAllowedToolDefinitions } from './toolCatalog.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const tmpDir = createTempDirectory('rr-tool-catalog-');
  const repoRoot = path.join(tmpDir, 'repo-root');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();
  AgentRegistryService.sync();

  return Promise.resolve()
    .then(() => fn())
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
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

function loadAgentConfig(agentId: string) {
  const config = AgentRegistryService.getAgentConfig(agentId);
  assert.ok(config, `agent config missing for ${agentId}`);
  return config;
}

test('resolveAllowedToolDefinitions usa agent_registry para raymon', async () => {
  await withTempDb(() => {
    const raymonConfig = loadAgentConfig('raymon');
    const { allowed, unknownNames } = resolveAllowedToolDefinitions(raymonConfig);
    const names = allowed.map((tool) => tool.name).sort();

    assert.deepEqual(unknownNames, []);
    assert.ok(names.includes('spawn_executor'));
    assert.ok(names.includes('read_workspace_file'));
    assert.ok(names.includes('inspect_workspace_path'));
  });
});

test('resolveAllowedToolDefinitions usa agent_registry para poncho', async () => {
  await withTempDb(() => {
    const ponchoConfig = loadAgentConfig('poncho');
    const { allowed, unknownNames } = resolveAllowedToolDefinitions(ponchoConfig);
    const names = allowed.map((tool) => tool.name).sort();

    assert.deepEqual(unknownNames, []);
    assert.ok(names.includes('write_bead_document'));
    assert.ok(names.includes('inspect_workspace_path'));
  });
});

test('createAllToolDefinitions expone inspect_workspace_path', () => {
  const names = createAllToolDefinitions().map((tool) => tool.name);
  assert.ok(names.includes('inspect_workspace_path'));
  assert.ok(names.includes('git_status'));
  assert.ok(names.includes('git_add'));
  assert.ok(names.includes('git_commit'));
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

test('write_bead_document crea task via lifecycle unificado', async () => {
  await withTempDb(async () => {
    const tool = createDocumentTools().find((item) => item.name === 'write_bead_document');
    assert.ok(tool, 'write_bead_document tool missing');

    const result = await tool.execute({
      beadPath: 'projects/system/test-bead.md',
      projectKey: 'system',
      title: 'Test bead task',
      content: '# Test bead\n',
    }) as { filePath: string; taskId: string; success: boolean };

    const db = initializeRalphitoDatabase();
    const task = db
      .prepare(
        `
          SELECT
            project_id AS projectId,
            bead_path AS beadPath,
            source_spec_path AS sourceSpecPath,
            status
          FROM tasks
          WHERE id = ?
        `,
      )
      .get(result.taskId) as {
      projectId: string | null;
      beadPath: string | null;
      sourceSpecPath: string | null;
      status: string;
    };
    const event = db
      .prepare('SELECT event_type AS eventType FROM task_events WHERE task_id = ? ORDER BY id ASC LIMIT 1')
      .get(result.taskId) as { eventType: string };

    assert.equal(result.success, true);
    assert.equal(task.projectId, 'system');
    assert.equal(task.beadPath, result.filePath);
    assert.equal(task.sourceSpecPath, result.filePath);
    assert.equal(task.status, 'pending');
    assert.equal(event.eventType, 'task_created');
  });
});
