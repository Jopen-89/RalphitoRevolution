#!/usr/bin/env node

import { readFileSync } from 'fs';
import { getGuardrailLogPath, getManagedRuntimeWorktreePath } from '../src/features/engine/runtimeFiles.js';
import { getRalphitoDatabase, initializeRalphitoDatabase } from '../src/features/persistence/db/index.js';

interface SessionChatResult {
  externalChatId: string | null;
  beadId: string | null;
  title: string | null;
  hasGuardrailError: boolean;
  guardrailError: string | null;
}

function truncateError(errorText: string): string {
  const normalized = errorText.trim();
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 697)}...`;
}

function getGuardrailErrorForSession(sessionId: string): string | null {
  try {
    return truncateError(readFileSync(getGuardrailLogPath(getManagedRuntimeWorktreePath(sessionId)), 'utf8'));
  } catch {
    return null;
  }
}

function runGetSessionChat(sessionId: string) {
  initializeRalphitoDatabase();
  const db = getRalphitoDatabase();

  const thread = db
    .prepare(
      `
        SELECT threads.external_chat_id AS externalChatId
        FROM agent_sessions
        INNER JOIN threads ON threads.id = agent_sessions.thread_id
        WHERE agent_sessions.runtime_session_id = ?
        LIMIT 1
      `,
    )
    .get(sessionId) as { externalChatId: string } | undefined;

  const task = db
    .prepare(
      `
        SELECT id, title
        FROM tasks
        WHERE runtime_session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    )
    .get(sessionId) as { id: string; title: string } | undefined;

  const guardrailError = getGuardrailErrorForSession(sessionId);

  const result: SessionChatResult = {
    externalChatId: thread?.externalChatId ?? null,
    beadId: task?.id ?? null,
    title: task?.title ?? null,
    hasGuardrailError: guardrailError !== null,
    guardrailError,
  };

  console.log(JSON.stringify(result));
}

const command = process.argv[2] || 'migrate';

switch (command) {
  case 'migrate': {
    initializeRalphitoDatabase();
    const db = getRalphitoDatabase();
    const migrations = db
      .prepare('SELECT id, name, applied_at AS appliedAt FROM ralphito_migrations ORDER BY id ASC')
      .all() as Array<{ id: number; name: string; appliedAt: string }>;

    console.log('Ralphito SQLite ready. Applied migrations:');

    for (const migration of migrations) {
      console.log(`- ${migration.id}: ${migration.name} (${migration.appliedAt})`);
    }
    break;
  }
  case 'get-session-chat': {
    const sessionId = process.argv[3];
    if (!sessionId) {
      console.error('Usage: ralphito-db.ts get-session-chat <sessionId>');
      process.exit(1);
    }
    runGetSessionChat(sessionId);
    break;
  }
  case 'query': {
    initializeRalphitoDatabase();
    const db = getRalphitoDatabase();
    const sql = process.argv[3];
    if (!sql) {
      console.error('Usage: ralphito-db.ts query "<SQL>"');
      process.exit(1);
    }
    try {
      const result = db.prepare(sql).run();
      console.log(JSON.stringify({ changes: result.changes, lastInsertRowid: result.lastInsertRowid }));
    } catch (err) {
      console.error('SQL error:', (err as Error).message);
      process.exit(1);
    }
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
