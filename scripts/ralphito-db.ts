#!/usr/bin/env node

import { getSessionChat } from '../src/features/engine/sessionChatService.js';
import { getRalphitoDatabase, initializeRalphitoDatabase } from '../src/features/persistence/db/index.js';

function runGetSessionChat(sessionId: string) {
  initializeRalphitoDatabase();
  console.log(JSON.stringify(getSessionChat(sessionId)));
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
