import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';
import {
  enqueueEngineNotification,
  getEngineNotificationRepository,
  resetEngineNotificationRepository,
} from '../services/EventBus.js';
import {
  EngineNotificationDispatcher,
  formatEngineNotificationMessage,
} from '../../interfaces/telegram/engineNotificationDispatcher.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (repoRoot: string) => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousAllowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const previousDisableKick = process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
  const repoRoot = createTempDirectory('rr-engine-phase5-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.TELEGRAM_ALLOWED_CHAT_ID = 'ops-chat';
  process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = '1';
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
      if (previousDisableKick) {
        process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = previousDisableKick;
      } else {
        delete process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
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

test('EngineNotificationRepository resume outbox state para status', async () => {
  await withTempRuntime(async () => {
    enqueueEngineNotification({
      eventType: 'session.started',
      targetChatId: 'chat-1',
      payload: {
        projectId: 'backend-team',
        branchName: 'jopen/demo',
        beadPath: null,
        workItemKey: null,
      },
    });

    enqueueEngineNotification({
      eventType: 'session.spawn_failed',
      payload: {
        projectId: 'backend-team',
        branchName: 'jopen/demo',
        beadPath: null,
        workItemKey: null,
        error: 'boom',
      },
    });

    const repository = getEngineNotificationRepository();
    const [first, second] = repository.listRecent(10).reverse();

    assert.equal(first?.status, 'pending');
    assert.equal(second?.status, 'pending');

    repository.markDelivered(first!.eventId);
    repository.markFailed({
      eventId: second!.eventId,
      attemptCount: 1,
      errorMessage: 'No target chat id for engine notification',
      terminal: true,
    });

    const summary = repository.getSummary();

    assert.equal(summary.total, 2);
    assert.equal(summary.pending, 0);
    assert.equal(summary.delivered, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.pendingWithoutTarget, 0);
    assert.ok(summary.newestCreatedAt);
  });
});

test('formatEngineNotificationMessage cubre suspended_human_input', () => {
  const message = formatEngineNotificationMessage({
    eventId: 'evt-1',
    runtimeSessionId: 'rt-1',
    eventType: 'session.suspended_human_input',
    payload: {
      kind: 'credential_required',
      summary: 'Credential required: token for opencode',
      prompt: 'Paste token:',
      hint: 'Set OPENCODE_TOKEN',
    },
    targetChatId: 'chat-1',
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    errorMessage: null,
  });

  assert.match(message, /sesion pausada por input humano/i);
  assert.match(message, /credential_required/i);
  assert.match(message, /Paste token:/);
});
