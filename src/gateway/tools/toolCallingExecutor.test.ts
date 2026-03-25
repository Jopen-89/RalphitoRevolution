import assert from 'node:assert/strict';
import test from 'node:test';
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
      4,
    ),
    /Detected repeated tool loop: execute_bash\(\{"command":"git status"\}\)/,
  );

  assert.equal(executionCount, 1);
});
