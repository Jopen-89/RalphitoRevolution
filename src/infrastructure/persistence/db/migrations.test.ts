import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ralphitoMigrations } from './migrations.js';

function createMigratedDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  for (const migration of ralphitoMigrations) {
    db.exec(migration.sql);
  }

  return db;
}

function createDatabaseUpToMigration(maxId: number) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  for (const migration of ralphitoMigrations.filter((item) => item.id <= maxId)) {
    db.exec(migration.sql);
  }

  return db;
}

function listTableColumns(db: Database.Database, tableName: string) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
}

function listIndexes(db: Database.Database, tableName: string) {
  return db
    .prepare(`PRAGMA index_list(${tableName})`)
    .all() as Array<{ name: string }>;
}

test('migration 19 creates projects table with Stage 1 columns', () => {
  const db = createMigratedDatabase();

  try {
    const columns = listTableColumns(db, 'projects');

    assert.deepEqual(
      columns.map((column) => column.name),
      [
        'project_id',
        'name',
        'kind',
        'repo_path',
        'worktree_root',
        'default_branch',
        'agent_rules_file',
        'is_active',
        'created_at',
        'updated_at',
      ],
    );
    assert.equal(columns.find((column) => column.name === 'is_active')?.dflt_value, '1');
  } finally {
    db.close();
  }
});

test('migration 19 extends tasks with project_id and bead_path plus indexes', () => {
  const db = createMigratedDatabase();

  try {
    const columns = listTableColumns(db, 'tasks');
    const indexes = listIndexes(db, 'tasks').map((index) => index.name);

    assert.ok(columns.some((column) => column.name === 'project_id'));
    assert.ok(columns.some((column) => column.name === 'bead_path'));
    assert.ok(indexes.includes('idx_tasks_project_id_status'));
    assert.ok(indexes.includes('idx_tasks_project_id_updated_at'));
    assert.ok(indexes.includes('idx_tasks_bead_path'));
  } finally {
    db.close();
  }
});

test('migration 19 backfills legacy tasks from project_key and source_spec_path', () => {
  const db = createDatabaseUpToMigration(18);

  try {
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
      'task-1',
      'Backend-Team',
      'Legacy task',
      '/tmp/specs/bead-1.md',
      null,
      'pending',
      null,
      null,
      'medium',
      '2026-03-26T00:00:00.000Z',
      '2026-03-26T00:00:00.000Z',
      null,
    );

    const migration = ralphitoMigrations.find((item) => item.id === 19);
    assert.ok(migration);
    db.exec(migration.sql);

    const row = db
      .prepare('SELECT project_id AS projectId, bead_path AS beadPath FROM tasks WHERE id = ?')
      .get('task-1') as { projectId: string; beadPath: string };

    assert.equal(row.projectId, 'backend-team');
    assert.equal(row.beadPath, '/tmp/specs/bead-1.md');
  } finally {
    db.close();
  }
});
