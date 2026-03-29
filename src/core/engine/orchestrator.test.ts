import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  closeRalphitoDatabase,
  initializeRalphitoDatabase,
  resetRalphitoRepositories,
} from '../../infrastructure/persistence/db/index.js';
import { AgentRegistryService } from '../services/AgentRegistry.js';
import { BeadLifecycleService } from '../services/BeadLifecycleService.js';
import { ExecutionPipelineService } from '../services/ExecutionPipelineService.js';
import { type SpawnRuntimeSessionInput, type SpawnRuntimeSessionResult } from '../services/SessionManager.js';
import { getRuntimeLockRepository, resetRuntimeLockRepository } from './runtimeLockRepository.js';
import { Orchestrator } from './orchestrator.js';

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempRuntime<T>(fn: (ctx: { repoRoot: string; worktreeRoot: string }) => Promise<T> | T) {
  const previousDbPath = process.env.RALPHITO_DB_PATH;
  const previousRepoRoot = process.env.RALPHITO_REPO_ROOT;
  const previousWorktreeRoot = process.env.RALPHITO_WORKTREE_ROOT;
  const repoRoot = createTempDirectory('rr-orchestrator-repo-');
  const worktreeRoot = createTempDirectory('rr-orchestrator-worktrees-');

  process.env.RALPHITO_DB_PATH = path.join(repoRoot, 'ops', 'runtime', 'ralphito', 'ralphito.sqlite');
  process.env.RALPHITO_REPO_ROOT = repoRoot;
  process.env.RALPHITO_WORKTREE_ROOT = worktreeRoot;
  closeRalphitoDatabase();
  resetRalphitoRepositories();
  resetRuntimeLockRepository();
  initializeRalphitoDatabase();

  return Promise.resolve()
    .then(() => fn({ repoRoot, worktreeRoot }))
    .finally(() => {
      closeRalphitoDatabase();
      resetRalphitoRepositories();
      resetRuntimeLockRepository();
      if (previousDbPath) process.env.RALPHITO_DB_PATH = previousDbPath;
      else delete process.env.RALPHITO_DB_PATH;
      if (previousRepoRoot) process.env.RALPHITO_REPO_ROOT = previousRepoRoot;
      else delete process.env.RALPHITO_REPO_ROOT;
      if (previousWorktreeRoot) process.env.RALPHITO_WORKTREE_ROOT = previousWorktreeRoot;
      else delete process.env.RALPHITO_WORKTREE_ROOT;
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(worktreeRoot, { force: true, recursive: true });
    });
}

function createPersistedTask(repoRoot: string, taskId: string) {
  const beadPath = path.join(repoRoot, 'docs', 'specs', 'projects', 'system', `${taskId}.bead.md`);
  mkdirSync(path.dirname(beadPath), { recursive: true });
  writeFileSync(beadPath, `[WRITE_ONLY_GLOBS]: ["src/${taskId}.ts"]\n`, 'utf8');

  return BeadLifecycleService.createTask({
    taskId,
    projectId: 'backend-team',
    title: taskId,
    beadPath,
  });
}

test('Orchestrator.launchExecutionJob usa snapshot persistida aunque cambie agent_registry', async () => {
  await withTempRuntime(async ({ repoRoot }) => {
    AgentRegistryService.sync();
    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'openai',
      provider: 'openai',
      model: 'gpt-5.4',
      execution_harness: 'codex',
      execution_profile: 'jopen',
      tool_calling_mode: 'allowed',
      allowed_tools_json: JSON.stringify(['finish_task']),
    });

    createPersistedTask(repoRoot, 'task-orchestrator-snapshot');
    const executionPipeline = new ExecutionPipelineService();
    const launchInputs: SpawnRuntimeSessionInput[] = [];
    const orchestrator = new Orchestrator(
      {
        async spawn(input: SpawnRuntimeSessionInput) {
          launchInputs.push(input);
          return {
            taskId: input.taskId!,
            executionJobId: input.executionJobId!,
            runtimeSessionId: 'rt-orchestrator-1',
            baseCommitHash: 'abc123',
            worktreePath: '/tmp/rt-orchestrator-1',
            branchName: 'jopen/rt-orchestrator-1',
          } satisfies SpawnRuntimeSessionResult;
        },
      } as never,
      executionPipeline,
      getRuntimeLockRepository(),
      repoRoot,
    );

    const enqueued = await orchestrator.spawn({
      project: 'backend-team',
      taskId: 'task-orchestrator-snapshot',
      prompt: 'Run snapshot',
    });

    AgentRegistryService.updateAgentConfig('default', {
      primary_provider: 'opencode',
      provider: 'opencode',
      model: 'minimax-m2.7',
      execution_harness: 'opencode',
      execution_profile: null,
      tool_calling_mode: 'none',
      allowed_tools_json: JSON.stringify([]),
    });

    const claim = executionPipeline.claimJob({
      executionJobId: enqueued.executionJobId,
      workerId: 'test-worker',
    });
    assert.ok(claim);

    await orchestrator.launchExecutionJob({
      executionJobId: enqueued.executionJobId,
      claimToken: claim!.claimToken,
      workerId: 'test-worker',
    });

    assert.equal(launchInputs.length, 1);
    assert.equal(launchInputs[0]?.project, 'backend-team');
    assert.equal(launchInputs[0]?.agentConfigId, 'default');
    assert.equal(launchInputs[0]?.provider, 'openai');
    assert.equal(launchInputs[0]?.model, 'gpt-5.4');
    assert.equal(launchInputs[0]?.agentConfigSnapshot?.executionHarness, 'codex');
    assert.equal(launchInputs[0]?.agentConfigSnapshot?.executionProfile, 'jopen');
    assert.equal(launchInputs[0]?.agentConfigSnapshot?.toolMode, 'allowed');
    assert.deepEqual(launchInputs[0]?.agentConfigSnapshot?.allowedTools, ['finish_task']);
  });
});

test('Orchestrator.launchExecutionJob falla si el claimToken no coincide', async () => {
  await withTempRuntime(async ({ repoRoot }) => {
    AgentRegistryService.sync();
    createPersistedTask(repoRoot, 'task-orchestrator-claim');

    const executionPipeline = new ExecutionPipelineService();
    const orchestrator = new Orchestrator(
      {
        async spawn() {
          throw new Error('spawn should not run on claim mismatch');
        },
      } as never,
      executionPipeline,
      getRuntimeLockRepository(),
      repoRoot,
    );

    const enqueued = await orchestrator.spawn({
      project: 'backend-team',
      taskId: 'task-orchestrator-claim',
      prompt: 'bad claim',
    });

    const claim = executionPipeline.claimJob({
      executionJobId: enqueued.executionJobId,
      workerId: 'test-worker',
    });
    assert.ok(claim);

    await assert.rejects(
      () =>
        orchestrator.launchExecutionJob({
          executionJobId: enqueued.executionJobId,
          claimToken: 'wrong-token',
          workerId: 'test-worker',
        }),
      /claim mismatch/i,
    );
  });
});
