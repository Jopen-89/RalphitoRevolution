import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../persistence/db/index.js';
import {
  enqueueEngineNotification,
  getEngineNotificationRepository,
  resetEngineNotificationRepository,
} from './engineNotifications.js';
import { EngineNotificationDispatcher } from '../telegram/engineNotificationDispatcher.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (repoRoot: string) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousAllowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const repoRoot = createTempDirectory('rr-engine-phase5-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.TELEGRAM_ALLOWED_CHAT_ID = 'ops-chat';
  closeRalphitoDatabase();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn(repoRoot))
    .finally(() => {
      closeRalphitoDatabase();
      resetEngineNotificationRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      if (previousAllowedChatId) {
        process.env.TELEGRAM_ALLOWED_CHAT_ID = previousAllowedChatId;
      } else {
        delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
      }
      process.chdir(previousCwd);
      rmSync(repoRoot, { force: true, recursive: true });
    });
}

test('EngineNotificationDispatcher entrega pending y marca delivered', async () => {
  await withTempRuntime(async () => {
    const sent: Array<{ chatId: string; text: string }> = [];

    enqueueEngineNotification({
      eventType: 'session.synced',
      targetChatId: 'chat-123',
      payload: {
        beadId: 'bead-7',
        title: 'Cerrar zero-touch',
        branchName: 'jopen/zero-touch-phase1-2',
        prUrl: '',
      },
    });

    const dispatcher = new EngineNotificationDispatcher(
      getEngineNotificationRepository(),
      async (chatId, text) => {
        sent.push({ chatId, text });
        return { success: true, chatId, text, messageId: 1 };
      },
      1,
    );

    await dispatcher.pollOnce();

    const notification = getEngineNotificationRepository().listAll()[0];
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.chatId, 'chat-123');
    assert.match(sent[0]?.text || '', /aterrizado en rama\/PR/i);
    assert.equal(notification?.status, 'delivered');
    assert.equal(notification?.attemptCount, 0);
  });
});

test('EngineNotificationDispatcher reintenta y deja failed terminal al agotar intentos', async () => {
  await withTempRuntime(async () => {
    enqueueEngineNotification({
      eventType: 'session.guardrail_failed',
      targetChatId: 'chat-999',
      payload: {
        guardrail: 'TypeScript',
        beadId: 'bead-9',
        title: 'Rompio tsc',
        summary: 'tsc fallo',
        snippet: 'error TS1005',
      },
    });

    const dispatcher = new EngineNotificationDispatcher(
      getEngineNotificationRepository(),
      async () => {
        throw new Error('telegram down');
      },
      1,
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const notification = getEngineNotificationRepository().listAll()[0];
      if (!notification) break;
      await dispatcher.pollOnce();
      if (attempt < 4) {
        initializeRalphitoDatabase()
          .prepare('UPDATE engine_notifications SET next_attempt_at = ? WHERE event_id = ?')
          .run(new Date().toISOString(), notification.eventId);
      }
    }

    const notification = getEngineNotificationRepository().listAll()[0];
    assert.equal(notification?.status, 'failed');
    assert.equal(notification?.attemptCount, 5);
    assert.match(notification?.errorMessage || '', /telegram down/);
  });
});
