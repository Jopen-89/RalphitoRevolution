export interface RalphitoMigration {
  id: number;
  name: string;
  sql: string;
}

export const ralphitoMigrations: RalphitoMigration[] = [
  {
    id: 1,
    name: 'initial_operational_kernel',
    sql: `
      CREATE TABLE IF NOT EXISTS threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        external_chat_id TEXT NOT NULL,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (channel, external_chat_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        external_message_id TEXT,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        sender_name TEXT,
        role TEXT,
        raw_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_external_message
        ON messages(thread_id, external_message_id)
        WHERE external_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        ao_session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        UNIQUE (thread_id, agent_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_ao_session_id
        ON agent_sessions(ao_session_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        title TEXT NOT NULL,
        source_spec_path TEXT,
        component_path TEXT,
        status TEXT NOT NULL,
        assigned_agent TEXT,
        ao_session_id TEXT,
        priority TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_project_status
        ON tasks(project_key, status);

      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_task_events_task_created_at
        ON task_events(task_id, created_at);

      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        thread_id INTEGER,
        artifact_type TEXT NOT NULL,
        path TEXT,
        content TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_task_id
        ON artifacts(task_id);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_scope
        ON session_summaries(scope_type, scope_id, created_at);
    `,
  },
  {
    id: 2,
    name: 'telegram_persistence_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS message_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        UNIQUE (thread_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_routes_thread_updated_at
        ON message_routes(thread_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS active_agents (
        thread_id INTEGER PRIMARY KEY,
        agent_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS message_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        UNIQUE (thread_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_message_fingerprints_updated_at
        ON message_fingerprints(updated_at DESC);
    `,
  },
  {
    id: 3,
    name: 'documents_fts_index',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
        UNIQUE (document_id, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
        path,
        kind,
        content,
        tokenize = 'porter unicode61'
      );

      CREATE INDEX IF NOT EXISTS idx_documents_kind_mtime
        ON documents(kind, mtime);
    `,
  },
  {
    id: 4,
    name: 'system_events_and_ops',
    sql: `
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_system_events_type_created_at
        ON system_events(event_type, created_at DESC);
    `,
  },
  {
    id: 9,
    name: 'add_base_commit_hash_to_agent_sessions',
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN base_commit_hash TEXT;
    `,
  },
  {
    id: 10,
    name: 'runtime_sessions_phase_1',
    sql: `
      ALTER TABLE tasks RENAME COLUMN ao_session_id TO runtime_session_id;
      CREATE INDEX IF NOT EXISTS idx_tasks_runtime_session_id
        ON tasks(runtime_session_id);

      ALTER TABLE agent_sessions RENAME TO agent_sessions_legacy;

      CREATE TABLE agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        runtime_session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        base_commit_hash TEXT,
        worktree_path TEXT,
        pid INTEGER,
        step_count INTEGER NOT NULL DEFAULT 0,
        max_steps INTEGER,
        started_at TEXT,
        heartbeat_at TEXT,
        finished_at TEXT,
        failure_kind TEXT,
        failure_summary TEXT,
        failure_log_tail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );

      INSERT INTO agent_sessions (
        id,
        thread_id,
        agent_id,
        runtime_session_id,
        status,
        base_commit_hash,
        worktree_path,
        pid,
        step_count,
        max_steps,
        started_at,
        heartbeat_at,
        finished_at,
        failure_kind,
        failure_summary,
        failure_log_tail,
        created_at,
        updated_at
      )
      SELECT
        id,
        thread_id,
        agent_id,
        ao_session_id,
        CASE
          WHEN status = 'bound' THEN 'running'
          ELSE status
        END,
        base_commit_hash,
        NULL,
        NULL,
        0,
        NULL,
        created_at,
        updated_at,
        NULL,
        NULL,
        NULL,
        NULL,
        created_at,
        updated_at
      FROM agent_sessions_legacy;

      DROP TABLE agent_sessions_legacy;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_runtime_session_id
        ON agent_sessions(runtime_session_id);

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_thread_agent_updated
        ON agent_sessions(thread_id, agent_id, updated_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS runtime_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        path_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (runtime_session_id) REFERENCES agent_sessions(runtime_session_id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_locks_path
        ON runtime_locks(path);

      CREATE INDEX IF NOT EXISTS idx_runtime_locks_runtime_session_id
        ON runtime_locks(runtime_session_id);

      CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at
        ON runtime_locks(expires_at);
    `,
  },
  {
    id: 11,
    name: 'runtime_locks_phase_2',
    sql: `
      ALTER TABLE runtime_locks RENAME TO runtime_locks_legacy;

      CREATE TABLE runtime_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        runtime_session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        path_kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      INSERT INTO runtime_locks (
        id,
        runtime_session_id,
        path,
        path_kind,
        created_at,
        heartbeat_at,
        expires_at
      )
      SELECT
        id,
        runtime_session_id,
        path,
        path_kind,
        created_at,
        heartbeat_at,
        expires_at
      FROM runtime_locks_legacy;

      DROP TABLE runtime_locks_legacy;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_locks_path
        ON runtime_locks(path);

      CREATE INDEX IF NOT EXISTS idx_runtime_locks_runtime_session_id
        ON runtime_locks(runtime_session_id);

      CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at
        ON runtime_locks(expires_at);
    `,
  },
  {
    id: 12,
    name: 'runtime_session_origin_context',
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN origin_thread_id INTEGER;
      ALTER TABLE agent_sessions ADD COLUMN notification_chat_id TEXT;

      CREATE INDEX IF NOT EXISTS idx_agent_sessions_origin_thread_id
        ON agent_sessions(origin_thread_id);
    `,
  },
  {
    id: 13,
    name: 'engine_notifications_outbox',
    sql: `
      CREATE TABLE IF NOT EXISTS engine_notifications (
        event_id TEXT PRIMARY KEY,
        runtime_session_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        target_chat_id TEXT,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_engine_notifications_status_next_attempt
        ON engine_notifications(status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_engine_notifications_runtime_session_id
        ON engine_notifications(runtime_session_id);

      CREATE INDEX IF NOT EXISTS idx_engine_notifications_created_at
        ON engine_notifications(created_at DESC);
    `,
  },
  {
    id: 14,
    name: 'agent_sessions_suspended_state',
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN current_command TEXT;
      ALTER TABLE agent_sessions ADD COLUMN suspended_at TEXT;
      ALTER TABLE agent_sessions ADD COLUMN suspended_reason TEXT;
    `,
  },
  {
    id: 15,
    name: 'agent_sessions_failure_reason_code',
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN failure_reason_code TEXT;
    `,
  },
  {
    id: 16,
    name: 'agent_registry_and_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS agent_registry (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role_file_path TEXT NOT NULL,
        session_prefix TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        capabilities_json TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_registry_is_active
        ON agent_registry(is_active);
    `,
  },
  {
    id: 17,
    name: 'agent_registry_permissions_and_strategy',
    sql: `
      ALTER TABLE agent_registry ADD COLUMN tool_mode TEXT DEFAULT 'none';
      ALTER TABLE agent_registry ADD COLUMN allowed_tools_json TEXT;
      ALTER TABLE agent_registry ADD COLUMN primary_provider TEXT;
      ALTER TABLE agent_registry ADD COLUMN fallbacks_json TEXT;
    `,
  },
  {
    id: 18,
    name: 'agent_registry_provider_profiles',
    sql: `
      ALTER TABLE agent_registry ADD COLUMN provider_profile TEXT;
    `,
  },
  {
    id: 19,
    name: 'projects_stage1_foundation',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        worktree_root TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        agent_rules_file TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_is_active
        ON projects(is_active);

      ALTER TABLE tasks ADD COLUMN project_id TEXT;
      ALTER TABLE tasks ADD COLUMN bead_path TEXT;

      UPDATE tasks
      SET project_id = CASE
        WHEN project_id IS NOT NULL AND TRIM(project_id) <> '' THEN project_id
        WHEN project_key IS NOT NULL AND TRIM(project_key) <> '' THEN LOWER(TRIM(project_key))
        ELSE 'system'
      END;

      UPDATE tasks
      SET bead_path = COALESCE(bead_path, source_spec_path)
      WHERE source_spec_path IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_tasks_project_id_status
        ON tasks(project_id, status);

      CREATE INDEX IF NOT EXISTS idx_tasks_project_id_updated_at
        ON tasks(project_id, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_tasks_bead_path
        ON tasks(bead_path)
        WHERE bead_path IS NOT NULL;
    `,
  },
  {
    id: 20,
    name: 'agent_registry_execution_harness_and_tool_calling_mode',
    sql: `
      ALTER TABLE agent_registry ADD COLUMN execution_harness TEXT DEFAULT 'opencode';
      ALTER TABLE agent_registry ADD COLUMN tool_calling_mode TEXT DEFAULT 'none';

      UPDATE agent_registry
      SET execution_harness = COALESCE(NULLIF(TRIM(execution_harness), ''), 'opencode');

      UPDATE agent_registry
      SET tool_calling_mode = COALESCE(
        NULLIF(TRIM(tool_calling_mode), ''),
        NULLIF(TRIM(tool_mode), ''),
        'none'
      );
    `,
  },
  {
    id: 21,
    name: 'agent_registry_execution_profile',
    sql: `
      ALTER TABLE agent_registry ADD COLUMN execution_profile TEXT;

      UPDATE agent_registry
      SET execution_profile = provider_profile
      WHERE execution_harness = 'codex'
        AND execution_profile IS NULL
        AND provider_profile IS NOT NULL
        AND TRIM(provider_profile) <> '';
    `,
  },
];
