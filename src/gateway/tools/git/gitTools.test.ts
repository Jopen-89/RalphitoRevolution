import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createGitTools } from './gitTools.js';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]) {
  await execFileAsync('git', args, { cwd });
}

async function createTempRepo() {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), 'rr-git-tools-'));
  await runGit(repoPath, ['init']);
  await runGit(repoPath, ['config', 'user.name', 'Ralphito Test']);
  await runGit(repoPath, ['config', 'user.email', 'ralphito@example.com']);
  await writeFile(path.join(repoPath, 'README.md'), 'hello\n', 'utf8');
  await runGit(repoPath, ['add', 'README.md']);
  await runGit(repoPath, ['commit', '-m', 'init']);
  return repoPath;
}

test('git tools stage and commit files natively', async () => {
  const repoPath = await createTempRepo();

  try {
    const tools = createGitTools(repoPath);
    const gitAdd = tools.find((tool) => tool.name === 'git_add');
    const gitCommit = tools.find((tool) => tool.name === 'git_commit');
    const gitStatus = tools.find((tool) => tool.name === 'git_status');
    assert.ok(gitAdd);
    assert.ok(gitCommit);
    assert.ok(gitStatus);

    await writeFile(path.join(repoPath, 'notes.txt'), 'phase-4\n', 'utf8');
    const before = await gitStatus.execute({}) as { untrackedFiles: string[] };
    assert.deepEqual(before.untrackedFiles, ['notes.txt']);

    const addResult = await gitAdd.execute({ paths: ['notes.txt'] }) as { added: string[] };
    assert.deepEqual(addResult.added, ['notes.txt']);

    const afterAdd = await gitStatus.execute({}) as { stagedFiles: string[] };
    assert.deepEqual(afterAdd.stagedFiles, ['notes.txt']);

    const commitResult = await gitCommit.execute({ message: 'add notes' }) as { summary: string; commitHash: string };
    assert.equal(commitResult.summary, 'add notes');
    assert.ok(commitResult.commitHash.length > 0);
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
});
