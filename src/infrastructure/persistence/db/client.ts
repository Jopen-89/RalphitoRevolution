import Database from 'better-sqlite3';
import os from 'os';
import { mkdirSync } from 'fs';
import path from 'path';
import { DEFAULT_RALPHITO_HOME_DIRNAME, ENGINE_WORKTREE_ROOT } from '../../../core/domain/constants.js';
import { ralphitoMigrations } from './migrations.js';

type RalphitoDatabase = InstanceType<typeof Database>;

const DEFAULT_DB_PATH = path.join(process.cwd(), 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');

let database: RalphitoDatabase | null = null;

interface AppliedMigrationRow {
  id: number;
}

function getDatabasePath() {
  return process.env.RALPHITO_DB_PATH || DEFAULT_DB_PATH;
}

function resolveRepoRoot() {
  const configured = process.env.RALPHITO_REPO_ROOT?.trim();
  return path.resolve(configured || process.cwd());
}

function resolveRalphitoHomeRoot() {
  const configured = process.env.RALPHITO_HOME?.trim();
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), DEFAULT_RALPHITO_HOME_DIRNAME);
}

function resolveWorktreeRoot() {
  const configured = process.env.RALPHITO_WORKTREE_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveRalphitoHomeRoot(), ENGINE_WORKTREE_ROOT);
}

function resolveDefaultBranch() {
  return process.env.RALPHITO_DEFAULT_BRANCH?.trim() || 'master';
}

export function getRalphitoDatabasePath() {
  return getDatabasePath();
}

function ensureDatabaseDirectory(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

function applyPragmas(db: RalphitoDatabase) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function ensureMigrationTable(db: RalphitoDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ralphito_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function runMigrations(db: RalphitoDatabase) {
  ensureMigrationTable(db);

  const appliedMigrationIds = new Set<number>(
    db
      .prepare('SELECT id FROM ralphito_migrations ORDER BY id ASC')
      .all() 
      .map((row) => (row as AppliedMigrationRow).id),
  );

  const insertMigration = db.prepare(
    'INSERT INTO ralphito_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of ralphitoMigrations) {
    if (appliedMigrationIds.has(migration.id)) continue;

    const now = new Date().toISOString();
    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.id, migration.name, now);
    });

    applyMigration();
  }
}

function seedSystemProject(db: RalphitoDatabase) {
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO projects (
        project_id,
        name,
        kind,
        repo_path,
        worktree_root,
        default_branch,
        agent_rules_file,
        is_active,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(project_id)
      DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        repo_path = excluded.repo_path,
        worktree_root = excluded.worktree_root,
        default_branch = excluded.default_branch,
        agent_rules_file = excluded.agent_rules_file,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `,
  ).run(
    'system',
    'Ralphito System',
    'system',
    resolveRepoRoot(),
    resolveWorktreeRoot(),
    resolveDefaultBranch(),
    'AGENTS.md',
    now,
    now,
  );
}

export function initializeRalphitoDatabase(): RalphitoDatabase {
  if (database) return database;

  const databasePath = getDatabasePath();
  ensureDatabaseDirectory(databasePath);

  const db = new Database(databasePath);
  applyPragmas(db);
  runMigrations(db);
  seedSystemProject(db);

  database = db;

  return db;
}

export function getRalphitoDatabase(): RalphitoDatabase {
  return database ?? initializeRalphitoDatabase();
}

export function closeRalphitoDatabase() {
  if (!database) return;

  database.close();
  database = null;
}
