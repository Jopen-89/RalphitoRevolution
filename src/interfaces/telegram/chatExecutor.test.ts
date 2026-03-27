import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentInfo } from './agentRegistry.js';
import { executeAgentTask } from './chatExecutor.js';
import { setConversationSessionId, getConversationSessionContext } from './conversationStore.js';
import { resetSessionRepository } from './persistence/sessionRepository.js';
import { resetTelegramStateRepository } from './telegramStateRepository.js';
import { closeRalphitoDatabase, initializeRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { tmpDir: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousGatewayUrl = process.env.RALPHITO_GATEWAY_URL;
  const previousWorktreePath = process.env.RALPHITO_WORKTREE_PATH;
  const tmpDir = createTempDirectory('rr-chat-executor-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  process.env.RALPHITO_GATEWAY_URL = 'http://127.0.0.1:4010/v1/chat';
  delete process.env.RALPHITO_WORKTREE_PATH;
  closeRalphitoDatabase();
  resetSessionRepository();
  resetTelegramStateRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ tmpDir }))
    .finally(() => {
      closeRalphitoDatabase();
      resetSessionRepository();
      resetTelegramStateRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousGatewayUrl) process.env.RALPHITO_GATEWAY_URL = previousGatewayUrl;
      else delete process.env.RALPHITO_GATEWAY_URL;
      if (previousWorktreePath) process.env.RALPHITO_WORKTREE_PATH = previousWorktreePath;
      else delete process.env.RALPHITO_WORKTREE_PATH;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('executeAgentTask reuses persisted worktree context in gateway requests', async () => {
  await withTempDb(async ({ tmpDir }) => {
    const rolePath = path.join(tmpDir, 'Poncho.md');
    writeFileSync(rolePath, '# Rol\n', 'utf8');

    const agent: AgentInfo = {
      id: 'poncho',
      name: 'Poncho',
      role: 'Technical Architect',
      rolePath,
      aliases: ['poncho'],
    };

    const persistedWorktreePath = path.join(tmpDir, 'worktrees', 'runtime-123');
    let receivedHeader = '';
    let receivedSessionId = '';
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      receivedHeader = String((init?.headers as Record<string, string>)['x-ralphito-worktree-path'] || '');
      const body = JSON.parse(String(init?.body || '{}')) as { sessionId?: string };
      receivedSessionId = body.sessionId || '';

      return {
        ok: true,
        async json() {
          return {
            response: 'Listo',
            providerUsed: 'opencode',
            modelUsed: 'minimax-m2.7',
            sessionId: 'runtime-123',
          };
        },
      } as Response;
    }) as typeof fetch;

    try {
      setConversationSessionId('chat-1', 'poncho', {
        sessionId: 'runtime-123',
        baseCommitHash: 'abc123',
        worktreePath: persistedWorktreePath,
      });

      const result = await executeAgentTask('chat-1', agent, 'Revisa esto');

      assert.equal(result.response, 'Listo');
      assert.equal(receivedHeader, persistedWorktreePath);
      assert.equal(receivedSessionId, 'runtime-123');
      assert.deepEqual(getConversationSessionContext('chat-1', 'poncho'), {
        runtimeSessionId: 'runtime-123',
        baseCommitHash: 'abc123',
        worktreePath: persistedWorktreePath,
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test('executeAgentTask ignora RALPHITO_WORKTREE_PATH si no hay sesion persistida', async () => {
  await withTempDb(async ({ tmpDir }) => {
    const rolePath = path.join(tmpDir, 'Moncho.md');
    writeFileSync(rolePath, '# Rol\n', 'utf8');

    const agent: AgentInfo = {
      id: 'moncho',
      name: 'Moncho',
      role: 'Feature PM',
      rolePath,
      aliases: ['moncho'],
    };

    process.env.RALPHITO_WORKTREE_PATH = path.join(tmpDir, 'ambient-worktree');

    let receivedHeader = 'missing';
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      receivedHeader = String((init?.headers as Record<string, string>)['x-ralphito-worktree-path'] || '');

      return {
        ok: true,
        async json() {
          return {
            response: 'Listo',
            providerUsed: 'gemini',
            modelUsed: 'gemini-3.1-pro-preview',
          };
        },
      } as Response;
    }) as typeof fetch;

    try {
      const result = await executeAgentTask('chat-1', agent, 'Guarda el PRD');

      assert.equal(result.response, 'Listo');
      assert.equal(receivedHeader, '');
      assert.equal(getConversationSessionContext('chat-1', 'moncho'), null);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
