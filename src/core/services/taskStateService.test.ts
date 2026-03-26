import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  getRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { syncTasksFromTraceability, updateTaskStatus } from './taskStateService.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: (ctx: { runtimeRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const runtimeRoot = createTempDirectory('rr-task-state-');

  process.env.RALPHITO_DB_PATH = path.join(runtimeRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ runtimeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      rmSync(runtimeRoot, { force: true, recursive: true });
    });
}

test('taskStateService syncs and transitions tasks through BeadLifecycleService', async () => {
  await withTempDb(({ runtimeRoot }) => {
    const traceabilityPath = path.join(runtimeRoot, 'docs', 'specs', 'projects', 'test-engine', 'traceability.json');
    const traceabilityDir = path.dirname(traceabilityPath);
    mkdirSync(traceabilityDir, { recursive: true });
    writeFileSync(
      traceabilityPath,
      JSON.stringify({
        feature_name: 'test-engine',
        status: 'IN_PROGRESS',
        beads: [{ id: 'bead-1', component: 'src/core/engine', status: 'PENDING' }],
      }, null, 2),
    );

    syncTasksFromTraceability(traceabilityPath);
    updateTaskStatus({
      sourceSpecPath: traceabilityPath,
      taskId: 'bead-1',
      status: 'done',
      assignedAgent: 'poncho',
      runtimeSessionId: 'runtime-1',
    });

    const db = getRalphitoDatabase();
    const task = db
      .prepare(
        `
          SELECT
            project_id AS projectId,
            bead_path AS beadPath,
            status,
            assigned_agent AS assignedAgent,
            runtime_session_id AS runtimeSessionId
          FROM tasks
          WHERE id = ?
        `,
      )
      .get('bead-1') as {
      projectId: string | null;
      beadPath: string | null;
      status: string;
      assignedAgent: string | null;
      runtimeSessionId: string | null;
    };
    const events = db
      .prepare('SELECT event_type AS eventType FROM task_events WHERE task_id = ? ORDER BY id ASC')
      .all('bead-1') as Array<{ eventType: string }>;

    assert.equal(task.projectId, 'test-engine');
    assert.equal(task.beadPath, traceabilityPath);
    assert.equal(task.status, 'done');
    assert.equal(task.assignedAgent, 'poncho');
    assert.equal(task.runtimeSessionId, 'runtime-1');
    assert.deepEqual(events.map((event) => event.eventType), ['task_created', 'status_changed']);
  });
});
