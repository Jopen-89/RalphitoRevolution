import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
  execFileSync('git', ['init', repoRoot], { stdio: 'ignore' });
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
    assert.ok(names.includes('list_project_backlog'));
    assert.ok(names.includes('set_task_priority'));
    assert.ok(names.includes('spawn_session'));
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
    assert.ok(names.includes('design_beads_from_spec'));
    assert.ok(names.includes('write_bead_document'));
    assert.ok(names.includes('inspect_workspace_path'));
  });
});

test('createAllToolDefinitions expone inspect_workspace_path', () => {
  const names = createAllToolDefinitions().map((tool) => tool.name);
  assert.ok(names.includes('inspect_workspace_path'));
  assert.ok(names.includes('design_beads_from_spec'));
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
    const repoRoot = process.env.RALPHITO_REPO_ROOT;
    assert.ok(repoRoot);
    const tool = createDocumentTools(repoRoot).find((item) => item.name === 'write_bead_document');
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

test('document write tools mutate docs/specs desde repo root sin runtime worktree', async () => {
  await withTempDb(async () => {
    const repoRoot = process.env.RALPHITO_REPO_ROOT;
    assert.ok(repoRoot);
    const tools = createDocumentTools();
    const writeSpec = tools.find((item) => item.name === 'write_spec_document');
    const writeBead = tools.find((item) => item.name === 'write_bead_document');
    const designBeads = tools.find((item) => item.name === 'design_beads_from_spec');

    assert.ok(writeSpec);
    assert.ok(writeBead);
    assert.ok(designBeads);

    const specWrite = await writeSpec.execute({
      path: 'projects/system/spec.md',
      content: '# Spec\n',
    }) as { success: boolean; filePath: string; workspaceRoot: string };
    const beadWrite = await writeBead.execute({
      beadPath: 'projects/system/test.md',
      projectKey: 'system',
      title: 'Test',
      content: '# Test\n',
    }) as { success: boolean; filePath: string };

    const specDir = path.join(repoRoot, 'docs', 'specs', 'product');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      path.join(specDir, 'simple.md'),
      ['# Simple', '', '## First Slice', 'Ship it.'].join('\n'),
      'utf8',
    );

    const designResult = await designBeads.execute({
      projectId: 'system',
      specPath: 'docs/specs/product/simple.md',
      maxBeads: 1,
    }) as { success: boolean; createdCount: number };

    assert.equal(specWrite.success, true);
    assert.equal(specWrite.workspaceRoot, repoRoot);
    assert.ok(existsSync(specWrite.filePath));
    assert.equal(beadWrite.success, true);
    assert.ok(existsSync(beadWrite.filePath));
    assert.equal(designResult.success, true);
    assert.equal(designResult.createdCount, 1);
  });
});

test('design_beads_from_spec crea beads markdown y tasks sin schema nueva', async () => {
  await withTempDb(async () => {
    const repoRoot = process.env.RALPHITO_REPO_ROOT;
    assert.ok(repoRoot);

    const specDir = path.join(repoRoot, 'docs', 'specs', 'product');
    mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'stage2-prd.md');
    writeFileSync(
      specPath,
      [
        '# Stage 2 PRD',
        '',
        '## Backlog View',
        'Create a project backlog view for Raymon and operations.',
        '- show pending tasks',
        '- include project filters',
        '',
        '## Poncho Decomposition',
        'Allow Poncho to create executable beads from a source spec.',
        '- create markdown beads',
        '- persist tasks in sqlite',
        '',
        '## Nice To Have',
        'Add extra backlog analytics for later.',
      ].join('\n'),
      'utf8',
    );

    const tool = createDocumentTools(repoRoot).find((item) => item.name === 'design_beads_from_spec');
    assert.ok(tool, 'design_beads_from_spec tool missing');

    const result = await tool.execute({
      projectId: 'system',
      specPath: 'docs/specs/product/stage2-prd.md',
      maxBeads: 2,
      priorityDefault: 'high',
      componentHint: 'src/gateway/tools',
    }) as {
      projectId: string;
      createdCount: number;
      beads: Array<{ taskId: string; beadPath: string; priority: string; componentPath?: string }>;
      warnings: string[];
      success: boolean;
    };

    const db = initializeRalphitoDatabase();
    const rows = db
      .prepare(
        `
          SELECT id, title, project_id AS projectId, bead_path AS beadPath, priority
          FROM tasks
          WHERE source_spec_path = ?
          ORDER BY title ASC
        `,
      )
      .all(specPath) as Array<{
      id: string;
      title: string;
      projectId: string | null;
      beadPath: string | null;
      priority: string;
    }>;

    assert.equal(result.success, true);
    assert.equal(result.projectId, 'system');
    assert.equal(result.createdCount, 2);
    assert.equal(result.beads.length, 2);
    assert.equal(result.beads[0]?.priority, 'high');
    assert.equal(result.beads[0]?.componentPath, 'src/gateway/tools');
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0]?.includes('Only the first 2 beads were created'));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.projectId === 'system'));
    assert.ok(rows.every((row) => row.priority === 'high'));

    const firstBeadPath = result.beads[0]?.beadPath;
    assert.ok(firstBeadPath);
    const beadContent = readFileSync(firstBeadPath, 'utf8');
    assert.ok(beadContent.includes('## Metadata'));
    assert.ok(beadContent.includes('- projectId: system'));
    assert.ok(beadContent.includes('- priority: high'));
    assert.ok(beadContent.includes('- componentPath: src/gateway/tools'));
  });
});

test('design_beads_from_spec replace mode supersedes previous beads from same spec', async () => {
  await withTempDb(async () => {
    const repoRoot = process.env.RALPHITO_REPO_ROOT;
    assert.ok(repoRoot);

    const specDir = path.join(repoRoot, 'docs', 'specs', 'product');
    mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'stage2-replace-prd.md');
    writeFileSync(
      specPath,
      ['# Stage 2 Replace PRD', '', '## First Slice', 'Ship the first slice.', '', '## Second Slice', 'Ship the second slice.'].join('\n'),
      'utf8',
    );

    const tool = createDocumentTools(repoRoot).find((item) => item.name === 'design_beads_from_spec');
    assert.ok(tool, 'design_beads_from_spec tool missing');

    const firstRun = await tool.execute({
      projectId: 'system',
      specPath: 'docs/specs/product/stage2-replace-prd.md',
      maxBeads: 2,
    }) as { beads: Array<{ beadPath: string }>; createdCount: number };

    writeFileSync(
      specPath,
      ['# Stage 2 Replace PRD', '', '## Final Slice', 'Ship the consolidated final slice.'].join('\n'),
      'utf8',
    );

    const secondRun = await tool.execute({
      projectId: 'system',
      specPath: 'docs/specs/product/stage2-replace-prd.md',
      designMode: 'replace',
      maxBeads: 1,
      priorityDefault: 'low',
    }) as {
      createdCount: number;
      replacedCount?: number;
      beads: Array<{ beadPath: string }>;
      warnings: string[];
    };

    const db = initializeRalphitoDatabase();
    const activeRows = db
      .prepare(
        `
          SELECT status, title
          FROM tasks
          WHERE source_spec_path = ?
          ORDER BY created_at ASC
        `,
      )
      .all(specPath) as Array<{ status: string; title: string }>;

    assert.equal(firstRun.createdCount, 2);
    assert.equal(secondRun.createdCount, 1);
    assert.equal(secondRun.replacedCount, 2);
    assert.ok(secondRun.warnings.some((warning) => warning.includes('Replace mode superseded 2 existing beads')));
    assert.ok(!readFileSync(secondRun.beads[0]!.beadPath, 'utf8').includes('First Slice'));
    assert.ok(firstRun.beads.every((bead) => !existsSync(bead.beadPath)));
    assert.deepEqual(activeRows.map((row) => row.status), ['cancelled', 'cancelled', 'pending']);
    assert.deepEqual(activeRows.map((row) => row.title), ['First Slice', 'Second Slice', 'Final Slice']);
  });
});
