import path from 'path';
import type { RalphitoTaskStatus } from '../services/taskStateService.js';
import { ProjectService } from '../services/ProjectService.js';
import { BeadLifecycleService, type LifecycleTaskRecord } from '../services/BeadLifecycleService.js';

export interface RuntimeTaskLinkInput {
  runtimeSessionId: string;
  projectId?: string | null;
  taskId?: string | null;
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

function mapTaskRow(row: Record<string, unknown> | LifecycleTaskRecord | null | undefined): RuntimeTaskLinkRecord | null {
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
  const linkedTask = mapTaskRow(BeadLifecycleService.resolveTask({ runtimeSessionId: input.runtimeSessionId }));

  if (linkedTask) return linkedTask;

  if (input.taskId) {
    const directTask = mapTaskRow(BeadLifecycleService.resolveTask({ taskId: input.taskId }));
    if (directTask) return directTask;
  }

  if (input.workItemKey) {
    const workItemTask = mapTaskRow(BeadLifecycleService.resolveTask({ taskId: input.workItemKey }));

    if (workItemTask) return workItemTask;
  }

  const sourceSpecPath = resolveRuntimeTaskSourceSpecPath(input.projectId, input.beadPath);
  if (!sourceSpecPath) return null;

  return mapTaskRow(
    BeadLifecycleService.resolveTask({
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      beadPath: sourceSpecPath,
    }),
  );
}

export function syncRuntimeTaskLink(input: RuntimeTaskLinkInput): RuntimeTaskLinkRecord | null {
  const task = findRuntimeTaskLink(input);
  if (!task || !input.status) return task;

  const updated = BeadLifecycleService.transitionTask({
    taskId: task.id,
    status: input.status,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.assignedAgent ? { assignedAgent: input.assignedAgent } : {}),
    ...(input.runtimeSessionId ? { runtimeSessionIdToSet: input.runtimeSessionId } : {}),
    ...(input.beadPath ? { beadPath: input.beadPath } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  });

  return mapTaskRow(updated);
}
