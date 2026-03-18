#!/usr/bin/env node

import { getRalphitoDatabase, initializeRalphitoDatabase } from '../src/features/persistence/db/index.js';

const command = process.argv[2] || 'migrate';

function runMigrate() {
  initializeRalphitoDatabase();
  const db = getRalphitoDatabase();
  const migrations = db
    .prepare('SELECT id, name, applied_at AS appliedAt FROM ralphito_migrations ORDER BY id ASC')
    .all() as Array<{ id: number; name: string; appliedAt: string }>;

  console.log('Ralphito SQLite ready. Applied migrations:');

  for (const migration of migrations) {
    console.log(`- ${migration.id}: ${migration.name} (${migration.appliedAt})`);
  }
}

switch (command) {
  case 'migrate':
    runMigrate();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
