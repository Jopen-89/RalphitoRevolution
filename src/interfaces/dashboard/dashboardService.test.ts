import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { getRuntimeSessionRepository, resetRuntimeSessionRepository } from '../../core/engine/runtimeSessionRepository.js';
import { writeRuntimeSessionFile } from '../../core/engine/runtimeFiles.js';
import { getUnifiedDashboardSessionDetail } from './dashboardService.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDb<T>(fn: () => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const tmpDir = createTempDirectory('rr-dashboard-service-');
  process.env.RALPHITO_DB_PATH = path.join(tmpDir, 'ralphito.sqlite');
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeSessionRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeSessionRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      rmSync(tmpDir, { force: true, recursive: true });
    });
}

test('getUnifiedDashboardSessionDetail exposes persisted worktree path', async () => {
  await withTempDb(async () => {
    const db = initializeRalphitoDatabase();
    const now = new Date().toISOString();
    const runtimeSessionId = 'dash-worktree-1';
    const worktreePath = createTempDirectory('rr-dashboard-worktree-');
    mkdirSync(worktreePath, { recursive: true });

    const threadId = Number(
      db.prepare(
        `
          INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      ).run('runtime', runtimeSessionId, 'Runtime session', now, now).lastInsertRowid,
    );

    getRuntimeSessionRepository().create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId,
      status: 'running',
      worktreePath,
      startedAt: now,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });

    db.prepare(
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
    ).run(
      'task-dash-review',
      'backend-team',
      'backend-team',
      'Dashboard review task',
      '/tmp/dash-review.md',
      '/tmp/dash-review.md',
      null,
      'in_progress',
      'backend-team',
      runtimeSessionId,
      'medium',
      now,
      now,
      null,
    );

    db.prepare(
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
    ).run(
      'job-dash-1',
      'task-dash-review',
      'backend-team',
      'backend-team',
      'default',
      'codex',
      null,
      'openai',
      'gpt-5.4',
      null,
      'allowed',
      JSON.stringify(['finish_task']),
      '[]',
      'review',
      'Dashboard review task',
      '/tmp/dash-review.md',
      'raymon',
      null,
      null,
      runtimeSessionId,
      'jopen/dash-review',
      'abc123',
      null,
      null,
      null,
      null,
      null,
      0,
      3,
      now,
      now,
      null,
      null,
      now,
      now,
      now,
      now,
    );

    db.prepare(
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
    ).run(
      'task-dash-review-rework',
      'backend-team',
      'backend-team',
      'Dashboard review rework',
      'task-dash-review',
      '/tmp/dash-review.md',
      '/tmp/dash-review.md',
      null,
      'pending',
      'backend-team',
      null,
      'medium',
      now,
      now,
      null,
    );

    db.prepare(
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
      `,
    ).run(
      'review-dash-1',
      'job-dash-1',
      'task-dash-review',
      runtimeSessionId,
      'juez',
      'openai',
      'gpt-5.4',
      'rejected',
      'Falta edge case',
      JSON.stringify([{ severity: 'high', file: 'src/a.ts', line: 3, message: 'Maneja null.' }]),
      JSON.stringify({ verificationSummary: 'CI PASSED' }),
      'task-dash-review-rework',
      null,
      null,
      null,
      null,
      1,
      3,
      now,
      'same_signature_review',
      now,
      now,
      now,
      now,
    );

    writeRuntimeSessionFile(worktreePath, {
      runtimeSessionId,
      projectId: 'backend-team',
      agentId: 'backend-team',
      agent: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      baseCommitHash: 'abc123',
      branchName: 'jopen/dash-worktree-1',
      worktreePath,
      tmuxSessionId: runtimeSessionId,
      pid: null,
      prompt: 'Dashboard test',
      beadPath: null,
      workItemKey: null,
      beadSpecHash: null,
      beadSpecVersion: null,
      qaConfig: null,
      originThreadId: null,
      notificationChatId: null,
      agentConfigId: 'default',
      agentConfigSnapshot: {
        agentId: 'default',
        primaryProvider: 'openai',
        model: 'gpt-5.4',
        providerProfile: null,
        executionHarness: 'codex',
        executionProfile: 'jopen',
        toolMode: 'allowed',
        allowedTools: ['finish_task'],
        fallbacks: [],
        resolvedAt: now,
      },
      maxSteps: 10,
      maxWallTimeMs: 60_000,
      maxCommandTimeMs: 60_000,
      createdAt: now,
      updatedAt: now,
    });

    const detail = await getUnifiedDashboardSessionDetail(runtimeSessionId);

    assert.ok(detail);
    assert.equal(detail.session.worktreePath, worktreePath);
    assert.equal(detail.session.agentBinding?.worktreePath, worktreePath);
    assert.equal(detail.agentConfig.appliesTo, 'new_sessions_only');
    assert.equal(detail.agentConfig.current?.agentId, 'default');
    assert.equal(detail.agentConfig.snapshot?.agentId, 'default');
    assert.equal(detail.agentConfig.snapshot?.executionHarness, 'codex');
    assert.equal(detail.agentConfig.snapshot?.executionProfile, 'jopen');
    assert.equal(detail.review?.status, 'rejected');
    assert.equal(detail.review?.reworkTaskId, 'task-dash-review-rework');
    assert.equal(detail.review?.provider, 'openai');
    assert.equal(detail.review?.model, 'gpt-5.4');
    assert.equal(detail.review?.lastError, 'same_signature_review');
    assert.equal(detail.review?.findings.length, 1);

    rmSync(worktreePath, { force: true, recursive: true });
  });
});
