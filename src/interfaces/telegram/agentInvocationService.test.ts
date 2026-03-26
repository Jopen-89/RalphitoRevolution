import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentInfo } from './agentRegistry.js';
import { invokeAgentInChatThread } from './agentInvocationService.js';
import { getConversationSessionId, getRecentActiveAgent, getRecentChatHistory } from './conversationStore.js';
import { resetSessionRepository } from './persistence/sessionRepository.js';
import { resetTelegramStateRepository } from './telegramStateRepository.js';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-agent-invocation-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetSessionRepository();
  resetTelegramStateRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetSessionRepository();
      resetTelegramStateRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

const PONCHO: AgentInfo = {
  id: 'poncho',
  name: 'Poncho',
  role: 'Technical Architect',
  rolePath: 'roles/TechnicalArchitect(Poncho).md',
  aliases: ['poncho'],
};

test('invokeAgentInChatThread persists initiator history, session and reply publication', async () => {
  await withTempDb(async () => {
    let published: { chatId: string; messageId: number; agentId: string; response: string } | null = null;

    const result = await invokeAgentInChatThread(
      {
        chatId: '12345',
        agent: PONCHO,
        instruction: 'Revisa la arquitectura',
        statusMessageId: 77,
        initiator: {
          id: 'raymon',
          name: 'Raymon',
        },
      },
      {
        executeAgentTask: async () => ({
          response: 'Arquitectura revisada',
          sessionId: 'session-123',
          handoffAgentId: 'poncho',
        }),
        publishAgentReply: async (chatId, messageId, agent, response) => {
          published = { chatId, messageId, agentId: agent.id, response };
        },
      },
    );

    assert.equal(result.response, 'Arquitectura revisada');
    assert.equal(result.sessionId, 'session-123');
    assert.equal(result.handoffAgentId, 'poncho');
    assert.equal(getConversationSessionId('12345', 'poncho'), 'session-123');
    assert.equal(getRecentActiveAgent('12345', 60_000), 'poncho');
    assert.match(getRecentChatHistory('12345'), /Raymon: Revisa la arquitectura/);
    assert.deepEqual(published, {
      chatId: '12345',
      messageId: 77,
      agentId: 'poncho',
      response: 'Arquitectura revisada',
    });
  });
});

test('invokeAgentInChatThread does not inject initiator history when absent', async () => {
  await withTempDb(async () => {
    let published = false;

    await invokeAgentInChatThread(
      {
        chatId: '987',
        agent: PONCHO,
        instruction: 'Seguimos',
        statusMessageId: 11,
      },
      {
        executeAgentTask: async () => ({ response: 'OK' }),
        publishAgentReply: async () => {
          published = true;
        },
      },
    );

    assert.equal(published, true);
  });
});

test('invokeAgentInChatThread sanitizes model output before publishing', async () => {
  await withTempDb(async () => {
    let publishedResponse = '';

    const result = await invokeAgentInChatThread(
      {
        chatId: '555',
        agent: PONCHO,
        instruction: 'Seguimos',
        statusMessageId: 22,
      },
      {
        executeAgentTask: async () => ({
          response: 'hola\n<system-reminder>secret</system-reminder>\nadios',
        }),
        publishAgentReply: async (_chatId, _messageId, _agent, response) => {
          publishedResponse = response;
        },
      },
    );

    assert.equal(result.response, 'hola\n\nadios');
    assert.equal(publishedResponse, 'hola\n\nadios');
  });
});
