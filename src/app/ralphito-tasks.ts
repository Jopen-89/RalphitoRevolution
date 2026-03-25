#!/usr/bin/env node

import {
  exportTraceabilitySnapshot,
  getTaskStatusSummary,
  syncTasksFromTraceability,
  updateTaskStatus,
  type RalphitoTaskStatus,
} from '../core/services/taskStateService.js';
import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';

initializeRalphitoDatabase();

const [, , command, ...args] = process.argv;

const STATUS_ALIASES: Record<string, RalphitoTaskStatus> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  DONE: 'done',
  COMPLETED: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  pending: 'pending',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

function normalizeStatus(value: string) {
  const normalizedStatus = STATUS_ALIASES[value];
  if (!normalizedStatus) {
    throw new Error(`Estado no soportado: ${value}`);
  }

  return normalizedStatus;
}

function runUpdateFromTrace(traceabilityPath: string, taskId: string, rawStatus: string, assignedAgent?: string, runtimeSessionId?: string, failureReason?: string) {
  syncTasksFromTraceability(traceabilityPath);

  const status = normalizeStatus(rawStatus);

  updateTaskStatus({
    sourceSpecPath: traceabilityPath,
    taskId,
    status,
    ...(assignedAgent ? { assignedAgent } : {}),
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
    ...(failureReason ? { failureReason } : {}),
  });

  const snapshot = exportTraceabilitySnapshot(traceabilityPath);
  const allDone = snapshot.status === 'COMPLETED';

  console.log(
    JSON.stringify({
      status: 'success',
      message: allDone
        ? 'Bead actualizado en SQLite. Snapshot derivado sincronizado. PROYECTO 100% COMPLETADO.'
        : 'Bead actualizado en SQLite. Snapshot derivado sincronizado. Aún hay tareas pendientes.',
    }),
  );
}

function runStatusReport() {
  const summary = getTaskStatusSummary();

  console.log(`Counts: pending=${summary.counts.pending}, in_progress=${summary.counts.inProgress}, blocked=${summary.counts.blocked}, done=${summary.counts.done}, failed=${summary.counts.failed}, cancelled=${summary.counts.cancelled}`);

  if (summary.allDone) {
    console.log('✅ [MATEMÁTICAMENTE COMPLETADO] No quedan tasks abiertas en Ralphito SQLite.');
    return;
  }

  if (summary.openTasks.length === 0) {
    console.log('ℹ️ No hay tasks registradas todavía en Ralphito SQLite.');
    return;
  }

  console.log('Open tasks:');
  for (const task of summary.openTasks) {
    console.log(
      `- ${task.id} [${task.projectKey}] status=${task.status}` +
        `${task.assignedAgent ? ` agent=${task.assignedAgent}` : ''}` +
        `${task.runtimeSessionId ? ` session=${task.runtimeSessionId}` : ''}`,
    );
  }
}

switch (command) {
  case 'update-from-trace': {
    const [traceabilityPath, taskId, rawStatus, assignedAgent, runtimeSessionId, failureReason] = args;
    if (!traceabilityPath || !taskId || !rawStatus) {
      throw new Error('Uso: ralphito-tasks.ts update-from-trace <traceability.json> <task_id> <status> [assigned_agent] [runtime_session_id] [failure_reason]');
    }

    runUpdateFromTrace(traceabilityPath, taskId, rawStatus, assignedAgent, runtimeSessionId, failureReason);
    break;
  }
  case 'status-report':
    runStatusReport();
    break;
  default:
    throw new Error(`Comando no soportado: ${command || '<vacío>'}`);
}
