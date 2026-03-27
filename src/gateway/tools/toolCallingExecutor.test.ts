import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { IToolCallingProvider, Message, ToolDefinition } from '../../core/domain/gateway.types.js';
import { executeToolCallLoop } from './toolCallingExecutor.js';

const TEST_TOOLS: ToolDefinition[] = [
  {
    name: 'execute_bash',
    description: 'Run a shell command',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to run',
        },
      },
      required: ['command'],
    },
  },
];

function createProvider(
  responses: Array<{ text: string; toolCalls: Array<{ id?: string; name: string; arguments: Record<string, unknown> }> }>,
): IToolCallingProvider {
  let callIndex = 0;

  return {
    name: 'gemini',
    async generateResponse() {
      return '';
    },
    async generateResponseWithTools() {
      return responses[callIndex++] || { text: '', toolCalls: [] };
    },
  };
}

test('executeToolCallLoop preserves structured tool output for downstream providers', async () => {
  const messages: Message[] = [{ role: 'user', content: 'read package.json' }];
  const provider = createProvider([
    {
      text: '',
      toolCalls: [{ id: 'read-1', name: 'execute_bash', arguments: { command: 'cat package.json' } }],
    },
    {
      text: 'done',
      toolCalls: [],
    },
  ]);

  const executionResult = await executeToolCallLoop(
    messages,
    TEST_TOOLS,
    [{
      name: 'execute_bash',
      description: 'Run a shell command',
      execute: async () => ({
        stdout: '{"name":"ralphito"}',
        stderr: '',
        exitCode: 0,
      }),
    }],
    provider,
    {},
    3,
  );

  assert.equal(executionResult.text, 'done');
  assert.deepEqual(executionResult.toolResults[0]?.payload, {
    output: {
      stdout: '{"name":"ralphito"}',
      stderr: '',
      exitCode: 0,
    },
  });
  assert.deepEqual(messages.at(-1)?.toolResult, {
    output: {
      stdout: '{"name":"ralphito"}',
      stderr: '',
      exitCode: 0,
    },
  });
});

test('executeToolCallLoop aborts repeated identical tool iterations before re-executing', async () => {
  const messages: Message[] = [{ role: 'user', content: 'run git status once' }];
  let executionCount = 0;
  const provider = createProvider([
    {
      text: '',
      toolCalls: [{ id: 'bash-1', name: 'execute_bash', arguments: { command: 'git status' } }],
    },
    {
      text: '',
      toolCalls: [{ id: 'bash-2', name: 'execute_bash', arguments: { command: 'git status' } }],
    },
  ]);

  await assert.rejects(
    () => executeToolCallLoop(
      messages,
      TEST_TOOLS,
      [{
        name: 'execute_bash',
        description: 'Run a shell command',
        execute: async () => {
          executionCount += 1;
          return 'clean';
        },
      }],
      provider,
      {},
      4,
    ),
    /Detected repeated tool loop: execute_bash\(\{"command":"git status"\}\)/,
  );

  assert.equal(executionCount, 1);
});

test('executeToolCallLoop rejects blank final text when no tool calls are returned', async () => {
  const messages: Message[] = [{ role: 'user', content: 'di algo' }];
  const provider = createProvider([
    {
      text: '   ',
      toolCalls: [],
    },
  ]);

  await assert.rejects(
    () => executeToolCallLoop(messages, TEST_TOOLS, [], provider, {}, 2),
    /returned empty response without tool calls/i,
  );
});

test('executeToolCallLoop reintenta cuando falta una tool obligatoria', async () => {
  const messages: Message[] = [{ role: 'user', content: 'guarda el prd' }];
  const provider = createProvider([
    {
      text: 'El PRD ya existe.',
      toolCalls: [],
    },
    {
      text: '',
      toolCalls: [{ id: 'write-1', name: 'execute_bash', arguments: { command: 'echo write' } }],
    },
    {
      text: 'Listo',
      toolCalls: [],
    },
  ]);

  const executionResult = await executeToolCallLoop(
    messages,
    TEST_TOOLS,
    [{
      name: 'execute_bash',
      description: 'Run a shell command',
      execute: async () => 'written',
    }],
    provider,
    { requiredToolNames: ['execute_bash'] },
    4,
  );

  assert.equal(executionResult.text, 'Listo');
  assert.equal(executionResult.toolCalls[0]?.name, 'execute_bash');
  assert.match(messages[1]?.content || '', /El PRD ya existe/);
  assert.match(messages[2]?.content || '', /tool obligatoria: execute_bash/);
});

test('submit_for_review usa bead snapshot del worktree si existe', async () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'rr-tool-calling-snapshot-'));
  const worktreePath = path.join(tmpDir, 'worktree');
  const sessionPath = path.join(worktreePath, '.ralphito-session.json');
  const snapshotPath = path.join(worktreePath, '.ralphito-bead-snapshot.md');

  try {
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(snapshotPath, ['# Snapshot bead', '', '## VERIFICATION_COMMAND', '`pwd`'].join('\n'), 'utf8');
    writeFileSync(
      sessionPath,
      `${JSON.stringify({
        beadPath: 'docs/specs/projects/missing-bead.md',
        beadSnapshotPath: snapshotPath,
      }, null, 2)}\n`,
      'utf8',
    );

    const messages: Message[] = [{ role: 'user', content: 'revísalo' }];
    const provider = createProvider([
      {
        text: '',
        toolCalls: [{ id: 'review-1', name: 'submit_for_review', arguments: {} }],
      },
      {
        text: 'done',
        toolCalls: [],
      },
    ]);
    const executionResult = await executeToolCallLoop(
      messages,
      [
        ...TEST_TOOLS,
        {
          name: 'submit_for_review',
          description: 'Run review verification',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      ],
      [{
        name: 'submit_for_review',
        description: 'Run review verification',
        execute: async () => 'unused',
      }],
      provider,
      { worktreePath },
      3,
    );

    assert.equal(executionResult.toolResults[0]?.ok, false);
    assert.doesNotMatch(executionResult.toolResults[0]?.content || '', /Bead file not found/);
    assert.match(executionResult.toolResults[0]?.content || '', /worktree/);
  } finally {
    rmSync(tmpDir, { force: true, recursive: true });
  }
});
