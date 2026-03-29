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

test('migration 25 keeps execution queue columns y añade review schema', () => {
  const db = createMigratedDatabase();

  try {
    const taskColumns = listTableColumns(db, 'tasks').map((column) => column.name);
    const jobColumns = listTableColumns(db, 'execution_jobs').map((column) => column.name);
    const resultColumns = listTableColumns(db, 'execution_results').map((column) => column.name);
    const reviewColumns = listTableColumns(db, 'execution_reviews').map((column) => column.name);
    const taskIndexes = listIndexes(db, 'tasks').map((index) => index.name);
    const jobIndexes = listIndexes(db, 'execution_jobs').map((index) => index.name);
    const resultIndexes = listIndexes(db, 'execution_results').map((index) => index.name);
    const reviewIndexes = listIndexes(db, 'execution_reviews').map((index) => index.name);

    assert.ok(taskColumns.includes('parent_task_id'));
    assert.ok(taskIndexes.includes('idx_tasks_parent_task_id'));
    assert.ok(jobColumns.includes('task_id'));
    assert.ok(jobColumns.includes('execution_harness'));
    assert.ok(jobColumns.includes('runtime_session_id'));
    assert.ok(jobColumns.includes('claim_token'));
    assert.ok(jobColumns.includes('attempt_count'));
    assert.ok(jobColumns.includes('next_attempt_at'));
    assert.ok(jobColumns.includes('last_error_code'));
    assert.ok(jobColumns.includes('agent_config_id'));
    assert.ok(jobColumns.includes('tool_calling_mode'));
    assert.ok(jobColumns.includes('allowed_tools_json'));
    assert.ok(jobColumns.includes('fallbacks_json'));
    assert.ok(resultColumns.includes('execution_job_id'));
    assert.ok(resultColumns.includes('payload_json'));
    assert.ok(reviewColumns.includes('execution_job_id'));
    assert.ok(reviewColumns.includes('reviewer_agent_id'));
    assert.ok(reviewColumns.includes('input_json'));
    assert.ok(reviewColumns.includes('findings_json'));
    assert.ok(reviewColumns.includes('rework_task_id'));
    assert.ok(reviewColumns.includes('claim_token'));
    assert.ok(reviewColumns.includes('attempt_count'));
    assert.ok(jobIndexes.includes('idx_execution_jobs_task_created_at'));
    assert.ok(jobIndexes.includes('idx_execution_jobs_runtime_session_id'));
    assert.ok(jobIndexes.includes('idx_execution_jobs_status_next_attempt_at'));
    assert.ok(jobIndexes.includes('idx_execution_jobs_claim_expires_at'));
    assert.ok(jobIndexes.includes('idx_execution_jobs_task_active'));
    assert.ok(resultIndexes.includes('idx_execution_results_task_created_at'));
    assert.ok(resultIndexes.includes('idx_execution_results_runtime_session_id'));
    assert.ok(reviewIndexes.includes('idx_execution_reviews_task_created_at'));
    assert.ok(reviewIndexes.includes('idx_execution_reviews_status_next_attempt_at'));
    assert.ok(reviewIndexes.includes('idx_execution_reviews_claim_expires_at'));
  } finally {
    db.close();
  }
});

test('migration 23 backfills queue defaults y normaliza cancelled -> failed', () => {
  const db = createDatabaseUpToMigration(22);

  try {
    db.prepare(
      `
        INSERT INTO tasks (
          id,
          project_key,
          project_id,
          title,
          source_spec_path,
          bead_path,
          component_path,
          status,
          assigned_agent,
          runtime_session_id,
          priority,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'task-job-legacy',
      'system',
      'system',
      'Legacy execution job',
      '/tmp/specs/legacy-bead.md',
      '/tmp/specs/legacy-bead.md',
      null,
      'in_progress',
      'system',
      null,
      'medium',
      '2026-03-26T00:00:00.000Z',
      '2026-03-26T00:00:00.000Z',
      null,
    );

    db.prepare(
      `
        INSERT INTO execution_jobs (
          id,
          task_id,
          project_id,
          agent_id,
          execution_harness,
          execution_profile,
          provider,
          model,
          provider_profile,
          status,
          prompt,
          bead_path,
          requested_by_agent_id,
          origin_thread_id,
          notification_chat_id,
          runtime_session_id,
          branch_name,
          base_commit_hash,
          failure_reason,
          created_at,
          started_at,
          finished_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'job-legacy',
      'task-job-legacy',
      'system',
      'system',
      'codex',
      null,
      'openai',
      'gpt-5.4',
      null,
      'cancelled',
      'legacy prompt',
      '/tmp/specs/legacy-bead.md',
      'raymon',
      null,
      null,
      null,
      null,
      null,
      'cancelled by user',
      '2026-03-26T00:00:00.000Z',
      null,
      '2026-03-26T00:10:00.000Z',
      '2026-03-26T00:10:00.000Z',
    );

    db.prepare(
      `
        INSERT INTO execution_results (
          id,
          execution_job_id,
          task_id,
          runtime_session_id,
          status,
          summary,
          reason,
          branch_name,
          base_commit_hash,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'result-legacy',
      'job-legacy',
      'task-job-legacy',
      null,
      'cancelled',
      'legacy cancelled',
      'cancelled',
      null,
      null,
      null,
      '2026-03-26T00:10:00.000Z',
      '2026-03-26T00:10:00.000Z',
    );

    const migration = ralphitoMigrations.find((item) => item.id === 23);
    assert.ok(migration);
    db.exec(migration.sql);

    const jobRow = db
      .prepare(
        `
          SELECT
            status,
            attempt_count AS attemptCount,
            max_attempts AS maxAttempts,
            next_attempt_at AS nextAttemptAt
          FROM execution_jobs
          WHERE id = ?
        `,
      )
      .get('job-legacy') as {
        status: string;
        attemptCount: number;
        maxAttempts: number;
        nextAttemptAt: string;
      };
    const resultRow = db
      .prepare('SELECT status FROM execution_results WHERE execution_job_id = ?')
      .get('job-legacy') as { status: string };

    assert.equal(jobRow.status, 'failed');
    assert.equal(jobRow.attemptCount, 0);
    assert.equal(jobRow.maxAttempts, 3);
    assert.equal(jobRow.nextAttemptAt, '2026-03-26T00:00:00.000Z');
    assert.equal(resultRow.status, 'failed');
  } finally {
    db.close();
  }
});

test('migration 24 backfills execution job config snapshot columns desde agent_registry', () => {
  const db = createDatabaseUpToMigration(23);

  try {
    db.prepare(
      `
        INSERT INTO agent_registry (
          agent_id,
          name,
          role_file_path,
          session_prefix,
          provider,
          model,
          capabilities_json,
          is_active,
          created_at,
          updated_at,
          tool_mode,
          allowed_tools_json,
          primary_provider,
          fallbacks_json,
          provider_profile,
          execution_harness,
          tool_calling_mode,
          execution_profile
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'default',
      'Default',
      'roles/default.md',
      'de',
      'openai',
      'gpt-5.4',
      '[]',
      1,
      '2026-03-26T00:00:00.000Z',
      '2026-03-26T00:00:00.000Z',
      'allowed',
      JSON.stringify(['finish_task', 'submit_for_review']),
      'openai',
      JSON.stringify([{ provider: 'codex', model: 'gpt-5.4', providerProfile: 'jopen' }]),
      null,
      'codex',
      'allowed',
      'jopen',
    );

    db.prepare(
      `
        INSERT INTO tasks (
          id,
          project_key,
          project_id,
          title,
          source_spec_path,
          bead_path,
          component_path,
          status,
          assigned_agent,
          runtime_session_id,
          priority,
          created_at,
          updated_at,
          completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'task-job-config',
      'system',
      'system',
      'Legacy job config',
      '/tmp/specs/legacy-job-config.md',
      '/tmp/specs/legacy-job-config.md',
      null,
      'pending',
      'system',
      null,
      'medium',
      '2026-03-26T00:00:00.000Z',
      '2026-03-26T00:00:00.000Z',
      null,
    );

    db.prepare(
      `
        INSERT INTO execution_jobs (
          id,
          task_id,
          project_id,
          agent_id,
          execution_harness,
          execution_profile,
          provider,
          model,
          provider_profile,
          status,
          prompt,
          bead_path,
          requested_by_agent_id,
          origin_thread_id,
          notification_chat_id,
          runtime_session_id,
          branch_name,
          base_commit_hash,
          failure_reason,
          claim_token,
          claimed_by,
          claimed_at,
          claim_expires_at,
          attempt_count,
          max_attempts,
          next_attempt_at,
          last_heartbeat_at,
          last_error_code,
          last_error_summary,
          created_at,
          started_at,
          finished_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      'job-config-legacy',
      'task-job-config',
      'system',
      'backend-team',
      'codex',
      'jopen',
      'openai',
      'gpt-5.4',
      null,
      'pending',
      'legacy prompt',
      '/tmp/specs/legacy-job-config.md',
      'raymon',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      3,
      '2026-03-26T00:00:00.000Z',
      null,
      null,
      null,
      '2026-03-26T00:00:00.000Z',
      null,
      null,
      '2026-03-26T00:00:00.000Z',
    );

    const migration = ralphitoMigrations.find((item) => item.id === 24);
    assert.ok(migration);
    db.exec(migration.sql);

    const row = db.prepare(
      `
        SELECT
          agent_config_id AS agentConfigId,
          tool_calling_mode AS toolCallingMode,
          allowed_tools_json AS allowedToolsJson,
          fallbacks_json AS fallbacksJson
        FROM execution_jobs
        WHERE id = ?
      `,
    ).get('job-config-legacy') as {
      agentConfigId: string | null;
      toolCallingMode: string | null;
      allowedToolsJson: string | null;
      fallbacksJson: string | null;
    };

    assert.equal(row.agentConfigId, 'default');
    assert.equal(row.toolCallingMode, 'allowed');
    assert.deepEqual(JSON.parse(row.allowedToolsJson || '[]'), ['finish_task', 'submit_for_review']);
    assert.deepEqual(JSON.parse(row.fallbacksJson || '[]'), [
      { provider: 'codex', model: 'gpt-5.4', providerProfile: 'jopen' },
    ]);
  } finally {
    db.close();
  }
});
