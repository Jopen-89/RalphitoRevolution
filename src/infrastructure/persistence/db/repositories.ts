import { getRalphitoDatabase } from './client.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed' | 'cancelled' | 'BLOCKED_BY_FAILURE';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ProjectKind = 'system' | 'repo' | 'sandbox';
export type ExecutionJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type ExecutionResultStatus = Extract<ExecutionJobStatus, 'done' | 'failed' | 'cancelled'>;

export interface ProjectRecord {
  projectId: string;
  name: string;
  kind: string;
  repoPath: string;
  worktreeRoot: string;
  defaultBranch: string;
  agentRulesFile: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProjectInput {
  projectId: string;
  name: string;
  kind: ProjectKind | string;
  repoPath: string;
  worktreeRoot: string;
  defaultBranch: string;
  agentRulesFile?: string | null;
  isActive?: boolean;
}

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
  runtimeSessionId: string;
  status: string;
  baseCommitHash?: string;
}

export interface CreateTaskInput {
  id: string;
  projectKey: string;
  projectId?: string;
  title: string;
  sourceSpecPath?: string;
  beadPath?: string;
  componentPath?: string;
  status: TaskStatus;
  assignedAgent?: string;
  runtimeSessionId?: string;
  priority?: TaskPriority;
  completedAt?: string;
}

export interface UpdateTaskStatusInput {
  id: string;
  status: TaskStatus;
  assignedAgent?: string;
  runtimeSessionId?: string;
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

export interface ExecutionJobRecord {
  id: string;
  taskId: string;
  projectId: string;
  agentId: string;
  executionHarness: string;
  executionProfile: string | null;
  provider: string | null;
  model: string | null;
  providerProfile: string | null;
  status: ExecutionJobStatus;
  prompt: string | null;
  beadPath: string | null;
  requestedByAgentId: string | null;
  originThreadId: number | null;
  notificationChatId: string | null;
  runtimeSessionId: string | null;
  branchName: string | null;
  baseCommitHash: string | null;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface CreateExecutionJobInput {
  id: string;
  taskId: string;
  projectId: string;
  agentId: string;
  executionHarness: string;
  executionProfile?: string | null;
  provider?: string | null;
  model?: string | null;
  providerProfile?: string | null;
  status?: ExecutionJobStatus;
  prompt?: string | null;
  beadPath?: string | null;
  requestedByAgentId?: string | null;
  originThreadId?: number | null;
  notificationChatId?: string | null;
  runtimeSessionId?: string | null;
  branchName?: string | null;
  baseCommitHash?: string | null;
  failureReason?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string;
}

export interface UpdateExecutionJobStatusInput {
  id: string;
  status: ExecutionJobStatus;
  runtimeSessionId?: string | null;
  branchName?: string | null;
  baseCommitHash?: string | null;
  failureReason?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ExecutionResultRecord {
  id: string;
  executionJobId: string;
  taskId: string;
  runtimeSessionId: string | null;
  status: ExecutionResultStatus;
  summary: string | null;
  reason: string | null;
  branchName: string | null;
  baseCommitHash: string | null;
  payloadJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertExecutionResultInput {
  id: string;
  executionJobId: string;
  taskId: string;
  runtimeSessionId?: string | null;
  status: ExecutionResultStatus;
  summary?: string | null;
  reason?: string | null;
  branchName?: string | null;
  baseCommitHash?: string | null;
  payloadJson?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
          INSERT INTO agent_sessions (thread_id, agent_id, runtime_session_id, status, base_commit_hash, started_at, heartbeat_at, created_at, updated_at)
          VALUES (@threadId, @agentId, @runtimeSessionId, @status, @baseCommitHash, @now, @now, @now, @now)
          ON CONFLICT(runtime_session_id)
          DO UPDATE SET
            thread_id = excluded.thread_id,
            agent_id = excluded.agent_id,
            runtime_session_id = excluded.runtime_session_id,
            status = agent_sessions.status,
            base_commit_hash = COALESCE(agent_sessions.base_commit_hash, excluded.base_commit_hash),
            started_at = COALESCE(agent_sessions.started_at, excluded.started_at),
            heartbeat_at = COALESCE(agent_sessions.heartbeat_at, excluded.heartbeat_at),
            updated_at = excluded.updated_at
        `,
      )
      .run({ ...input, now });
  }
}

class ProjectsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  getById(projectId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            project_id AS projectId,
            name,
            kind,
            repo_path AS repoPath,
            worktree_root AS worktreeRoot,
            default_branch AS defaultBranch,
            agent_rules_file AS agentRulesFile,
            is_active AS isActive,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM projects
          WHERE project_id = ?
          LIMIT 1
        `,
      )
      .get(projectId) as Omit<ProjectRecord, 'isActive'> & { isActive: number } | undefined;

    if (!row) return null;

    return {
      ...row,
      isActive: Boolean(row.isActive),
    } satisfies ProjectRecord;
  }

  listActive() {
    const rows = this.db
      .prepare(
        `
          SELECT
            project_id AS projectId,
            name,
            kind,
            repo_path AS repoPath,
            worktree_root AS worktreeRoot,
            default_branch AS defaultBranch,
            agent_rules_file AS agentRulesFile,
            is_active AS isActive,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM projects
          WHERE is_active = 1
          ORDER BY project_id ASC
        `,
      )
      .all() as Array<Omit<ProjectRecord, 'isActive'> & { isActive: number }>;

    return rows.map((row) => ({
      ...row,
      isActive: Boolean(row.isActive),
    })) satisfies ProjectRecord[];
  }

  upsert(input: UpsertProjectInput) {
    const now = new Date().toISOString();

    this.db
      .prepare(
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      )
      .run(
        input.projectId,
        input.name,
        input.kind,
        input.repoPath,
        input.worktreeRoot,
        input.defaultBranch,
        input.agentRulesFile || null,
        input.isActive === false ? 0 : 1,
        now,
        now,
      );

    return this.getById(input.projectId);
  }

  ensureSystemProject(input: Omit<UpsertProjectInput, 'projectId' | 'kind'>) {
    return this.upsert({
      projectId: 'system',
      kind: 'system',
      ...input,
    });
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
      )
      .run(
        input.id,
        input.projectKey,
        input.projectId || input.projectKey,
        input.title,
        input.sourceSpecPath || null,
        input.beadPath || input.sourceSpecPath || null,
        input.componentPath || null,
        input.status,
        input.assignedAgent || null,
        input.runtimeSessionId || null,
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
              runtime_session_id = COALESCE(?, runtime_session_id),
              updated_at = ?,
              completed_at = COALESCE(?, completed_at)
          WHERE id = ?
        `,
      )
      .run(
        input.status,
        input.assignedAgent || null,
        input.runtimeSessionId || null,
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

function mapExecutionJob(row: Record<string, unknown> | undefined): ExecutionJobRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    taskId: String(row.taskId),
    projectId: String(row.projectId),
    agentId: String(row.agentId),
    executionHarness: String(row.executionHarness),
    executionProfile: row.executionProfile ? String(row.executionProfile) : null,
    provider: row.provider ? String(row.provider) : null,
    model: row.model ? String(row.model) : null,
    providerProfile: row.providerProfile ? String(row.providerProfile) : null,
    status: row.status as ExecutionJobStatus,
    prompt: row.prompt ? String(row.prompt) : null,
    beadPath: row.beadPath ? String(row.beadPath) : null,
    requestedByAgentId: row.requestedByAgentId ? String(row.requestedByAgentId) : null,
    originThreadId: typeof row.originThreadId === 'number' ? row.originThreadId : row.originThreadId ? Number(row.originThreadId) : null,
    notificationChatId: row.notificationChatId ? String(row.notificationChatId) : null,
    runtimeSessionId: row.runtimeSessionId ? String(row.runtimeSessionId) : null,
    branchName: row.branchName ? String(row.branchName) : null,
    baseCommitHash: row.baseCommitHash ? String(row.baseCommitHash) : null,
    failureReason: row.failureReason ? String(row.failureReason) : null,
    createdAt: String(row.createdAt),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    finishedAt: row.finishedAt ? String(row.finishedAt) : null,
    updatedAt: String(row.updatedAt),
  };
}

function mapExecutionResult(row: Record<string, unknown> | undefined): ExecutionResultRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    executionJobId: String(row.executionJobId),
    taskId: String(row.taskId),
    runtimeSessionId: row.runtimeSessionId ? String(row.runtimeSessionId) : null,
    status: row.status as ExecutionResultStatus,
    summary: row.summary ? String(row.summary) : null,
    reason: row.reason ? String(row.reason) : null,
    branchName: row.branchName ? String(row.branchName) : null,
    baseCommitHash: row.baseCommitHash ? String(row.baseCommitHash) : null,
    payloadJson: row.payloadJson ? String(row.payloadJson) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

class ExecutionJobsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  create(input: CreateExecutionJobInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const updatedAt = input.updatedAt || createdAt;
    const status = input.status || 'pending';

    this.db
      .prepare(
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
      )
      .run(
        input.id,
        input.taskId,
        input.projectId,
        input.agentId,
        input.executionHarness,
        input.executionProfile || null,
        input.provider || null,
        input.model || null,
        input.providerProfile || null,
        status,
        input.prompt || null,
        input.beadPath || null,
        input.requestedByAgentId || null,
        input.originThreadId ?? null,
        input.notificationChatId || null,
        input.runtimeSessionId || null,
        input.branchName || null,
        input.baseCommitHash || null,
        input.failureReason || null,
        createdAt,
        input.startedAt || null,
        input.finishedAt || null,
        updatedAt,
      );

    return this.getById(input.id);
  }

  getById(id: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            task_id AS taskId,
            project_id AS projectId,
            agent_id AS agentId,
            execution_harness AS executionHarness,
            execution_profile AS executionProfile,
            provider,
            model,
            provider_profile AS providerProfile,
            status,
            prompt,
            bead_path AS beadPath,
            requested_by_agent_id AS requestedByAgentId,
            origin_thread_id AS originThreadId,
            notification_chat_id AS notificationChatId,
            runtime_session_id AS runtimeSessionId,
            branch_name AS branchName,
            base_commit_hash AS baseCommitHash,
            failure_reason AS failureReason,
            created_at AS createdAt,
            started_at AS startedAt,
            finished_at AS finishedAt,
            updated_at AS updatedAt
          FROM execution_jobs
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(id) as Record<string, unknown> | undefined;

    return mapExecutionJob(row);
  }

  getByRuntimeSessionId(runtimeSessionId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            task_id AS taskId,
            project_id AS projectId,
            agent_id AS agentId,
            execution_harness AS executionHarness,
            execution_profile AS executionProfile,
            provider,
            model,
            provider_profile AS providerProfile,
            status,
            prompt,
            bead_path AS beadPath,
            requested_by_agent_id AS requestedByAgentId,
            origin_thread_id AS originThreadId,
            notification_chat_id AS notificationChatId,
            runtime_session_id AS runtimeSessionId,
            branch_name AS branchName,
            base_commit_hash AS baseCommitHash,
            failure_reason AS failureReason,
            created_at AS createdAt,
            started_at AS startedAt,
            finished_at AS finishedAt,
            updated_at AS updatedAt
          FROM execution_jobs
          WHERE runtime_session_id = ?
          LIMIT 1
        `,
      )
      .get(runtimeSessionId) as Record<string, unknown> | undefined;

    return mapExecutionJob(row);
  }

  findActiveByTaskId(taskId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            task_id AS taskId,
            project_id AS projectId,
            agent_id AS agentId,
            execution_harness AS executionHarness,
            execution_profile AS executionProfile,
            provider,
            model,
            provider_profile AS providerProfile,
            status,
            prompt,
            bead_path AS beadPath,
            requested_by_agent_id AS requestedByAgentId,
            origin_thread_id AS originThreadId,
            notification_chat_id AS notificationChatId,
            runtime_session_id AS runtimeSessionId,
            branch_name AS branchName,
            base_commit_hash AS baseCommitHash,
            failure_reason AS failureReason,
            created_at AS createdAt,
            started_at AS startedAt,
            finished_at AS finishedAt,
            updated_at AS updatedAt
          FROM execution_jobs
          WHERE task_id = ?
            AND status IN ('pending', 'running')
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(taskId) as Record<string, unknown> | undefined;

    return mapExecutionJob(row);
  }

  updateStatus(input: UpdateExecutionJobStatusInput) {
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE execution_jobs
          SET status = ?,
              runtime_session_id = COALESCE(?, runtime_session_id),
              branch_name = COALESCE(?, branch_name),
              base_commit_hash = COALESCE(?, base_commit_hash),
              failure_reason = ?,
              started_at = COALESCE(?, started_at),
              finished_at = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        input.status,
        input.runtimeSessionId ?? null,
        input.branchName ?? null,
        input.baseCommitHash ?? null,
        input.failureReason ?? null,
        input.startedAt ?? null,
        input.finishedAt ?? null,
        updatedAt,
        input.id,
      );

    return this.getById(input.id);
  }
}

class ExecutionResultsRepository {
  constructor(private readonly db: RalphitoDatabase) {}

  upsert(input: UpsertExecutionResultInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const updatedAt = input.updatedAt || createdAt;

    this.db
      .prepare(
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
          ON CONFLICT(execution_job_id)
          DO UPDATE SET
            runtime_session_id = excluded.runtime_session_id,
            status = excluded.status,
            summary = excluded.summary,
            reason = excluded.reason,
            branch_name = excluded.branch_name,
            base_commit_hash = excluded.base_commit_hash,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.id,
        input.executionJobId,
        input.taskId,
        input.runtimeSessionId || null,
        input.status,
        input.summary || null,
        input.reason || null,
        input.branchName || null,
        input.baseCommitHash || null,
        input.payloadJson || null,
        createdAt,
        updatedAt,
      );

    return this.getByExecutionJobId(input.executionJobId);
  }

  getByExecutionJobId(executionJobId: string) {
    const row = this.db
      .prepare(
        `
          SELECT
            id,
            execution_job_id AS executionJobId,
            task_id AS taskId,
            runtime_session_id AS runtimeSessionId,
            status,
            summary,
            reason,
            branch_name AS branchName,
            base_commit_hash AS baseCommitHash,
            payload_json AS payloadJson,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM execution_results
          WHERE execution_job_id = ?
          LIMIT 1
        `,
      )
      .get(executionJobId) as Record<string, unknown> | undefined;

    return mapExecutionResult(row);
  }
}

export interface RalphitoRepositories {
  projects: ProjectsRepository;
  threads: ThreadsRepository;
  messages: MessagesRepository;
  agentSessions: AgentSessionsRepository;
  tasks: TasksRepository;
  taskEvents: TaskEventsRepository;
  artifacts: ArtifactsRepository;
  sessionSummaries: SessionSummariesRepository;
  executionJobs: ExecutionJobsRepository;
  executionResults: ExecutionResultsRepository;
}

let repositories: RalphitoRepositories | null = null;

export function getRalphitoRepositories() {
  if (repositories) return repositories;

  const db = getRalphitoDatabase();

  repositories = {
    projects: new ProjectsRepository(db),
    threads: new ThreadsRepository(db),
    messages: new MessagesRepository(db),
    agentSessions: new AgentSessionsRepository(db),
    tasks: new TasksRepository(db),
    taskEvents: new TaskEventsRepository(db),
    artifacts: new ArtifactsRepository(db),
    sessionSummaries: new SessionSummariesRepository(db),
    executionJobs: new ExecutionJobsRepository(db),
    executionResults: new ExecutionResultsRepository(db),
  };

  return repositories;
}

export function resetRalphitoRepositories() {
  repositories = null;
}
