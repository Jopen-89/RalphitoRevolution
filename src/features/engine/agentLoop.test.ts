import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  loadBeadFromInstruction,
  buildInitialMessages,
  hasFinishIndicator,
  MAX_ITERATIONS,
  RALPHITO_SYSTEM_PROMPT,
} from './agentLoop.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('loadBeadFromInstruction reads .md file', () => {
  const tmpDir = createTempDirectory('rr-agentloop-test-');
  try {
    const beadPath = path.join(tmpDir, 'test-bead.md');
    writeFileSync(beadPath, '# Test Bead\n\nImplement this.', 'utf-8');
    
    const result = loadBeadFromInstruction(beadPath);
    assert.ok(result.includes('Test Bead'));
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

test('loadBeadFromInstruction returns instruction string if not a file path', () => {
  const instruction = 'Simple instruction without newlines or .md';
  const result = loadBeadFromInstruction(instruction);
  assert.equal(result, instruction);
});

test('loadBeadFromInstruction returns instruction if file does not exist', () => {
  const instruction = '/nonexistent/path/bead.md';
  const result = loadBeadFromInstruction(instruction);
  assert.equal(result, instruction);
});

test('buildInitialMessages creates system and user messages', () => {
  const messages = buildInitialMessages('You are a bot', 'Do the thing');
  
  assert.equal(messages.length, 2);
  assert.ok(messages[0]);
  assert.ok(messages[1]);
  assert.equal(messages[0]!.role, 'system');
  assert.equal(messages[0]!.content, 'You are a bot');
  assert.equal(messages[1]!.role, 'user');
  assert.equal(messages[1]!.content, 'Do the thing');
});

test('hasFinishIndicator detects finish keywords', () => {
  assert.equal(hasFinishIndicator('Task is done'), true);
  assert.equal(hasFinishIndicator('Implementation complete'), true);
  assert.equal(hasFinishIndicator('FINISH'), true);
  assert.equal(hasFinishIndicator('All good'), false);
  assert.equal(hasFinishIndicator(''), false);
});

test('RALPHITO_SYSTEM_PROMPT contains tool descriptions', () => {
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('execute_bash'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('read_file_raw'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('write_file_raw'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('finish_task'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('worktree'));
});

test('MAX_ITERATIONS is 120', () => {
  assert.equal(MAX_ITERATIONS, 120);
});

test('RALPHITO_SYSTEM_PROMPT contains security rules', () => {
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('NEVER leave the worktree'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('cd'));
});

test('RALPHITO_SYSTEM_PROMPT contains workflow instructions', () => {
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('Read the bead'));
  assert.ok(RALPHITO_SYSTEM_PROMPT.includes('finish_task'));
});
