import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  executeBash,
  readFileRaw,
  writeFileRaw,
  finishTask,
  createSystemTools,
  createSystemToolDefinitions,
} from './systemTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, '__fixtures__');
const worktreePath = path.join(__dirname, '__worktree_test__');

test.beforeEach(async () => {
  await fs.promises.mkdir(worktreePath, { recursive: true });
  await fs.promises.writeFile(path.join(worktreePath, 'test.txt'), 'hello world\n', 'utf-8');
  await fs.promises.mkdir(path.join(worktreePath, 'subdir'), { recursive: true });
});

test.afterEach(async () => {
  await fs.promises.rm(worktreePath, { recursive: true, force: true });
});

test('execute_bash rejects path traversal via cd /etc', async () => {
  await assert.rejects(
    () => executeBash('cd /etc && cat passwd', worktreePath),
    /Path traversal detected/,
  );
});

test('execute_bash rejects cd .. outside worktree', async () => {
  await assert.rejects(
    () => executeBash('cd .. && ls', worktreePath),
    /Path traversal detected/,
  );
});

test('execute_bash with valid command works', async () => {
  const result = await executeBash('echo test', worktreePath);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), 'test');
});

test('execute_bash respects worktree as cwd', async () => {
  const result = await executeBash('pwd', worktreePath);
  assert.equal(result.stdout.trim(), worktreePath);
});

test('read_file_raw rejects path traversal with ..', async () => {
  await assert.rejects(
    () => readFileRaw('../../../etc/passwd', worktreePath),
    /Path traversal detected/,
  );
});

test('read_file_raw rejects absolute path outside worktree', async () => {
  await assert.rejects(
    () => readFileRaw('/etc/passwd', worktreePath),
    /Path traversal detected/,
  );
});

test('read_file_raw reads valid file', async () => {
  const result = await readFileRaw('test.txt', worktreePath);
  assert.equal(result.content, 'hello world\n');
  assert.ok(result.bytesRead > 0);
});

test('read_file_raw rejects missing file', async () => {
  await assert.rejects(
    () => readFileRaw('nonexistent.txt', worktreePath),
  );
});

test('write_file_raw rejects path traversal', async () => {
  await assert.rejects(
    () => writeFileRaw('../../../etc/passwd', 'malicious', worktreePath),
    /Path traversal detected/,
  );
});

test('write_file_raw writes to valid path', async () => {
  const result = await writeFileRaw('newfile.txt', 'new content', worktreePath);
  assert.ok(result.bytesWritten > 0);
  const content = await fs.promises.readFile(path.join(worktreePath, 'newfile.txt'), 'utf-8');
  assert.equal(content, 'new content');
});

test('write_file_raw creates subdirectories', async () => {
  const result = await writeFileRaw('subdir/deep/nested.txt', 'nested content', worktreePath);
  assert.ok(result.bytesWritten > 0);
  const fullPath = path.join(worktreePath, 'subdir', 'deep', 'nested.txt');
  const content = await fs.promises.readFile(fullPath, 'utf-8');
  assert.equal(content, 'nested content');
});

test.skip('finish_task returns success on clean worktree', async () => {
  const result = await finishTask(worktreePath);
  assert.equal(result.success, true);
  assert.ok(result.message.includes('clean') || result.message.includes('committed'));
});

test.skip('finish_task commits changes when there are uncommitted changes', async () => {
  await fs.promises.writeFile(path.join(worktreePath, 'another.txt'), 'change', 'utf-8');
  const result = await finishTask(worktreePath);
  assert.equal(result.success, true);
  if (result.commitHash) {
    assert.ok(result.commitHash.length > 0);
  }
});

test('createSystemToolDefinitions returns 4 tool definitions', () => {
  const defs = createSystemToolDefinitions();
  assert.equal(defs.length, 4);
  const names = defs.map((d) => d.name).sort();
  assert.deepEqual(names, ['execute_bash', 'finish_task', 'read_file_raw', 'write_file_raw']);
});

test('createSystemTools returns 4 tools', () => {
  const tools = createSystemTools(worktreePath);
  assert.equal(tools.length, 4);
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['execute_bash', 'finish_task', 'read_file_raw', 'write_file_raw']);
});

test('createSystemTools requires worktreePath', async () => {
  const tools = createSystemTools();
  const executeBashTool = tools.find((t) => t.name === 'execute_bash')!;
  await assert.rejects(
    () => executeBashTool.execute({ command: 'echo test' }),
    /worktreePath is required/,
  );
});
