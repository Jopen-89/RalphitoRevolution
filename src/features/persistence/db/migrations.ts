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
];
