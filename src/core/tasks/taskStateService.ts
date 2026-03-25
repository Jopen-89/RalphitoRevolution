import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import { refreshRuntimeSessionSummary, refreshTaskSummary } from '../memory/summaryService.js';

export type RalphitoTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'failed' | 'cancelled';

interface TraceabilityBead {
  id: string;
  component?: string;
  status?: string;
}

interface TraceabilitySnapshot {
  feature_name?: string;
  status?: string;
  beads?: TraceabilityBead[];
}

interface TaskRow {
  id: string;
  title: string;
  componentPath: string | null;
  status: RalphitoTaskStatus;
}

export interface UpdateTaskStatusInput {
  sourceSpecPath: string;
  taskId: string;
  status: RalphitoTaskStatus;
  assignedAgent?: string;
  runtimeSessionId?: string;
  failureReason?: string;
}

interface TaskSummaryCounts {
  pending: number;
  inProgress: number;
  blocked: number;
  done: number;
  failed: number;
  cancelled: number;
}

interface StatusCountRow {
  status: RalphitoTaskStatus;
  count: number;
}

const TRACEABILITY_TO_DB_STATUS: Record<string, RalphitoTaskStatus> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  COMPLETED: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const DB_TO_TRACEABILITY_STATUS: Record<RalphitoTaskStatus, string> = {
  pending: 'PENDING',
  in_progress: 'IN_PROGRESS',
  blocked: 'BLOCKED',
  done: 'DONE',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

function normalizeSourceSpecPath(sourceSpecPath: string) {
  return path.resolve(sourceSpecPath);
}

function getProjectKeyFromTraceabilityPath(sourceSpecPath: string) {
  return path.basename(path.dirname(normalizeSourceSpecPath(sourceSpecPath)));
}

function mapTraceabilityStatus(status?: string): RalphitoTaskStatus {
  return TRACEABILITY_TO_DB_STATUS[(status || 'PENDING').toUpperCase()] || 'pending';
}

function mapDbStatus(status: RalphitoTaskStatus) {
  return DB_TO_TRACEABILITY_STATUS[status];
}

function readTraceabilitySnapshot(sourceSpecPath: string): TraceabilitySnapshot {
  return JSON.parse(readFileSync(sourceSpecPath, 'utf8')) as TraceabilitySnapshot;
}

export function syncTasksFromTraceability(sourceSpecPath: string) {
  const db = getRalphitoDatabase();
  const resolvedSourceSpecPath = normalizeSourceSpecPath(sourceSpecPath);
  const snapshot = readTraceabilitySnapshot(resolvedSourceSpecPath);
  const projectKey = getProjectKeyFromTraceabilityPath(resolvedSourceSpecPath);
  const now = new Date().toISOString();

  const upsertTask = db.prepare(
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
      ON CONFLICT(id)
      DO UPDATE SET
        project_key = excluded.project_key,
        title = excluded.title,
        source_spec_path = excluded.source_spec_path,
        component_path = excluded.component_path,
        status = COALESCE(tasks.status, excluded.status),
        updated_at = excluded.updated_at
    `,
  );

  const syncTransaction = db.transaction(() => {
    for (const bead of snapshot.beads || []) {
      const status = mapTraceabilityStatus(bead.status);
      const completedAt = status === 'done' ? now : null;

      upsertTask.run(
        bead.id,
        projectKey,
        bead.id,
        resolvedSourceSpecPath,
        bead.component || null,
        status,
        null,
        null,
        'medium',
        now,
        now,
        completedAt,
      );
    }
  });

  syncTransaction();
}

export function updateTaskStatus(input: UpdateTaskStatusInput) {
  const db = getRalphitoDatabase();
  const now = new Date().toISOString();
  const resolvedSourceSpecPath = normalizeSourceSpecPath(input.sourceSpecPath);
  const completedAt = input.status === 'done' ? now : null;
  const eventPayload = JSON.stringify({
    sourceSpecPath: resolvedSourceSpecPath,
    assignedAgent: input.assignedAgent || null,
    runtimeSessionId: input.runtimeSessionId || null,
    failureReason: input.failureReason || null,
    status: input.status,
  });

  const updateTransaction = db.transaction(() => {
    db.prepare(
      `
        UPDATE tasks
        SET status = ?,
            source_spec_path = ?,
            assigned_agent = COALESCE(?, assigned_agent),
            runtime_session_id = COALESCE(?, runtime_session_id),
            updated_at = ?,
            completed_at = ?
        WHERE id = ?
      `,
    ).run(
      input.status,
      resolvedSourceSpecPath,
      input.assignedAgent || null,
      input.runtimeSessionId || null,
      now,
      completedAt,
      input.taskId,
    );

    db.prepare(
      'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
    ).run(input.taskId, 'status_changed', eventPayload, now);
  });

  updateTransaction();

  refreshTaskSummary(input.taskId);
  if (input.runtimeSessionId) {
    refreshRuntimeSessionSummary(input.runtimeSessionId);
  }
}

export function exportTraceabilitySnapshot(sourceSpecPath: string) {
  const db = getRalphitoDatabase();
  const resolvedSourceSpecPath = normalizeSourceSpecPath(sourceSpecPath);
  const projectKey = getProjectKeyFromTraceabilityPath(resolvedSourceSpecPath);
  const rows = db
    .prepare(
      `
        SELECT id, title, component_path AS componentPath, status
        FROM tasks
        WHERE project_key = ? AND source_spec_path = ?
        ORDER BY id ASC
      `,
    )
    .all(projectKey, resolvedSourceSpecPath) as TaskRow[];

  const allDone = rows.length > 0 && rows.every((row) => row.status === 'done');

  const snapshot = {
    feature_name: projectKey,
    status: allDone ? 'COMPLETED' : 'IN_PROGRESS',
    beads: rows.map((row) => ({
      id: row.id,
      component: row.componentPath || undefined,
      status: mapDbStatus(row.status),
    })),
  };

  writeFileSync(resolvedSourceSpecPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  return snapshot;
}

export function getTaskStatusSummary() {
  const db = getRalphitoDatabase();
  const rows = db
    .prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY status ASC')
    .all() as StatusCountRow[];
  const counts: TaskSummaryCounts = {
    pending: 0,
    inProgress: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const row of rows) {
    if (row.status === 'pending') counts.pending = row.count;
    if (row.status === 'in_progress') counts.inProgress = row.count;
    if (row.status === 'blocked') counts.blocked = row.count;
    if (row.status === 'done') counts.done = row.count;
    if (row.status === 'failed') counts.failed = row.count;
    if (row.status === 'cancelled') counts.cancelled = row.count;
  }

  const openTasks = db
    .prepare(
      `
        SELECT id, project_key AS projectKey, status, assigned_agent AS assignedAgent, runtime_session_id AS runtimeSessionId
        FROM tasks
        WHERE status NOT IN ('done', 'cancelled')
        ORDER BY updated_at ASC, id ASC
      `,
    )
    .all() as Array<{
      id: string;
      projectKey: string;
      status: RalphitoTaskStatus;
      assignedAgent: string | null;
      runtimeSessionId: string | null;
    }>;

  return {
    counts,
    openTasks,
    allDone:
      openTasks.length === 0 &&
      (counts.done > 0 || counts.failed > 0 || counts.cancelled > 0 || rows.length === 0),
  };
}
