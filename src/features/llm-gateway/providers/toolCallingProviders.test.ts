import assert from 'node:assert/strict';
import test from 'node:test';
import type { OAuth2Client } from 'google-auth-library';
import type { ToolDefinition } from '../interfaces/gateway.types.js';
import { GeminiProvider } from './gemini.js';
import { OpencodeProvider } from './opencode.js';

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

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('GeminiProvider incluye toolConfig AUTO cuando hay tools', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return createJsonResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
  }) as typeof fetch;

  try {
    const authClient = {
      getAccessToken: async () => ({ token: 'test-token' }),
    } as unknown as OAuth2Client;
    const provider = new GeminiProvider(authClient, 'gemini-3.1-pro-preview');

    const result = await provider.generateResponseWithTools(
      [{ role: 'user', content: 'hola' }],
      TEST_TOOLS,
    );

    assert.equal(result.text, 'ok');
    assert.ok(requestBody);
    assert.deepEqual(requestBody.toolConfig, {
      functionCallingConfig: {
        mode: 'AUTO',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GeminiProvider reinyecta functionResponse estructurado para tool results', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return createJsonResponse({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
  }) as typeof fetch;

  try {
    const authClient = {
      getAccessToken: async () => ({ token: 'test-token' }),
    } as unknown as OAuth2Client;
    const provider = new GeminiProvider(authClient, 'gemini-3.1-pro-preview');

    const result = await provider.generateResponseWithTools(
      [
        { role: 'user', content: 'lee package.json' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'read-1', name: 'read_file_raw', arguments: { path: 'package.json' } }],
        },
        {
          role: 'tool',
          toolCallId: 'read-1',
          name: 'read_file_raw',
          content: '{"content":"{}","bytesRead":2}',
          toolResult: {
            output: {
              content: '{}',
              bytesRead: 2,
            },
          },
        },
      ],
      TEST_TOOLS,
    );

    assert.equal(result.text, 'ok');
    assert.ok(requestBody);
    const contents = requestBody.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    const functionResponse = contents.at(-1)?.parts.at(-1)?.functionResponse as Record<string, unknown> | undefined;
    assert.deepEqual(functionResponse, {
      id: 'read-1',
      name: 'read_file_raw',
      response: {
        output: {
          content: '{}',
          bytesRead: 2,
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpencodeProvider incluye tool_choice auto cuando hay tools', async () => {
  const originalFetch = globalThis.fetch;
  const previousBaseUrl = process.env.MINIMAX_BASE_URL;
  let requestBody: Record<string, unknown> | undefined;

  process.env.MINIMAX_BASE_URL = 'https://minimax.test';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return createJsonResponse({
      content: [{ type: 'text', text: 'ok' }],
    });
  }) as typeof fetch;

  try {
    const provider = new OpencodeProvider('test-key', 'minimax-m2.7');
    const result = await provider.generateResponseWithTools(
      [{ role: 'user', content: 'hola' }],
      TEST_TOOLS,
    );

    assert.equal(result.text, 'ok');
    assert.ok(requestBody);
    assert.deepEqual(requestBody.tool_choice, {
      type: 'auto',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) {
      delete process.env.MINIMAX_BASE_URL;
    } else {
      process.env.MINIMAX_BASE_URL = previousBaseUrl;
    }
  }
});
