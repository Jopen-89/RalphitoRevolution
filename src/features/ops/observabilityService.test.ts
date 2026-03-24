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
} from '../engine/engineNotifications.js';
import {
  getRuntimeSessionRepository,
  resetRuntimeSessionRepository,
} from '../engine/runtimeSessionRepository.js';
import { getOperationalStatus } from './observabilityService.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: () => Promise<T> | T) {
  const previousCwd = process.cwd();
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousDisableKick = process.env.RALPHITO_DISABLE_NOTIFICATION_KICK;
  const repoRoot = createTempDirectory('rr-ops-status-');

  process.chdir(repoRoot);
  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_DISABLE_NOTIFICATION_KICK = '1';
  closeRalphitoDatabase();
  resetRuntimeSessionRepository();
  resetEngineNotificationRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRuntimeSessionRepository();
      resetEngineNotificationRepository();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
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

function insertThread(runtimeSessionId: string, createdAt: string) {
  const db = initializeRalphitoDatabase();
  return Number(
    db
      .prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run('runtime', runtimeSessionId, runtimeSessionId, createdAt, createdAt).lastInsertRowid,
  );
}

test('getOperationalStatus separa salud viva del historico y deuda operativa', async () => {
  await withTempRuntime(async () => {
    const db = initializeRalphitoDatabase();
    const repository = getRuntimeSessionRepository();

    repository.create({
      threadId: insertThread('be-orphan', '2026-03-24T10:00:00.000Z'),
      agentId: 'backend-team',
      runtimeSessionId: 'be-orphan',
      status: 'running',
      startedAt: '2026-03-24T10:00:00.000Z',
      heartbeatAt: '2026-03-24T10:05:00.000Z',
      createdAt: '2026-03-24T10:00:00.000Z',
      updatedAt: '2026-03-24T10:05:00.000Z',
    });

    db.prepare(
      `
        INSERT INTO tasks (
          id,
          project_key,
          title,
          source_spec_path,
          component_path,
          status,
          assigned_agent,
          runtime_session_id,
          priority,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'task-stale',
      'backend',
      'Task vieja',
      null,
      'src/features/ops',
      'pending',
      'backend-team',
      'be-orphan',
      'high',
      '2026-03-23T00:00:00.000Z',
      '2026-03-23T00:00:00.000Z',
      null,
    );

    db.prepare(
      `
        INSERT INTO session_summaries (scope_type, scope_id, summary, created_at)
        VALUES (?, ?, ?, ?)
      `,
    ).run('thread', 'be-orphan', 'Resumen ops', '2026-03-24T10:06:00.000Z');

    db.prepare(
      `
        INSERT INTO system_events (event_type, status, payload_json, created_at)
        VALUES (?, ?, ?, ?), (?, ?, ?, ?)
      `,
    ).run(
      'search_query',
      'error',
      JSON.stringify({ reason: 'fts down' }),
      '2026-03-24T10:07:00.000Z',
      'context_loader',
      'ok',
      JSON.stringify({ durationMs: 20, snippetCount: 2 }),
      '2026-03-24T10:08:00.000Z',
    );

    enqueueEngineNotification({
      eventType: 'session.started',
      targetChatId: 'chat-1',
      payload: {
        projectId: 'backend-team',
        branchName: 'jopen/demo',
        beadPath: null,
        workItemKey: 'ops-f2',
      },
      createdAt: '2026-03-24T10:09:00.000Z',
      nextAttemptAt: '2026-03-24T10:09:00.000Z',
    });

    enqueueEngineNotification({
      eventType: 'session.synced',
      targetChatId: 'chat-1',
      payload: {
        beadId: 'bead-1',
        title: 'Aterrizar ops status',
        branchName: 'jopen/demo',
        prUrl: 'https://example.test/pr/1',
      },
      createdAt: '2026-03-24T10:10:00.000Z',
      nextAttemptAt: '2026-03-24T10:10:00.000Z',
    });

    enqueueEngineNotification({
      eventType: 'session.spawn_failed',
      payload: {
        projectId: 'backend-team',
        branchName: 'jopen/demo',
        beadPath: null,
        workItemKey: 'ops-f2',
        error: 'boom',
      },
      createdAt: '2026-03-24T10:11:00.000Z',
      nextAttemptAt: '2026-03-24T10:11:00.000Z',
    });

    const notificationRepository = getEngineNotificationRepository();
    const notifications = notificationRepository.listRecent(10);
    const delivered = notifications.find((notification) => notification.eventType === 'session.synced');
    const failed = notifications.find((notification) => notification.eventType === 'session.spawn_failed');

    assert.ok(delivered);
    assert.ok(failed);

    notificationRepository.markDelivered(delivered.eventId, '2026-03-24T10:12:00.000Z');
    notificationRepository.markFailed({
      eventId: failed.eventId,
      attemptCount: 1,
      errorMessage: 'No target chat id',
      terminal: true,
      failedAt: '2026-03-24T10:13:00.000Z',
    });

    const status = await getOperationalStatus();

    assert.equal(status.health.db.ok, true);
    assert.equal(status.health.engine.ok, true);
    assert.equal(status.health.searchIndex.ok, true);

    assert.equal(status.current.sessions?.totalRecent, 1);
    assert.equal(status.current.sessions?.active, 1);
    assert.equal(status.current.sessions?.alive, 0);
    assert.equal(status.current.sessions?.byStatus.running, 1);
    assert.equal(status.current.sessions?.byStatus.failed, 0);

    assert.equal(status.current.notificationBacklog?.pending, 1);
    assert.equal(status.current.notificationBacklog?.delivering, 0);
    assert.equal(status.current.notificationBacklog?.pendingWithoutTarget, 0);

    assert.equal(status.historical.retrieval?.failedQueries, 1);
    assert.equal(status.historical.retrieval?.averageRetrievalMs, 20);
    assert.equal(status.historical.counters?.summaries, 1);

    assert.equal(status.historical.debt.orphanSessions, 1);
    assert.equal(status.historical.debt.stuckTaskCount, 1);
    assert.equal(status.historical.debt.stuckTasks[0]?.id, 'task-stale');
    assert.equal(status.historical.debt.notificationOutbox?.total, 3);
    assert.equal(status.historical.debt.notificationOutbox?.delivered, 1);
    assert.equal(status.historical.debt.notificationOutbox?.failed, 1);
    assert.equal(status.historical.recentEvents[0]?.eventType, 'context_loader');
    assert.equal(status.historical.recentEvents[1]?.eventType, 'search_query');
  });
});
