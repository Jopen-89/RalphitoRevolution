import { getRalphitoDatabase } from './client.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface UpsertThreadInput {
  channel: string;
  externalChatId: string;
  title?: string;
}

export interface CreateMessageInput {
  threadId: number;
  externalMessageId?: string;
  senderType: string;
  senderId?: string;
  senderName?: string;
  role?: string;
  rawText: string;
  normalizedText: string;
  metadataJson?: string;
  createdAt?: string;
}

export interface UpsertAgentSessionInput {
  threadId: number;
  agentId: string;
  aoSessionId: string;
  status: string;
}

export interface CreateTaskInput {
  id: string;
  projectKey: string;
  title: string;
  sourceSpecPath?: string;
  componentPath?: string;
  status: TaskStatus;
  assignedAgent?: string;
  aoSessionId?: string;
  priority?: TaskPriority;
  completedAt?: string;
}

export interface UpdateTaskStatusInput {
  id: string;
  status: TaskStatus;
  assignedAgent?: string;
  aoSessionId?: string;
  completedAt?: string | null;
}

export interface CreateTaskEventInput {
  taskId: string;
  eventType: string;
  payloadJson: string;
  createdAt?: string;
}

export interface CreateArtifactInput {
  taskId?: string;
  threadId?: number;
  artifactType: string;
  path?: string;
  content?: string;
  metadataJson?: string;
  createdAt?: string;
}

export interface CreateSessionSummaryInput {
  scopeType: string;
  scopeId: string;
  summary: string;
  createdAt?: string;
}

class ThreadsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  upsert(input: UpsertThreadInput) {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (@channel, @externalChatId, @title, @now, @now)
          ON CONFLICT(channel, external_chat_id)
          DO UPDATE SET
            title = COALESCE(excluded.title, threads.title),
            updated_at = excluded.updated_at
        `,
      )
      .run({ ...input, now });

    return this.db
      .prepare(
        'SELECT id, channel, external_chat_id AS externalChatId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE channel = ? AND external_chat_id = ?',
      )
      .get(input.channel, input.externalChatId);
  }
}

class MessagesRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateMessageInput) {
    const createdAt = input.createdAt || new Date().toISOString();

    const result = this.db
      .prepare(
        `
          INSERT INTO messages (
            thread_id,
            external_message_id,
            sender_type,
            sender_id,
            sender_name,
            role,
            raw_text,
            normalized_text,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.threadId,
        input.externalMessageId || null,
        input.senderType,
        input.senderId || null,
        input.senderName || null,
        input.role || null,
        input.rawText,
        input.normalizedText,
        input.metadataJson || null,
        createdAt,
      );

    return result.lastInsertRowid;
  }
}

class AgentSessionsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  upsert(input: UpsertAgentSessionInput) {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO agent_sessions (thread_id, agent_id, ao_session_id, status, created_at, updated_at)
          VALUES (@threadId, @agentId, @aoSessionId, @status, @now, @now)
          ON CONFLICT(thread_id, agent_id)
          DO UPDATE SET
            ao_session_id = excluded.ao_session_id,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
      )
      .run({ ...input, now });
  }
}

class TasksRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateTaskInput) {
    const now = new Date().toISOString();
    const priority = input.priority || 'medium';

    this.db
      .prepare(
        `
          INSERT INTO tasks (
            id,
            project_key,
            title,
            source_spec_path,
            component_path,
            status,
            assigned_agent,
            ao_session_id,
            priority,
            created_at,
            updated_at,
            completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.projectKey,
        input.title,
        input.sourceSpecPath || null,
        input.componentPath || null,
        input.status,
        input.assignedAgent || null,
        input.aoSessionId || null,
        priority,
        now,
        now,
        input.completedAt || null,
      );
  }

  updateStatus(input: UpdateTaskStatusInput) {
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE tasks
          SET status = ?,
              assigned_agent = COALESCE(?, assigned_agent),
              ao_session_id = COALESCE(?, ao_session_id),
              updated_at = ?,
              completed_at = COALESCE(?, completed_at)
          WHERE id = ?
        `,
      )
      .run(
        input.status,
        input.assignedAgent || null,
        input.aoSessionId || null,
        updatedAt,
        input.completedAt || null,
        input.id,
      );
  }
}

class TaskEventsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  append(input: CreateTaskEventInput) {
    const createdAt = input.createdAt || new Date().toISOString();

    return this.db
      .prepare(
        'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(input.taskId, input.eventType, input.payloadJson, createdAt).lastInsertRowid;
  }
}

class ArtifactsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateArtifactInput) {
    const createdAt = input.createdAt || new Date().toISOString();

    return this.db
      .prepare(
        `
          INSERT INTO artifacts (task_id, thread_id, artifact_type, path, content, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.taskId || null,
        input.threadId || null,
        input.artifactType,
        input.path || null,
        input.content || null,
        input.metadataJson || null,
        createdAt,
      ).lastInsertRowid;
  }
}

class SessionSummariesRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateSessionSummaryInput) {
    const createdAt = input.createdAt || new Date().toISOString();

    return this.db
      .prepare(
        'INSERT INTO session_summaries (scope_type, scope_id, summary, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(input.scopeType, input.scopeId, input.summary, createdAt).lastInsertRowid;
  }
}

export interface RalphitoRepositories {
  threads: ThreadsRepository;
  messages: MessagesRepository;
  agentSessions: AgentSessionsRepository;
  tasks: TasksRepository;
  taskEvents: TaskEventsRepository;
  artifacts: ArtifactsRepository;
  sessionSummaries: SessionSummariesRepository;
}

let repositories: RalphitoRepositories | null = null;

export function getRalphitoRepositories() {
  if (repositories) return repositories;

  const db = getRalphitoDatabase();

  repositories = {
    threads: new ThreadsRepository(db),
    messages: new MessagesRepository(db),
    agentSessions: new AgentSessionsRepository(db),
    tasks: new TasksRepository(db),
    taskEvents: new TaskEventsRepository(db),
    artifacts: new ArtifactsRepository(db),
    sessionSummaries: new SessionSummariesRepository(db),
  };

  return repositories;
}
