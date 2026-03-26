import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../../infrastructure/persistence/db/index.js';
import { getSessionChat } from './sessionChatService.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from './runtimeFiles.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const runtimeRoot = createTempDirectory('rr-session-chat-');

  process.env.RALPHITO_DB_PATH = path.join(runtimeRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
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
      rmSync(runtimeRoot, { force: true, recursive: true });
    });
}

test('getSessionChat resuelve beadId y title usando beadPath cuando runtime_session_id aun no estaba ligado', async () => {
  await withTempRuntime(async () => {
    const db = initializeRalphitoDatabase();
    const now = new Date().toISOString();
    const runtimeSessionId = 'be-session-chat';
    const worktreePath = createTempDirectory('rr-session-chat-worktree-');
    mkdirSync(worktreePath, { recursive: true });

    const originThreadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('telegram', 'chat-origin', 'Chat origen', now, now).lastInsertRowid,
    );

    const runtimeThreadId = Number(
      db
        .prepare(
          `
            INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run('runtime', runtimeSessionId, runtimeSessionId, now, now).lastInsertRowid,
    );

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
      'task-chat',
      'backend-team',
      'Prueba de Engine 02',
      path.join(process.cwd(), 'docs/specs/projects/test-engine/bead-02-fake-test.md'),
      null,
      'pending',
      null,
      null,
      'medium',
      now,
      now,
      null,
    );

    getRuntimeSessionRepository().create({
      threadId: runtimeThreadId,
      originThreadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      notificationChatId: 'chat-notify',
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/be-session-chat',
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: 123,
      prompt: 'Ejecuta el bead 02',
      beadPath: 'docs/specs/projects/test-engine/bead-02-fake-test.md',
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId,
      notificationChatId: 'chat-notify',
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const sessionChat = getSessionChat(runtimeSessionId);

    assert.equal(sessionChat.externalChatId, 'chat-notify');
    assert.equal(sessionChat.notificationChatId, 'chat-notify');
    assert.equal(sessionChat.beadId, 'task-chat');
    assert.equal(sessionChat.title, 'Prueba de Engine 02');
    assert.equal(sessionChat.worktreePath, worktreePath);
    assert.equal(sessionChat.branchName, 'jopen/be-session-chat');
    assert.equal(sessionChat.hasGuardrailError, false);

    rmSync(worktreePath, { force: true, recursive: true });
  });
});
