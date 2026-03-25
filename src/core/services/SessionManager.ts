import { randomUUID } from 'crypto';
import path from 'path';
import type { Provider } from '../domain/gateway.types.js';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';
import { resolveEngineProjectConfig } from '../engine/config.js';
import type { EngineProjectConfig } from './ProjectService.js';
import {
  DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS,
  DEFAULT_RUNTIME_MAX_STEPS,
  DEFAULT_RUNTIME_MAX_WALL_TIME_MS,
  DEFAULT_RUNTIME_RUNTIME_THREAD_CHANNEL,
} from '../domain/constants.js';
import { buildEnginePrompt } from '../engine/promptBuilder.js';
import { enqueueEngineNotification } from './EventBus.js';
import {
  updateRuntimeSessionFile,
  writeRuntimeSessionFile,
  writeRuntimeFailureRecord,
  type RuntimeSessionFileRecord,
} from '../engine/runtimeFiles.js';
import { getRuntimeLockRepository } from '../engine/runtimeLockRepository.js';
import { syncRuntimeTaskLink } from '../engine/runtimeTaskLinking.js';
import {
  buildRuntimeEnvironment,
  buildRuntimeLaunchCommand,
  spawnRuntimeLoop,
} from '../engine/runtimeLaunch.js';
import { getRuntimeSessionRepository } from '../engine/runtimeSessionRepository.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';
import { resolveWriteScopeTargetsFromBeadFile } from '../engine/writeScope.js';
import { RuntimeReaper } from '../engine/runtimeReaper.js';

export interface SpawnRuntimeSessionInput {
  project: string;
  prompt: string;
  beadPath?: string;
  workItemKey?: string;
  provider?: Provider;
  model?: string;
  beadSpecHash?: string;
  beadSpecVersion?: string;
  qaConfig?: unknown;
  originThreadId?: number;
  notificationChatId?: string;
}

export interface SpawnRuntimeSessionResult {
  runtimeSessionId: string;
  baseCommitHash: string;
  worktreePath: string;
  branchName: string;
}

function resolveBeadPath(repoRoot: string, beadPath: string | undefined) {
  if (!beadPath) return null;
  const candidate = path.isAbsolute(beadPath) ? beadPath : path.join(repoRoot, beadPath);
  return candidate;
}

function createRuntimeSessionId(sessionPrefix: string) {
  return `${sessionPrefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function ensureRuntimeThread(runtimeSessionId: string) {
  const db = getRalphitoDatabase();
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel, external_chat_id)
      DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at
    `,
  ).run(
    DEFAULT_RUNTIME_RUNTIME_THREAD_CHANNEL,
    runtimeSessionId,
    `Runtime ${runtimeSessionId}`,
    now,
    now,
  );

  const row = db
    .prepare(
      `
        SELECT id
        FROM threads
        WHERE channel = ?
          AND external_chat_id = ?
        LIMIT 1
      `,
    )
    .get(DEFAULT_RUNTIME_RUNTIME_THREAD_CHANNEL, runtimeSessionId) as { id: number } | undefined;

  if (!row) {
    throw new Error(`No pude crear thread runtime para ${runtimeSessionId}`);
  }

  return row.id;
}

export class SessionSupervisor {
  constructor(
    private readonly commandRunner = new CommandRunner(),
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly worktreeManagerFactory = (project: EngineProjectConfig) =>
      new WorktreeManager(project.path, project.worktreeRoot),
    private readonly reaperFactory = (
      sessionRepo: ReturnType<typeof getRuntimeSessionRepository>,
      lockRepo: ReturnType<typeof getRuntimeLockRepository>,
      wtManager: WorktreeManager,
      tmux: TmuxRuntime,
    ) => new RuntimeReaper(sessionRepo, lockRepo, wtManager, tmux),
  ) {}

  async spawn(input: SpawnRuntimeSessionInput) {
    const project = resolveEngineProjectConfig(input.project);
    const sessionRepository = getRuntimeSessionRepository();
    const lockRepository = getRuntimeLockRepository();
    const worktreeManager = this.worktreeManagerFactory(project);

    // Limpieza proactiva de sesiones y worktrees zombis antes de spawn
    const reaper = this.reaperFactory(
      sessionRepository,
      lockRepository,
      worktreeManager,
      this.tmuxRuntime,
    );
    await reaper.reap();

    const runtimeSessionId = createRuntimeSessionId(project.sessionPrefix);
    const branchName = `jopen/${runtimeSessionId}`;
    const beadPath = resolveBeadPath(project.path, input.beadPath);
    const provider = input.provider || project.provider;
    const model = input.model || (input.provider && project.agent === 'opencode' ? null : project.model);
    const maxSteps = DEFAULT_RUNTIME_MAX_STEPS;
    const maxWallTimeMs = DEFAULT_RUNTIME_MAX_WALL_TIME_MS;
    const maxCommandTimeMs = DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS;
    let worktreePath: string | null = null;
    let tmuxCreated = false;

    try {
      const { stdout } = await this.commandRunner.run('git', ['rev-parse', 'HEAD'], {
        cwd: project.path,
      });
      const baseCommitHash = stdout.trim();
      const createdAt = new Date().toISOString();

      worktreePath = await worktreeManager.createWorkspace(runtimeSessionId, baseCommitHash, branchName);
      const enginePrompt = buildEnginePrompt(project, input.prompt, branchName);
      const threadId = ensureRuntimeThread(runtimeSessionId);

      const sessionFile = {
        runtimeSessionId,
        projectId: project.id,
        agentId: project.id,
        agent: project.agent,
        provider,
        model,
        baseCommitHash,
        branchName,
        worktreePath,
        tmuxSessionId: runtimeSessionId,
        pid: null,
        prompt: input.prompt,
        beadPath: input.beadPath || null,
        workItemKey: input.workItemKey || null,
        beadSpecHash: input.beadSpecHash || null,
        beadSpecVersion: input.beadSpecVersion || null,
        qaConfig: input.qaConfig || null,
        originThreadId: input.originThreadId ?? null,
        notificationChatId: input.notificationChatId || null,
        maxSteps,
        maxWallTimeMs,
        maxCommandTimeMs,
        createdAt,
        updatedAt: createdAt,
      } satisfies RuntimeSessionFileRecord;

      sessionRepository.create({
        threadId,
        ...(input.originThreadId ? { originThreadId: input.originThreadId } : {}),
        agentId: project.id,
        runtimeSessionId,
        status: 'queued',
        baseCommitHash,
        ...(input.notificationChatId ? { notificationChatId: input.notificationChatId } : {}),
        worktreePath,
        maxSteps,
        startedAt: createdAt,
        heartbeatAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });

      writeRuntimeSessionFile(worktreePath, sessionFile);
      syncRuntimeTaskLink({
        runtimeSessionId,
        projectId: project.id,
        workItemKey: input.workItemKey || null,
        beadPath: beadPath || null,
        assignedAgent: project.id,
        status: 'in_progress',
      });

      if (beadPath) {
        const targets = resolveWriteScopeTargetsFromBeadFile(beadPath, project.path);
        lockRepository.acquireForSession({
          runtimeSessionId,
          targets,
        });
      }

      await this.tmuxRuntime.createSession(
        runtimeSessionId,
        worktreePath,
        buildRuntimeLaunchCommand(project.agent, model),
        buildRuntimeEnvironment({
          runtimeSessionId,
          worktreePath,
          projectId: project.id,
          systemPrompt: enginePrompt.systemPrompt,
          instruction: enginePrompt.userTask,
          provider,
          model,
        }),
      );
      tmuxCreated = true;

      const pid = await this.tmuxRuntime.getPanePid(runtimeSessionId);
      updateRuntimeSessionFile(worktreePath, { pid });
      if (pid) {
        sessionRepository.attachPid({
          runtimeSessionId,
          pid,
          worktreePath,
          status: 'running',
          startedAt: createdAt,
        });
      } else {
        sessionRepository.heartbeat({
          runtimeSessionId,
          status: 'running',
          worktreePath,
          maxSteps,
        });
      }

      spawnRuntimeLoop(project.path, runtimeSessionId, this.commandRunner);

      enqueueEngineNotification({
        runtimeSessionId,
        eventType: 'session.started',
        payload: {
          projectId: project.id,
          branchName,
          beadPath: input.beadPath || null,
          workItemKey: input.workItemKey || null,
        },
        ...(input.notificationChatId ? { targetChatId: input.notificationChatId } : {}),
      });

      return {
        runtimeSessionId,
        baseCommitHash,
        worktreePath,
        branchName,
      } satisfies SpawnRuntimeSessionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (input.notificationChatId) {
        enqueueEngineNotification({
          runtimeSessionId,
          eventType: 'session.spawn_failed',
          targetChatId: input.notificationChatId,
          payload: {
            projectId: project.id,
            branchName,
            beadPath: input.beadPath || null,
            workItemKey: input.workItemKey || null,
            error: message,
          },
        });
      }

      if (worktreePath) {
        writeRuntimeFailureRecord(worktreePath, {
          runtimeSessionId,
          kind: 'spawn_failed',
          summary: message,
          reasonCode: null,
          logTail: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      if (tmuxCreated) {
        await this.tmuxRuntime.killSession(runtimeSessionId);
      }

      getRuntimeLockRepository().releaseForSession(runtimeSessionId);

      if (worktreePath) {
        await worktreeManager.teardownWorkspacePath(worktreePath);
      }

      const existing = getRuntimeSessionRepository().getByRuntimeSessionId(runtimeSessionId);
      if (existing) {
        getRuntimeSessionRepository().fail({
          runtimeSessionId,
          failureKind: 'spawn_failed',
          failureSummary: message,
        });
      }
      syncRuntimeTaskLink({
        runtimeSessionId,
        projectId: project.id,
        workItemKey: input.workItemKey || null,
        beadPath: beadPath || null,
        assignedAgent: project.id,
        status: 'failed',
        failureReason: message,
      });

      throw error;
    }
  }
}
