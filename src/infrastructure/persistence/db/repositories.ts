import { getRalphitoDatabase } from './client.js';
import { DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS } from '../../../core/domain/constants.js';
import type { AgentFallbackRoute, ToolMode } from '../../../core/domain/gateway.types.js';

type RalphitoDatabase = ReturnType<typeof getRalphitoDatabase>;

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed' | 'cancelled' | 'BLOCKED_BY_FAILURE';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ProjectKind = 'system' | 'repo' | 'sandbox';
export type ExecutionJobStatus = 'pending' | 'claimed' | 'running' | 'review' | 'failed' | 'done' | 'dead';
export type ExecutionResultStatus = Extract<ExecutionJobStatus, 'done' | 'failed' | 'dead'>;
export type ExecutionReviewStatus = 'pending' | 'claimed' | 'approved' | 'rejected' | 'failed';

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
  parentTaskId?: string | null;
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
  agentConfigId: string | null;
  executionHarness: string;
  executionProfile: string | null;
  provider: string | null;
  model: string | null;
  providerProfile: string | null;
  toolMode: ToolMode;
  allowedTools: string[];
  fallbacks: AgentFallbackRoute[];
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
  claimToken: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastHeartbeatAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
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
  agentConfigId?: string | null;
  executionHarness: string;
  executionProfile?: string | null;
  provider?: string | null;
  model?: string | null;
  providerProfile?: string | null;
  toolMode?: ToolMode;
  allowedTools?: string[];
  fallbacks?: AgentFallbackRoute[];
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
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorSummary?: string | null;
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
  claimToken?: string | null;
  claimedBy?: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorSummary?: string | null;
}

export interface ClaimExecutionJobInput {
  id: string;
  workerId: string;
  claimToken: string;
  claimedAt?: string;
  claimExpiresAt: string;
}

export interface ClaimNextExecutionJobInput {
  workerId: string;
  claimToken: string;
  claimedAt?: string;
  claimExpiresAt: string;
  limit?: number;
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

export interface ExecutionReviewRecord {
  id: string;
  executionJobId: string;
  taskId: string;
  runtimeSessionId: string | null;
  reviewerAgentId: string;
  provider: string | null;
  model: string | null;
  status: ExecutionReviewStatus;
  summary: string | null;
  findingsJson: string | null;
  inputJson: string | null;
  reworkTaskId: string | null;
  claimToken: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface UpsertExecutionReviewInput {
  id: string;
  executionJobId: string;
  taskId: string;
  runtimeSessionId?: string | null;
  reviewerAgentId: string;
  provider?: string | null;
  model?: string | null;
  status?: ExecutionReviewStatus;
  summary?: string | null;
  findingsJson?: string | null;
  inputJson?: string | null;
  reworkTaskId?: string | null;
  claimToken?: string | null;
  claimedBy?: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string;
}

export interface UpdateExecutionReviewStatusInput {
  id: string;
  status: ExecutionReviewStatus;
  provider?: string | null;
  model?: string | null;
  summary?: string | null;
  findingsJson?: string | null;
  inputJson?: string | null;
  reworkTaskId?: string | null;
  claimToken?: string | null;
  claimedBy?: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  attemptCount?: number;
  maxAttempts?: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface ClaimExecutionReviewInput {
  id: string;
  workerId: string;
  claimToken: string;
  claimedAt?: string;
  claimExpiresAt: string;
}

export interface ClaimNextExecutionReviewInput {
  workerId: string;
  claimToken: string;
  claimedAt?: string;
  claimExpiresAt: string;
  limit?: number;
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
            parent_task_id,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.projectKey,
        input.projectId || input.projectKey,
        input.title,
        input.parentTaskId || null,
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

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeToolMode(value: unknown): ToolMode {
  return value === 'allowed' ? 'allowed' : 'none';
}

function mapExecutionJob(row: Record<string, unknown> | undefined): ExecutionJobRecord | null {
  if (!row) return null;

  const allowedTools = safeJsonParse(row.allowedToolsJson ? String(row.allowedToolsJson) : null, [] as unknown[])
    .filter((value): value is string => typeof value === 'string');
  const fallbacks = safeJsonParse(row.fallbacksJson ? String(row.fallbacksJson) : null, [] as AgentFallbackRoute[]);

  return {
    id: String(row.id),
    taskId: String(row.taskId),
    projectId: String(row.projectId),
    agentId: String(row.agentId),
    agentConfigId: row.agentConfigId ? String(row.agentConfigId) : null,
    executionHarness: String(row.executionHarness),
    executionProfile: row.executionProfile ? String(row.executionProfile) : null,
    provider: row.provider ? String(row.provider) : null,
    model: row.model ? String(row.model) : null,
    providerProfile: row.providerProfile ? String(row.providerProfile) : null,
    toolMode: normalizeToolMode(row.toolMode),
    allowedTools,
    fallbacks,
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
    claimToken: row.claimToken ? String(row.claimToken) : null,
    claimedBy: row.claimedBy ? String(row.claimedBy) : null,
    claimedAt: row.claimedAt ? String(row.claimedAt) : null,
    claimExpiresAt: row.claimExpiresAt ? String(row.claimExpiresAt) : null,
    attemptCount: typeof row.attemptCount === 'number' ? row.attemptCount : Number(row.attemptCount ?? 0),
    maxAttempts: typeof row.maxAttempts === 'number' ? row.maxAttempts : Number(row.maxAttempts ?? DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS),
    nextAttemptAt: row.nextAttemptAt ? String(row.nextAttemptAt) : null,
    lastHeartbeatAt: row.lastHeartbeatAt ? String(row.lastHeartbeatAt) : null,
    lastErrorCode: row.lastErrorCode ? String(row.lastErrorCode) : null,
    lastErrorSummary: row.lastErrorSummary ? String(row.lastErrorSummary) : null,
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

function mapExecutionReview(row: Record<string, unknown> | undefined): ExecutionReviewRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    executionJobId: String(row.executionJobId),
    taskId: String(row.taskId),
    runtimeSessionId: row.runtimeSessionId ? String(row.runtimeSessionId) : null,
    reviewerAgentId: String(row.reviewerAgentId),
    provider: row.provider ? String(row.provider) : null,
    model: row.model ? String(row.model) : null,
    status: row.status as ExecutionReviewStatus,
    summary: row.summary ? String(row.summary) : null,
    findingsJson: row.findingsJson ? String(row.findingsJson) : null,
    inputJson: row.inputJson ? String(row.inputJson) : null,
    reworkTaskId: row.reworkTaskId ? String(row.reworkTaskId) : null,
    claimToken: row.claimToken ? String(row.claimToken) : null,
    claimedBy: row.claimedBy ? String(row.claimedBy) : null,
    claimedAt: row.claimedAt ? String(row.claimedAt) : null,
    claimExpiresAt: row.claimExpiresAt ? String(row.claimExpiresAt) : null,
    attemptCount: typeof row.attemptCount === 'number' ? row.attemptCount : Number(row.attemptCount ?? 0),
    maxAttempts: typeof row.maxAttempts === 'number' ? row.maxAttempts : Number(row.maxAttempts ?? DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS),
    nextAttemptAt: row.nextAttemptAt ? String(row.nextAttemptAt) : null,
    lastError: row.lastError ? String(row.lastError) : null,
    createdAt: String(row.createdAt),
    startedAt: row.startedAt ? String(row.startedAt) : null,
    finishedAt: row.finishedAt ? String(row.finishedAt) : null,
    updatedAt: String(row.updatedAt),
  };
}

class ExecutionJobsRepository {
  private static readonly selectSql = `
    SELECT
      id,
      task_id AS taskId,
      project_id AS projectId,
      agent_id AS agentId,
      agent_config_id AS agentConfigId,
      execution_harness AS executionHarness,
      execution_profile AS executionProfile,
      provider,
      model,
      provider_profile AS providerProfile,
      tool_calling_mode AS toolMode,
      allowed_tools_json AS allowedToolsJson,
      fallbacks_json AS fallbacksJson,
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
      claim_token AS claimToken,
      claimed_by AS claimedBy,
      claimed_at AS claimedAt,
      claim_expires_at AS claimExpiresAt,
      attempt_count AS attemptCount,
      max_attempts AS maxAttempts,
      next_attempt_at AS nextAttemptAt,
      last_heartbeat_at AS lastHeartbeatAt,
      last_error_code AS lastErrorCode,
      last_error_summary AS lastErrorSummary,
      created_at AS createdAt,
      started_at AS startedAt,
      finished_at AS finishedAt,
      updated_at AS updatedAt
    FROM execution_jobs
  `;

  constructor(private readonly db: RalphitoDatabase) {}

  private getOne(whereSql: string, params: unknown[]) {
    const row = this.db
      .prepare(`${ExecutionJobsRepository.selectSql} ${whereSql}`)
      .get(...params) as Record<string, unknown> | undefined;

    return mapExecutionJob(row);
  }

  private updateFields(input: {
    id: string;
    patch: {
      status?: ExecutionJobStatus | undefined;
      runtimeSessionId?: string | null | undefined;
      branchName?: string | null | undefined;
      baseCommitHash?: string | null | undefined;
      failureReason?: string | null | undefined;
      startedAt?: string | null | undefined;
      finishedAt?: string | null | undefined;
      claimToken?: string | null | undefined;
      claimedBy?: string | null | undefined;
      claimedAt?: string | null | undefined;
      claimExpiresAt?: string | null | undefined;
      attemptCount?: number | undefined;
      maxAttempts?: number | undefined;
      nextAttemptAt?: string | null | undefined;
      lastHeartbeatAt?: string | null | undefined;
      lastErrorCode?: string | null | undefined;
      lastErrorSummary?: string | null | undefined;
      updatedAt?: string | undefined;
    };
    expectedStatus?: ExecutionJobStatus;
    expectedStatuses?: ExecutionJobStatus[];
    expectedClaimToken?: string | null;
  }) {
    const fields: string[] = [];
    const params: unknown[] = [];
    const patch = input.patch;
    const updatedAt = patch.updatedAt || new Date().toISOString();

    const push = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.runtimeSessionId !== undefined) push('runtime_session_id', patch.runtimeSessionId);
    if (patch.branchName !== undefined) push('branch_name', patch.branchName);
    if (patch.baseCommitHash !== undefined) push('base_commit_hash', patch.baseCommitHash);
    if (patch.failureReason !== undefined) push('failure_reason', patch.failureReason);
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt);
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt);
    if (patch.claimToken !== undefined) push('claim_token', patch.claimToken);
    if (patch.claimedBy !== undefined) push('claimed_by', patch.claimedBy);
    if (patch.claimedAt !== undefined) push('claimed_at', patch.claimedAt);
    if (patch.claimExpiresAt !== undefined) push('claim_expires_at', patch.claimExpiresAt);
    if (patch.attemptCount !== undefined) push('attempt_count', patch.attemptCount);
    if (patch.maxAttempts !== undefined) push('max_attempts', patch.maxAttempts);
    if (patch.nextAttemptAt !== undefined) push('next_attempt_at', patch.nextAttemptAt);
    if (patch.lastHeartbeatAt !== undefined) push('last_heartbeat_at', patch.lastHeartbeatAt);
    if (patch.lastErrorCode !== undefined) push('last_error_code', patch.lastErrorCode);
    if (patch.lastErrorSummary !== undefined) push('last_error_summary', patch.lastErrorSummary);
    push('updated_at', updatedAt);

    const where: string[] = ['id = ?'];
    const whereParams: unknown[] = [input.id];

    if (input.expectedStatus) {
      where.push('status = ?');
      whereParams.push(input.expectedStatus);
    }

    if (input.expectedStatuses?.length) {
      where.push(`status IN (${input.expectedStatuses.map(() => '?').join(', ')})`);
      whereParams.push(...input.expectedStatuses);
    }

    if (input.expectedClaimToken !== undefined) {
      if (input.expectedClaimToken === null) {
        where.push('claim_token IS NULL');
      } else {
        where.push('claim_token = ?');
        whereParams.push(input.expectedClaimToken);
      }
    }

    const result = this.db
      .prepare(`UPDATE execution_jobs SET ${fields.join(', ')} WHERE ${where.join(' AND ')}`)
      .run(...params, ...whereParams);

    if (result.changes === 0) return null;
    return this.getById(input.id);
  }

  create(input: CreateExecutionJobInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const updatedAt = input.updatedAt || createdAt;
    const status = input.status || 'pending';
    const attemptCount = input.attemptCount ?? 0;
    const maxAttempts = input.maxAttempts ?? DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS;
    const nextAttemptAt = input.nextAttemptAt === undefined ? createdAt : input.nextAttemptAt;
    const lastHeartbeatAt = input.lastHeartbeatAt ?? input.startedAt ?? null;

    this.db
      .prepare(
        `
          INSERT INTO execution_jobs (
            id,
            task_id,
            project_id,
            agent_id,
            agent_config_id,
            execution_harness,
            execution_profile,
            provider,
            model,
            provider_profile,
            tool_calling_mode,
            allowed_tools_json,
            fallbacks_json,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.taskId,
        input.projectId,
        input.agentId,
        input.agentConfigId || null,
        input.executionHarness,
        input.executionProfile || null,
        input.provider || null,
        input.model || null,
        input.providerProfile || null,
        input.toolMode || 'none',
        JSON.stringify(input.allowedTools || []),
        JSON.stringify(input.fallbacks || []),
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
        null,
        null,
        null,
        null,
        attemptCount,
        maxAttempts,
        nextAttemptAt,
        lastHeartbeatAt,
        input.lastErrorCode || null,
        input.lastErrorSummary || null,
        createdAt,
        input.startedAt || null,
        input.finishedAt || null,
        updatedAt,
      );

    return this.getById(input.id);
  }

  getById(id: string) {
    return this.getOne('WHERE id = ? LIMIT 1', [id]);
  }

  getByRuntimeSessionId(runtimeSessionId: string) {
    return this.getOne('WHERE runtime_session_id = ? LIMIT 1', [runtimeSessionId]);
  }

  listByStatuses(statuses: ExecutionJobStatus[], limit = 20) {
    if (statuses.length === 0) return [];

    const rows = this.db
      .prepare(
        `
          ${ExecutionJobsRepository.selectSql}
          WHERE status IN (${statuses.map(() => '?').join(', ')})
          ORDER BY updated_at ASC, created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(...statuses, limit) as Record<string, unknown>[];

    return rows.map((row) => mapExecutionJob(row)).filter(Boolean) as ExecutionJobRecord[];
  }

  findActiveByTaskId(taskId: string) {
    return this.getOne(
      "WHERE task_id = ? AND status IN ('pending', 'claimed', 'running', 'review') ORDER BY created_at DESC, id DESC LIMIT 1",
      [taskId],
    );
  }

  listRunnable(now: string, limit = 20) {
    const rows = this.db
      .prepare(
        `
          ${ExecutionJobsRepository.selectSql}
          WHERE status = 'pending'
            AND COALESCE(next_attempt_at, created_at) <= ?
          ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(now, limit) as Record<string, unknown>[];

    return rows.map((row) => mapExecutionJob(row)).filter(Boolean) as ExecutionJobRecord[];
  }

  listExpiredClaims(now: string, limit = 20) {
    const rows = this.db
      .prepare(
        `
          ${ExecutionJobsRepository.selectSql}
          WHERE status = 'claimed'
            AND claim_expires_at IS NOT NULL
            AND claim_expires_at <= ?
          ORDER BY claim_expires_at ASC, created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(now, limit) as Record<string, unknown>[];

    return rows.map((row) => mapExecutionJob(row)).filter(Boolean) as ExecutionJobRecord[];
  }

  claim(input: ClaimExecutionJobInput) {
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claim = this.db.transaction((jobId: string) => {
      const candidate = this.getOne(
        "WHERE id = ? AND status = 'pending' AND COALESCE(next_attempt_at, created_at) <= ? LIMIT 1",
        [jobId, claimedAt],
      );
      if (!candidate) return null;

      return this.updateFields({
        id: jobId,
        expectedStatus: 'pending',
        patch: {
          status: 'claimed',
          claimToken: input.claimToken,
          claimedBy: input.workerId,
          claimedAt,
          claimExpiresAt: input.claimExpiresAt,
          lastHeartbeatAt: claimedAt,
          failureReason: null,
        },
      });
    });

    return claim(input.id);
  }

  claimNext(input: ClaimNextExecutionJobInput) {
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claimNext = this.db.transaction(() => {
      const candidate = this.getOne(
        "WHERE status = 'pending' AND COALESCE(next_attempt_at, created_at) <= ? ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC, id ASC LIMIT 1",
        [claimedAt],
      );
      if (!candidate) return null;

      return this.updateFields({
        id: candidate.id,
        expectedStatus: 'pending',
        patch: {
          status: 'claimed',
          claimToken: input.claimToken,
          claimedBy: input.workerId,
          claimedAt,
          claimExpiresAt: input.claimExpiresAt,
          lastHeartbeatAt: claimedAt,
          failureReason: null,
        },
      });
    });

    return claimNext();
  }

  heartbeatClaim(input: {
    id: string;
    claimToken: string;
    claimExpiresAt: string;
    heartbeatAt?: string;
  }) {
    const heartbeatAt = input.heartbeatAt || new Date().toISOString();
    return this.updateFields({
      id: input.id,
      expectedStatus: 'claimed',
      expectedClaimToken: input.claimToken,
      patch: {
        claimExpiresAt: input.claimExpiresAt,
        lastHeartbeatAt: heartbeatAt,
      },
    });
  }

  updateStatus(input: UpdateExecutionJobStatusInput) {
    return this.updateFields({
      id: input.id,
      patch: {
        status: input.status,
        runtimeSessionId: input.runtimeSessionId,
        branchName: input.branchName,
        baseCommitHash: input.baseCommitHash,
        failureReason: input.failureReason,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        claimToken: input.claimToken,
        claimedBy: input.claimedBy,
        claimedAt: input.claimedAt,
        claimExpiresAt: input.claimExpiresAt,
        attemptCount: input.attemptCount,
        maxAttempts: input.maxAttempts,
        nextAttemptAt: input.nextAttemptAt,
        lastHeartbeatAt: input.lastHeartbeatAt,
        lastErrorCode: input.lastErrorCode,
        lastErrorSummary: input.lastErrorSummary,
      },
    });
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

class ExecutionReviewsRepository {
  private static readonly selectSql = `
    SELECT
      id,
      execution_job_id AS executionJobId,
      task_id AS taskId,
      runtime_session_id AS runtimeSessionId,
      reviewer_agent_id AS reviewerAgentId,
      provider,
      model,
      status,
      summary,
      findings_json AS findingsJson,
      input_json AS inputJson,
      rework_task_id AS reworkTaskId,
      claim_token AS claimToken,
      claimed_by AS claimedBy,
      claimed_at AS claimedAt,
      claim_expires_at AS claimExpiresAt,
      attempt_count AS attemptCount,
      max_attempts AS maxAttempts,
      next_attempt_at AS nextAttemptAt,
      last_error AS lastError,
      created_at AS createdAt,
      started_at AS startedAt,
      finished_at AS finishedAt,
      updated_at AS updatedAt
    FROM execution_reviews
  `;

  constructor(private readonly db: RalphitoDatabase) {}

  private getOne(whereSql: string, params: unknown[]) {
    const row = this.db
      .prepare(`${ExecutionReviewsRepository.selectSql} ${whereSql}`)
      .get(...params) as Record<string, unknown> | undefined;

    return mapExecutionReview(row);
  }

  private updateFields(input: {
    id: string;
    patch: {
      status?: ExecutionReviewStatus | undefined;
      provider?: string | null | undefined;
      model?: string | null | undefined;
      summary?: string | null | undefined;
      findingsJson?: string | null | undefined;
      inputJson?: string | null | undefined;
      reworkTaskId?: string | null | undefined;
      claimToken?: string | null | undefined;
      claimedBy?: string | null | undefined;
      claimedAt?: string | null | undefined;
      claimExpiresAt?: string | null | undefined;
      attemptCount?: number | undefined;
      maxAttempts?: number | undefined;
      nextAttemptAt?: string | null | undefined;
      lastError?: string | null | undefined;
      startedAt?: string | null | undefined;
      finishedAt?: string | null | undefined;
      updatedAt?: string | undefined;
    };
    expectedStatus?: ExecutionReviewStatus;
    expectedStatuses?: ExecutionReviewStatus[];
    expectedClaimToken?: string | null;
  }) {
    const fields: string[] = [];
    const params: unknown[] = [];
    const patch = input.patch;
    const updatedAt = patch.updatedAt || new Date().toISOString();

    const push = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.provider !== undefined) push('provider', patch.provider);
    if (patch.model !== undefined) push('model', patch.model);
    if (patch.summary !== undefined) push('summary', patch.summary);
    if (patch.findingsJson !== undefined) push('findings_json', patch.findingsJson);
    if (patch.inputJson !== undefined) push('input_json', patch.inputJson);
    if (patch.reworkTaskId !== undefined) push('rework_task_id', patch.reworkTaskId);
    if (patch.claimToken !== undefined) push('claim_token', patch.claimToken);
    if (patch.claimedBy !== undefined) push('claimed_by', patch.claimedBy);
    if (patch.claimedAt !== undefined) push('claimed_at', patch.claimedAt);
    if (patch.claimExpiresAt !== undefined) push('claim_expires_at', patch.claimExpiresAt);
    if (patch.attemptCount !== undefined) push('attempt_count', patch.attemptCount);
    if (patch.maxAttempts !== undefined) push('max_attempts', patch.maxAttempts);
    if (patch.nextAttemptAt !== undefined) push('next_attempt_at', patch.nextAttemptAt);
    if (patch.lastError !== undefined) push('last_error', patch.lastError);
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt);
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt);
    push('updated_at', updatedAt);

    const where: string[] = ['id = ?'];
    const whereParams: unknown[] = [input.id];

    if (input.expectedStatus) {
      where.push('status = ?');
      whereParams.push(input.expectedStatus);
    }

    if (input.expectedStatuses?.length) {
      where.push(`status IN (${input.expectedStatuses.map(() => '?').join(', ')})`);
      whereParams.push(...input.expectedStatuses);
    }

    if (input.expectedClaimToken !== undefined) {
      if (input.expectedClaimToken === null) {
        where.push('claim_token IS NULL');
      } else {
        where.push('claim_token = ?');
        whereParams.push(input.expectedClaimToken);
      }
    }

    const result = this.db
      .prepare(`UPDATE execution_reviews SET ${fields.join(', ')} WHERE ${where.join(' AND ')}`)
      .run(...params, ...whereParams);

    if (result.changes === 0) return null;
    return this.getById(input.id);
  }

  upsert(input: UpsertExecutionReviewInput) {
    const createdAt = input.createdAt || new Date().toISOString();
    const updatedAt = input.updatedAt || createdAt;
    const status = input.status || 'pending';
    const attemptCount = input.attemptCount ?? 0;
    const maxAttempts = input.maxAttempts ?? DEFAULT_EXECUTION_JOB_MAX_ATTEMPTS;
    const nextAttemptAt = input.nextAttemptAt === undefined ? createdAt : input.nextAttemptAt;

    this.db
      .prepare(
        `
          INSERT INTO execution_reviews (
            id,
            execution_job_id,
            task_id,
            runtime_session_id,
            reviewer_agent_id,
            provider,
            model,
            status,
            summary,
            findings_json,
            input_json,
            rework_task_id,
            claim_token,
            claimed_by,
            claimed_at,
            claim_expires_at,
            attempt_count,
            max_attempts,
            next_attempt_at,
            last_error,
            created_at,
            started_at,
            finished_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(execution_job_id)
          DO UPDATE SET
            runtime_session_id = excluded.runtime_session_id,
            reviewer_agent_id = excluded.reviewer_agent_id,
            summary = COALESCE(excluded.summary, execution_reviews.summary),
            findings_json = COALESCE(excluded.findings_json, execution_reviews.findings_json),
            input_json = COALESCE(excluded.input_json, execution_reviews.input_json),
            next_attempt_at = COALESCE(excluded.next_attempt_at, execution_reviews.next_attempt_at),
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.id,
        input.executionJobId,
        input.taskId,
        input.runtimeSessionId || null,
        input.reviewerAgentId,
        input.provider || null,
        input.model || null,
        status,
        input.summary || null,
        input.findingsJson || null,
        input.inputJson || null,
        input.reworkTaskId || null,
        input.claimToken || null,
        input.claimedBy || null,
        input.claimedAt || null,
        input.claimExpiresAt || null,
        attemptCount,
        maxAttempts,
        nextAttemptAt,
        input.lastError || null,
        createdAt,
        input.startedAt || null,
        input.finishedAt || null,
        updatedAt,
      );

    return this.getByExecutionJobId(input.executionJobId);
  }

  getById(id: string) {
    return this.getOne('WHERE id = ? LIMIT 1', [id]);
  }

  getByExecutionJobId(executionJobId: string) {
    return this.getOne('WHERE execution_job_id = ? LIMIT 1', [executionJobId]);
  }

  getLatestByTaskId(taskId: string) {
    return this.getOne('WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [taskId]);
  }

  listByStatuses(statuses: ExecutionReviewStatus[], limit = 20) {
    if (statuses.length === 0) return [];

    const rows = this.db
      .prepare(
        `
          ${ExecutionReviewsRepository.selectSql}
          WHERE status IN (${statuses.map(() => '?').join(', ')})
          ORDER BY updated_at ASC, created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(...statuses, limit) as Record<string, unknown>[];

    return rows.map((row) => mapExecutionReview(row)).filter(Boolean) as ExecutionReviewRecord[];
  }

  listExpiredClaims(now: string, limit = 20) {
    const rows = this.db
      .prepare(
        `
          ${ExecutionReviewsRepository.selectSql}
          WHERE status = 'claimed'
            AND claim_expires_at IS NOT NULL
            AND claim_expires_at <= ?
          ORDER BY claim_expires_at ASC, created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(now, limit) as Record<string, unknown>[];

    return rows.map((row) => mapExecutionReview(row)).filter(Boolean) as ExecutionReviewRecord[];
  }

  claim(input: ClaimExecutionReviewInput) {
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claim = this.db.transaction((reviewId: string) => {
      const candidate = this.getOne(
        "WHERE id = ? AND status = 'pending' AND COALESCE(next_attempt_at, created_at) <= ? LIMIT 1",
        [reviewId, claimedAt],
      );
      if (!candidate) return null;

      return this.updateFields({
        id: reviewId,
        expectedStatus: 'pending',
        patch: {
          status: 'claimed',
          claimToken: input.claimToken,
          claimedBy: input.workerId,
          claimedAt,
          claimExpiresAt: input.claimExpiresAt,
          lastError: null,
        },
      });
    });

    return claim(input.id);
  }

  claimNext(input: ClaimNextExecutionReviewInput) {
    const claimedAt = input.claimedAt || new Date().toISOString();
    const claimNext = this.db.transaction(() => {
      const candidate = this.getOne(
        "WHERE status = 'pending' AND COALESCE(next_attempt_at, created_at) <= ? ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC, id ASC LIMIT 1",
        [claimedAt],
      );
      if (!candidate) return null;

      return this.updateFields({
        id: candidate.id,
        expectedStatus: 'pending',
        patch: {
          status: 'claimed',
          claimToken: input.claimToken,
          claimedBy: input.workerId,
          claimedAt,
          claimExpiresAt: input.claimExpiresAt,
          lastError: null,
        },
      });
    });

    return claimNext();
  }

  updateStatus(input: UpdateExecutionReviewStatusInput) {
    return this.updateFields({
      id: input.id,
      patch: {
        status: input.status,
        provider: input.provider,
        model: input.model,
        summary: input.summary,
        findingsJson: input.findingsJson,
        inputJson: input.inputJson,
        reworkTaskId: input.reworkTaskId,
        claimToken: input.claimToken,
        claimedBy: input.claimedBy,
        claimedAt: input.claimedAt,
        claimExpiresAt: input.claimExpiresAt,
        attemptCount: input.attemptCount,
        maxAttempts: input.maxAttempts,
        nextAttemptAt: input.nextAttemptAt,
        lastError: input.lastError,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
      },
    });
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
  executionReviews: ExecutionReviewsRepository;
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
    executionReviews: new ExecutionReviewsRepository(db),
  };

  return repositories;
}

export function resetRalphitoRepositories() {
  repositories = null;
}
