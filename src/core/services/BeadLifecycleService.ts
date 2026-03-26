import path from 'path';
import {
  getRalphitoDatabase,
  getRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import type { TaskPriority, TaskStatus } from '../../infrastructure/persistence/db/repositories.js';
import { refreshRuntimeSessionSummary, refreshTaskSummary } from './summaryService.js';

export interface CreateLifecycleTaskInput {
  taskId: string;
  title: string;
  projectId: string;
  projectKey?: string;
  beadPath?: string | null;
  sourceSpecPath?: string | null;
  componentPath?: string | null;
  assignedAgent?: string | null;
  runtimeSessionId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface TaskLifecycleTransitionInput {
  taskId?: string;
  runtimeSessionId?: string;
  beadPath?: string | null;
  projectId?: string | null;
  status: TaskStatus;
  assignedAgent?: string | null;
  runtimeSessionIdToSet?: string | null;
  sourceSpecPath?: string | null;
  failureReason?: string | null;
  eventType?: string;
}

export interface LifecycleTaskRecord {
  id: string;
  projectId: string | null;
  projectKey: string | null;
  title: string;
  sourceSpecPath: string | null;
  beadPath: string | null;
  componentPath: string | null;
  status: TaskStatus;
  assignedAgent: string | null;
  runtimeSessionId: string | null;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ListBacklogInput {
  projectId?: string | null;
  status?: TaskStatus | 'open' | 'all';
  priority?: TaskPriority;
  assignedAgent?: string | null;
  limit?: number;
}

export interface ListTasksBySourceSpecInput {
  projectId?: string | null;
  sourceSpecPath: string;
}

function mapLifecycleTask(row: Record<string, unknown> | undefined): LifecycleTaskRecord | null {
  if (!row) return null;

  return {
    id: String(row.id),
    projectId: row.projectId ? String(row.projectId) : null,
    projectKey: row.projectKey ? String(row.projectKey) : null,
    title: String(row.title),
    sourceSpecPath: row.sourceSpecPath ? String(row.sourceSpecPath) : null,
    beadPath: row.beadPath ? String(row.beadPath) : null,
    componentPath: row.componentPath ? String(row.componentPath) : null,
    status: row.status as TaskStatus,
    assignedAgent: row.assignedAgent ? String(row.assignedAgent) : null,
    runtimeSessionId: row.runtimeSessionId ? String(row.runtimeSessionId) : null,
    priority: row.priority as TaskPriority,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    completedAt: row.completedAt ? String(row.completedAt) : null,
  };
}

function resolveAbsoluteBeadPath(projectId?: string | null, beadPath?: string | null) {
  if (!beadPath) return null;
  if (path.isAbsolute(beadPath)) return path.resolve(beadPath);
  if (!projectId) return path.resolve(beadPath);

  const project = getRalphitoRepositories().projects.getById(projectId);
  if (!project) return path.resolve(beadPath);

  return path.resolve(project.repoPath, beadPath);
}

export class BeadLifecycleService {
  static listTasksBySourceSpec(input: ListTasksBySourceSpecInput) {
    const db = getRalphitoDatabase();
    const rows = db
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            project_key AS projectKey,
            title,
            source_spec_path AS sourceSpecPath,
            bead_path AS beadPath,
            component_path AS componentPath,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            priority,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE source_spec_path = ?
            AND (? IS NULL OR project_id = ?)
          ORDER BY updated_at ASC, id ASC
        `,
      )
      .all(input.sourceSpecPath, input.projectId || null, input.projectId || null) as Record<string, unknown>[];

    return rows.map((row) => mapLifecycleTask(row)).filter(Boolean) as LifecycleTaskRecord[];
  }

  static listBacklog(input: ListBacklogInput = {}) {
    const db = getRalphitoDatabase();
    const whereClauses: string[] = [];
    const params: Array<string | number> = [];

    if (input.projectId) {
      whereClauses.push('project_id = ?');
      params.push(input.projectId);
    }

    if (input.status && input.status !== 'all') {
      if (input.status === 'open') {
        whereClauses.push("status IN ('pending', 'in_progress', 'blocked')");
      } else {
        whereClauses.push('status = ?');
        params.push(input.status);
      }
    }

    if (input.priority) {
      whereClauses.push('priority = ?');
      params.push(input.priority);
    }

    if (input.assignedAgent) {
      whereClauses.push('assigned_agent = ?');
      params.push(input.assignedAgent);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limit = Number.isFinite(input.limit) && (input.limit as number) > 0 ? Math.floor(input.limit as number) : 20;

    const rows = db
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            project_key AS projectKey,
            title,
            source_spec_path AS sourceSpecPath,
            bead_path AS beadPath,
            component_path AS componentPath,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            priority,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt
          FROM tasks
          ${whereSql}
          ORDER BY
            CASE priority
              WHEN 'high' THEN 0
              WHEN 'medium' THEN 1
              ELSE 2
            END ASC,
            CASE status
              WHEN 'blocked' THEN 0
              WHEN 'in_progress' THEN 1
              WHEN 'pending' THEN 2
              ELSE 3
            END ASC,
            updated_at ASC,
            id ASC
          LIMIT ?
        `,
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows.map((row) => mapLifecycleTask(row)).filter(Boolean) as LifecycleTaskRecord[];
  }

  static createOrUpdateTask(input: CreateLifecycleTaskInput) {
    const existing = this.getTaskById(input.taskId);
    if (!existing) {
      return this.createTask(input);
    }

    const db = getRalphitoDatabase();
    const now = new Date().toISOString();
    const projectId = input.projectId || existing.projectId || 'system';
    const sourceSpecPath = input.sourceSpecPath || resolveAbsoluteBeadPath(projectId, input.beadPath) || existing.sourceSpecPath;
    const beadPath =
      resolveAbsoluteBeadPath(projectId, input.beadPath || input.sourceSpecPath || null) ||
      existing.beadPath ||
      sourceSpecPath;
    const status = existing.status || input.status || 'pending';

    db.prepare(
      `
        UPDATE tasks
        SET project_key = ?,
            project_id = ?,
            title = ?,
            source_spec_path = ?,
            bead_path = ?,
            component_path = ?,
            updated_at = ?
        WHERE id = ?
      `,
    ).run(
      input.projectKey || projectId,
      projectId,
      input.title,
      sourceSpecPath || null,
      beadPath || null,
      input.componentPath || existing.componentPath || null,
      now,
      input.taskId,
    );

    getRalphitoRepositories().taskEvents.append({
      taskId: input.taskId,
      eventType: 'task_synced',
      payloadJson: JSON.stringify({
        projectId,
        projectKey: input.projectKey || projectId,
        beadPath,
        sourceSpecPath,
        status,
      }),
    });

    refreshTaskSummary(input.taskId);

    return this.getTaskById(input.taskId);
  }

  static createTask(input: CreateLifecycleTaskInput) {
    const repos = getRalphitoRepositories();
    const projectId = input.projectId;
    const sourceSpecPath = input.sourceSpecPath || resolveAbsoluteBeadPath(projectId, input.beadPath);
    const beadPath = resolveAbsoluteBeadPath(projectId, input.beadPath || input.sourceSpecPath || null);
    const status = input.status || 'pending';

    repos.tasks.create({
      id: input.taskId,
      projectKey: input.projectKey || projectId,
      projectId,
      title: input.title,
      status,
      ...(sourceSpecPath ? { sourceSpecPath } : {}),
      ...(beadPath ? { beadPath } : {}),
      ...(input.componentPath ? { componentPath: input.componentPath } : {}),
      ...(input.assignedAgent ? { assignedAgent: input.assignedAgent } : {}),
      ...(input.runtimeSessionId ? { runtimeSessionId: input.runtimeSessionId } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
    });

    repos.taskEvents.append({
      taskId: input.taskId,
      eventType: 'task_created',
      payloadJson: JSON.stringify({
        projectId,
        projectKey: input.projectKey || projectId,
        beadPath,
        sourceSpecPath,
        status,
      }),
    });

    refreshTaskSummary(input.taskId);
    if (input.runtimeSessionId) {
      refreshRuntimeSessionSummary(input.runtimeSessionId);
    }

    return this.getTaskById(input.taskId);
  }

  static getTaskById(taskId: string) {
    const row = getRalphitoDatabase()
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            project_key AS projectKey,
            title,
            source_spec_path AS sourceSpecPath,
            bead_path AS beadPath,
            component_path AS componentPath,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            priority,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(taskId) as Record<string, unknown> | undefined;

    return mapLifecycleTask(row);
  }

  static resolveTask(input: Pick<TaskLifecycleTransitionInput, 'taskId' | 'runtimeSessionId' | 'beadPath' | 'projectId'>) {
    const db = getRalphitoDatabase();

    if (input.taskId) {
      return this.getTaskById(input.taskId);
    }

    if (input.runtimeSessionId) {
      const row = db
        .prepare(
          `
            SELECT
              id,
              project_id AS projectId,
              project_key AS projectKey,
              title,
              source_spec_path AS sourceSpecPath,
              bead_path AS beadPath,
              component_path AS componentPath,
              status,
              assigned_agent AS assignedAgent,
              runtime_session_id AS runtimeSessionId,
              priority,
              created_at AS createdAt,
              updated_at AS updatedAt,
              completed_at AS completedAt
            FROM tasks
            WHERE runtime_session_id = ?
            LIMIT 1
          `,
        )
        .get(input.runtimeSessionId) as Record<string, unknown> | undefined;

      const task = mapLifecycleTask(row);
      if (task) return task;
    }

    const absoluteBeadPath = resolveAbsoluteBeadPath(input.projectId, input.beadPath || null);
    if (!absoluteBeadPath) return null;

    const row = db
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            project_key AS projectKey,
            title,
            source_spec_path AS sourceSpecPath,
            bead_path AS beadPath,
            component_path AS componentPath,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId,
            priority,
            created_at AS createdAt,
            updated_at AS updatedAt,
            completed_at AS completedAt
          FROM tasks
          WHERE bead_path = ? OR source_spec_path = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(absoluteBeadPath, absoluteBeadPath) as Record<string, unknown> | undefined;

    return mapLifecycleTask(row);
  }

  static transitionTask(input: TaskLifecycleTransitionInput) {
    const db = getRalphitoDatabase();
    const task = this.resolveTask(input);
    if (!task) return null;

    const now = new Date().toISOString();
    const completedAt = input.status === 'done' ? now : null;
    const sourceSpecPath = input.sourceSpecPath || task.sourceSpecPath || resolveAbsoluteBeadPath(input.projectId || task.projectId, input.beadPath || null);
    const beadPath =
      resolveAbsoluteBeadPath(input.projectId || task.projectId, input.beadPath || null) ||
      task.beadPath ||
      sourceSpecPath;
    const runtimeSessionId = input.runtimeSessionIdToSet || input.runtimeSessionId || task.runtimeSessionId;
    const eventType = input.eventType || 'status_changed';
    const eventPayload = JSON.stringify({
      projectId: input.projectId || task.projectId,
      beadPath: beadPath || null,
      sourceSpecPath: sourceSpecPath || null,
      assignedAgent: input.assignedAgent || task.assignedAgent,
      runtimeSessionId: runtimeSessionId || null,
      failureReason: input.failureReason || null,
      status: input.status,
    });

    const transaction = db.transaction(() => {
      db.prepare(
        `
          UPDATE tasks
          SET status = ?,
              project_id = COALESCE(?, project_id),
              assigned_agent = COALESCE(?, assigned_agent),
              runtime_session_id = COALESCE(?, runtime_session_id),
              source_spec_path = COALESCE(?, source_spec_path),
              bead_path = COALESCE(?, bead_path),
              updated_at = ?,
              completed_at = ?
          WHERE id = ?
        `,
      ).run(
        input.status,
        input.projectId || task.projectId || null,
        input.assignedAgent || null,
        runtimeSessionId || null,
        sourceSpecPath || null,
        beadPath || null,
        now,
        completedAt,
        task.id,
      );

      db.prepare(
        'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
      ).run(task.id, eventType, eventPayload, now);
    });

    transaction();
    refreshTaskSummary(task.id);
    if (runtimeSessionId) {
      refreshRuntimeSessionSummary(runtimeSessionId);
    }

    return this.getTaskById(task.id);
  }

  static setTaskPriority(input: {
    taskId?: string;
    beadPath?: string | null;
    projectId?: string | null;
    priority: TaskPriority;
  }) {
    const db = getRalphitoDatabase();
    const task = this.resolveTask({
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.beadPath ? { beadPath: input.beadPath } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
    if (!task) return null;

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `
          UPDATE tasks
          SET priority = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(input.priority, now, task.id);

      db.prepare(
        'INSERT INTO task_events (task_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)',
      ).run(
        task.id,
        'task_reprioritized',
        JSON.stringify({ priority: input.priority, projectId: input.projectId || task.projectId || null }),
        now,
      );
    })();

    refreshTaskSummary(task.id);
    return this.getTaskById(task.id);
  }

  static startTask(input: Omit<TaskLifecycleTransitionInput, 'status' | 'eventType'>) {
    return this.transitionTask({ ...input, status: 'in_progress', eventType: 'task_started' });
  }

  static blockTask(input: Omit<TaskLifecycleTransitionInput, 'status' | 'eventType'>) {
    return this.transitionTask({ ...input, status: 'blocked', eventType: 'task_blocked' });
  }

  static failTask(input: Omit<TaskLifecycleTransitionInput, 'status' | 'eventType'>) {
    return this.transitionTask({ ...input, status: 'failed', eventType: 'task_failed' });
  }

  static completeTask(input: Omit<TaskLifecycleTransitionInput, 'status' | 'eventType'>) {
    return this.transitionTask({ ...input, status: 'done', eventType: 'task_completed' });
  }

  static cancelTask(input: Omit<TaskLifecycleTransitionInput, 'status' | 'eventType'>) {
    return this.transitionTask({ ...input, status: 'cancelled', eventType: 'task_cancelled' });
  }
}
