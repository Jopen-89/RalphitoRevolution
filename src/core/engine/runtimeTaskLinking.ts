import path from 'path';
import { refreshRuntimeSessionSummary, refreshTaskSummary } from '../services/summaryService.js';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import type { RalphitoTaskStatus } from '../services/taskStateService.js';
import { ProjectService } from '../services/ProjectService.js';

export interface RuntimeTaskLinkInput {
  runtimeSessionId: string;
  projectId?: string | null;
  workItemKey?: string | null;
  beadPath?: string | null;
  assignedAgent?: string | null;
  status?: RalphitoTaskStatus;
  failureReason?: string | null;
}

export interface RuntimeTaskLinkRecord {
  id: string;
  title: string;
  status: RalphitoTaskStatus;
  assignedAgent: string | null;
  runtimeSessionId: string | null;
  sourceSpecPath: string | null;
}

function mapTaskRow(row: Record<string, unknown> | undefined): RuntimeTaskLinkRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as RalphitoTaskStatus,
    assignedAgent: row.assignedAgent ? String(row.assignedAgent) : null,
    runtimeSessionId: row.runtimeSessionId ? String(row.runtimeSessionId) : null,
    sourceSpecPath: row.sourceSpecPath ? String(row.sourceSpecPath) : null,
  };
}

export function resolveRuntimeTaskSourceSpecPath(projectId?: string | null, beadPath?: string | null) {
  if (!beadPath) return null;
  if (path.isAbsolute(beadPath)) return path.resolve(beadPath);

  const projectRoot = projectId ? ProjectService.resolve(projectId).path : process.cwd();
  return path.resolve(projectRoot, beadPath);
}

export function deriveRuntimeTaskTitle(beadPath?: string | null) {
  if (!beadPath) return null;
  const base = path.basename(beadPath, path.extname(beadPath));
  return base.replace(/[-_]+/g, ' ').trim() || base;
}

export function findRuntimeTaskLink(input: RuntimeTaskLinkInput): RuntimeTaskLinkRecord | null {
  const db = getRalphitoDatabase();

  const linkedTask = mapTaskRow(
    db
      .prepare(
        `
          SELECT
            id,
            title,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            source_spec_path AS sourceSpecPath
          FROM tasks
          WHERE runtime_session_id = ?
          LIMIT 1
        `,
      )
      .get(input.runtimeSessionId) as Record<string, unknown> | undefined,
  );

  if (linkedTask) return linkedTask;

  if (input.workItemKey) {
    const workItemTask = mapTaskRow(
      db
        .prepare(
          `
            SELECT
              id,
              title,
              status,
              assigned_agent AS assignedAgent,
              runtime_session_id AS runtimeSessionId,
              source_spec_path AS sourceSpecPath
            FROM tasks
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(input.workItemKey) as Record<string, unknown> | undefined,
    );

    if (workItemTask) return workItemTask;
  }

  const sourceSpecPath = resolveRuntimeTaskSourceSpecPath(input.projectId, input.beadPath);
  if (!sourceSpecPath) return null;

  return mapTaskRow(
    db
      .prepare(
        `
          SELECT
            id,
            title,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            source_spec_path AS sourceSpecPath
          FROM tasks
          WHERE source_spec_path = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(sourceSpecPath) as Record<string, unknown> | undefined,
  );
}

export function syncRuntimeTaskLink(input: RuntimeTaskLinkInput): RuntimeTaskLinkRecord | null {
  const task = findRuntimeTaskLink(input);
  if (!task || !input.status) return task;

  const db = getRalphitoDatabase();
  const now = new Date().toISOString();
  const sourceSpecPath = resolveRuntimeTaskSourceSpecPath(input.projectId, input.beadPath);
  const completedAt = input.status === 'done' ? now : null;
  const eventPayload = JSON.stringify({
    sourceSpecPath,
    beadPath: input.beadPath || null,
    assignedAgent: input.assignedAgent || null,
    runtimeSessionId: input.runtimeSessionId,
    failureReason: input.failureReason || null,
    status: input.status,
  });

  db.prepare(
    `
      UPDATE tasks
      SET status = ?,
          assigned_agent = COALESCE(?, assigned_agent),
          runtime_session_id = ?,
          source_spec_path = COALESCE(source_spec_path, ?),
          updated_at = ?,
          completed_at = ?
      WHERE id = ?
    `,
  ).run(
    input.status,
    input.assignedAgent || null,
    input.runtimeSessionId,
    sourceSpecPath,
    now,
    completedAt,
    task.id,
  );

  db.prepare(
    'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
  ).run(task.id, 'status_changed', eventPayload, now);

  refreshTaskSummary(task.id);
  refreshRuntimeSessionSummary(input.runtimeSessionId);

  return findRuntimeTaskLink(input);
}
