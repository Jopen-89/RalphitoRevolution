import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
} from '../persistence/db/index.js';
import { findRuntimeTaskLink, syncRuntimeTaskLink } from './runtimeTaskLinking.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDatabase<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const runtimeRoot = createTempDirectory('rr-runtime-task-link-');

  process.env.RALPHITO_DB_PATH = path.join(runtimeRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  closeRalphitoDatabase();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      if (previousDbPath) {
        process.env.RALPHITO_DB_PATH = previousDbPath;
      } else {
        delete process.env.RALPHITO_DB_PATH;
      }
      rmSync(runtimeRoot, { force: true, recursive: true });
    });
}

function insertTask(input: {
  id: string;
  title: string;
  sourceSpecPath: string | null;
  status?: string;
}) {
  const db = initializeRalphitoDatabase();
  const now = new Date().toISOString();

  db.prepare(
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
    `,
  ).run(
    input.id,
    'backend-team',
    input.title,
    input.sourceSpecPath,
    null,
    input.status || 'pending',
    null,
    null,
    'medium',
    now,
    now,
    null,
  );
}

test('syncRuntimeTaskLink liga task por beadPath y la pasa a in_progress', async () => {
  await withTempDatabase(async () => {
    const beadPath = path.join(process.cwd(), 'docs/specs/projects/test-engine/bead-02-fake-test.md');
    insertTask({
      id: 'task-bead-path',
      title: 'Prueba de Engine 02',
      sourceSpecPath: beadPath,
    });

    const linkedTask = syncRuntimeTaskLink({
      runtimeSessionId: 'be-task-link',
      projectId: 'backend-team',
      beadPath: 'docs/specs/projects/test-engine/bead-02-fake-test.md',
      assignedAgent: 'backend-team',
      status: 'in_progress',
    });

    assert.equal(linkedTask?.id, 'task-bead-path');
    assert.equal(linkedTask?.status, 'in_progress');
    assert.equal(linkedTask?.assignedAgent, 'backend-team');
    assert.equal(linkedTask?.runtimeSessionId, 'be-task-link');
  });
});

test('findRuntimeTaskLink prioriza workItemKey cuando existe task directa', async () => {
  await withTempDatabase(async () => {
    insertTask({
      id: 'task-work-item',
      title: 'Task por workItem',
      sourceSpecPath: null,
    });

    const linkedTask = syncRuntimeTaskLink({
      runtimeSessionId: 'be-task-work-item',
      projectId: 'backend-team',
      workItemKey: 'task-work-item',
      beadPath: 'docs/specs/projects/test-engine/bead-01-fake-test.md',
      assignedAgent: 'backend-team',
      status: 'done',
    });

    assert.equal(linkedTask?.id, 'task-work-item');
    assert.equal(linkedTask?.status, 'done');
    assert.equal(linkedTask?.runtimeSessionId, 'be-task-work-item');

    const foundAgain = findRuntimeTaskLink({
      runtimeSessionId: 'be-task-work-item',
      projectId: 'backend-team',
      workItemKey: null,
      beadPath: null,
    });

    assert.equal(foundAgain?.id, 'task-work-item');
    assert.equal(foundAgain?.assignedAgent, 'backend-team');
  });
});
