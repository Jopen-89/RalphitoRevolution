import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  getRalphitoDatabase,
  getRalphitoRepositories,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from './index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(
  fn: (ctx: { tmpDir: string; dbPath: string; repoRoot: string; worktreeRoot: string }) => Promise<T> | T,
) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const previousDefaultBranch = process.env.RALPHITO_DEFAULT_BRANCH;
  const tmpDir = createTempDirectory('rr-db-repositories-');
  const dbPath = path.join(tmpDir, 'ralphito.sqlite');
  const repoRoot = path.join(tmpDir, 'repo');
  const worktreeRoot = path.join(tmpDir, 'worktrees');

  process.env.RALPHITO_DB_PATH = dbPath;
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  process.env.RALPHITO_DEFAULT_BRANCH = 'main';

  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ tmpDir, dbPath, repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();

      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;

      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;

      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;

      if (previousDefaultBranch) process.env.RALPHITO_DEFAULT_BRANCH = previousDefaultBranch;
      else delete process.env.RALPHITO_DEFAULT_BRANCH;

      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('initializeRalphitoDatabase seeds the system project', async () => {
  await withTempDb(({ repoRoot, worktreeRoot }) => {
    const db = getRalphitoDatabase();
    const row = db
      .prepare(
        `
          SELECT
            project_id AS projectId,
            name,
            kind,
            repo_path AS repoPath,
            worktree_root AS worktreeRoot,
            default_branch AS defaultBranch,
            agent_rules_file AS agentRulesFile,
            is_active AS isActive
          FROM projects
          WHERE project_id = 'system'
        `,
      )
      .get() as {
      projectId: string;
      name: string;
      kind: string;
      repoPath: string;
      worktreeRoot: string;
      defaultBranch: string;
      agentRulesFile: string | null;
      isActive: number;
    };

    assert.equal(row.projectId, 'system');
    assert.equal(row.name, 'Ralphito System');
    assert.equal(row.kind, 'system');
    assert.equal(row.repoPath, repoRoot);
    assert.equal(row.worktreeRoot, worktreeRoot);
    assert.equal(row.defaultBranch, 'main');
    assert.equal(row.agentRulesFile, 'AGENTS.md');
    assert.equal(row.isActive, 1);
  });
});

test('ProjectsRepository upsert and listActive persist DB-first project metadata', async () => {
  await withTempDb(() => {
    const repos = getRalphitoRepositories();

    repos.projects.upsert({
      projectId: 'qa-pipeline-smoke',
      name: 'QA Pipeline Smoke',
      kind: 'repo',
      repoPath: '/tmp/qa-pipeline',
      worktreeRoot: '/tmp/qa-pipeline/.ralphito/worktrees',
      defaultBranch: 'main',
      agentRulesFile: 'AGENTS.md',
      isActive: true,
    });

    repos.projects.upsert({
      projectId: 'archived-lab',
      name: 'Archived Lab',
      kind: 'sandbox',
      repoPath: '/tmp/archived-lab',
      worktreeRoot: '/tmp/archived-lab/.ralphito/worktrees',
      defaultBranch: 'master',
      agentRulesFile: 'AGENTS.md',
      isActive: false,
    });

    const activeProjectIds = repos.projects.listActive().map((project) => project.projectId);
    const qaProject = repos.projects.getById('qa-pipeline-smoke');

    assert.ok(activeProjectIds.includes('system'));
    assert.ok(activeProjectIds.includes('qa-pipeline-smoke'));
    assert.ok(!activeProjectIds.includes('archived-lab'));
    assert.equal(qaProject?.repoPath, '/tmp/qa-pipeline');
    assert.equal(qaProject?.defaultBranch, 'main');
    assert.equal(qaProject?.isActive, true);
  });
});
