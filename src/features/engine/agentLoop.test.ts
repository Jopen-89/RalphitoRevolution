import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../persistence/db/index.js';
import { resetRuntimeSessionRepository } from './runtimeSessionRepository.js';
import {
  agentLoop,
  buildGatewayChatRequest,
  loadBeadFromInstruction,
  buildInitialMessages,
  hasFinishIndicator,
  hasToolInvocationLeak,
  MAX_ITERATIONS,
} from './agentLoop.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withTempRuntime<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const repoRoot = createTempDirectory('rr-agentloop-runtime-');

  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRuntimeSessionRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      rmSync(repoRoot, { force: true, recursive: true });
    });
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

test('hasToolInvocationLeak detects markdown shell blocks and textual tool calls', () => {
  assert.equal(hasToolInvocationLeak('```bash\nnpm test\n```'), true);
  assert.equal(hasToolInvocationLeak('```sh\necho hola\n```'), true);
  assert.equal(hasToolInvocationLeak('Use execute_bash("npm test") next'), true);
  assert.equal(hasToolInvocationLeak('I will inspect the file first.'), false);
  assert.equal(hasToolInvocationLeak('Tool usage should be direct, not described.'), false);
});

test('buildGatewayChatRequest forwards explicit provider and model', () => {
  const request = buildGatewayChatRequest(
    { provider: 'gemini', model: 'gemini-2.5-pro' },
    [{ role: 'user', content: 'Implement the fix' }],
  );

  assert.equal(request.agentId, 'ralphito');
  assert.equal(request.provider, 'gemini');
  assert.equal(request.model, 'gemini-2.5-pro');
  assert.equal(request.messages[0]?.content, 'Implement the fix');
});

test('MAX_ITERATIONS is 120', () => {
  assert.equal(MAX_ITERATIONS, 120);
});

test('agentLoop reprompts markdown tool leakage and recovers on real tool call', async () => {
  await withTempRuntime(async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let callCount = 0;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> });
      callCount++;

      if (callCount === 1) {
        return createJsonResponse({
          response: '```bash\npwd\n```',
        });
      }

      if (callCount === 2) {
        return createJsonResponse({
          toolCalls: [{ id: 'finish-1', name: 'finish_task', arguments: {} }],
          toolResults: [{ toolCallId: 'finish-1', content: '{"success":true,"message":"ok"}', ok: true }],
        });
      }

      throw new Error(`Unexpected fetch call ${callCount}`);
    }) as typeof fetch;

    try {
      const result = await agentLoop({
        runtimeSessionId: 'session-tool-leak',
        worktreePath: '/tmp/worktree',
        systemPrompt: 'Test system prompt',
        instruction: 'Implement the fix',
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.iterations, 2);
      assert.equal(requests.length, 2);
      assert.equal(requests[1]?.messages.at(-1)?.role, 'user');
      assert.match(
        requests[1]?.messages.at(-1)?.content || '',
        /You provided shell commands or textual tool usage/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('agentLoop reprompts finish-only text without using tool leakage message', async () => {
  await withTempRuntime(async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    let callCount = 0;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> });
      callCount++;

      if (callCount === 1) {
        return createJsonResponse({
          response: 'Task complete. Wrapping up.',
        });
      }

      if (callCount === 2) {
        return createJsonResponse({
          toolCalls: [{ id: 'finish-2', name: 'finish_task', arguments: {} }],
          toolResults: [{ toolCallId: 'finish-2', content: '{"success":true,"message":"ok"}', ok: true }],
        });
      }

      throw new Error(`Unexpected fetch call ${callCount}`);
    }) as typeof fetch;

    try {
      const result = await agentLoop({
        runtimeSessionId: 'session-finish-only',
        worktreePath: '/tmp/worktree',
        systemPrompt: 'Test system prompt',
        instruction: 'Implement the fix',
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.iterations, 2);
      assert.equal(requests.length, 2);
      assert.equal(requests[1]?.messages.at(-1)?.role, 'user');
      assert.match(
        requests[1]?.messages.at(-1)?.content || '',
        /You must explicitly use the finish_task tool or execute \.\/scripts\/bd\.sh sync/i,
      );
      assert.doesNotMatch(
        requests[1]?.messages.at(-1)?.content || '',
        /textual tool usage/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('agentLoop preserves tool name and structured payload for next gateway turn', async () => {
  await withTempRuntime(async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ messages: Array<{ role: string; content: string; name?: string; toolResult?: unknown }> }> = [];
    let callCount = 0;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string; name?: string; toolResult?: unknown }> });
      callCount++;

      if (callCount === 1) {
        return createJsonResponse({
          toolCalls: [{ id: 'read-1', name: 'read_file_raw', arguments: { path: 'package.json' } }],
          toolResults: [{
            toolCallId: 'read-1',
            content: '{"content":"{}","bytesRead":2}',
            ok: true,
            payload: {
              output: {
                content: '{}',
                bytesRead: 2,
              },
            },
          }],
        });
      }

      if (callCount === 2) {
        return createJsonResponse({
          toolCalls: [{ id: 'finish-3', name: 'finish_task', arguments: {} }],
          toolResults: [{ toolCallId: 'finish-3', content: '{"success":true,"message":"ok"}', ok: true }],
        });
      }

      throw new Error(`Unexpected fetch call ${callCount}`);
    }) as typeof fetch;

    try {
      const result = await agentLoop({
        runtimeSessionId: 'session-tool-payload',
        worktreePath: '/tmp/worktree',
        systemPrompt: 'Test system prompt',
        instruction: 'Inspect package.json and finish',
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.iterations, 2);
      const secondRequestToolMessage = requests[1]?.messages.find((message) => message.role === 'tool');
      assert.equal(secondRequestToolMessage?.name, 'read_file_raw');
      assert.deepEqual(secondRequestToolMessage?.toolResult, {
        output: {
          content: '{}',
          bytesRead: 2,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});