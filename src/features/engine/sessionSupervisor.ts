import { randomUUID } from 'crypto';
import path from 'path';
import { getRalphitoDatabase } from '../persistence/db/index.js';
import { CommandRunner } from './commandRunner.js';
import { resolveEngineProjectConfig } from './config.js';
import {
  DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS,
  DEFAULT_RUNTIME_MAX_STEPS,
  DEFAULT_RUNTIME_MAX_WALL_TIME_MS,
  DEFAULT_RUNTIME_RUNTIME_THREAD_CHANNEL,
} from './constants.js';
import { buildEnginePrompt } from './promptBuilder.js';
import {
  updateRuntimeSessionFile,
  writeRuntimeSessionFile,
  writeRuntimeFailureRecord,
  type RuntimeSessionFileRecord,
} from './runtimeFiles.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';
import { WorktreeManager } from './worktreeManager.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';

export interface SpawnRuntimeSessionInput {
  project: string;
  prompt: string;
  beadPath?: string;
  workItemKey?: string;
  model?: string;
  beadSpecHash?: string;
  beadSpecVersion?: string;
  qaConfig?: unknown;
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

function shellEscape(str: string): string {
  if (!str.includes("'")) return `'${str}'`;
  const escaped = str.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

function buildLaunchCommand(agent: string, model: string | null, prompt: string) {
  switch (agent) {
    case 'codex':
      return ['codex', '--full-auto', '--no-alt-screen', ...(model ? ['-m', model] : [])].join(' ');
    case 'opencode':
      return ['opencode', 'run', shellEscape(prompt), ...(model ? ['-m', model] : [])].join(' ');
    default:
      throw new Error(`Agent no soportado por Ralphito Engine: ${agent}`);
  }
}

function toStringEnv(env: NodeJS.ProcessEnv, extra: Record<string, string>) {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }

  return {
    ...result,
    ...extra,
  };
}

export class SessionSupervisor {
  constructor(
    private readonly commandRunner = new CommandRunner(),
    private readonly tmuxRuntime = new TmuxRuntime(),
    private readonly worktreeManagerFactory = (repoRoot: string) => new WorktreeManager(repoRoot),
  ) {}

  async spawn(input: SpawnRuntimeSessionInput) {
    const project = resolveEngineProjectConfig(input.project);
    const runtimeSessionId = createRuntimeSessionId(project.sessionPrefix);
    const branchName = `jopen/${runtimeSessionId}`;
    const worktreeManager = this.worktreeManagerFactory(project.path);
    const sessionRepository = getRuntimeSessionRepository();
    const lockRepository = getRuntimeLockRepository();
    const beadPath = resolveBeadPath(project.path, input.beadPath);
    const model = input.model || project.model;
    const maxSteps = DEFAULT_RUNTIME_MAX_STEPS;
    const maxWallTimeMs = DEFAULT_RUNTIME_MAX_WALL_TIME_MS;
    const maxCommandTimeMs = DEFAULT_RUNTIME_MAX_COMMAND_TIME_MS;
    let worktreePath: string | null = null;
    let tmuxCreated = false;

    try {
      const { stdout } = await this.commandRunner.run('git', ['rev-parse', project.defaultBranch], {
        cwd: project.path,
      });
      const baseCommitHash = stdout.trim();
      const createdAt = new Date().toISOString();

      worktreePath = await worktreeManager.createWorkspace(runtimeSessionId, baseCommitHash, branchName);
      const prompt = buildEnginePrompt(project, input.prompt, branchName);
      const threadId = ensureRuntimeThread(runtimeSessionId);

      const sessionFile = {
        runtimeSessionId,
        projectId: project.id,
        agentId: project.id,
        agent: project.agent,
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
        maxSteps,
        maxWallTimeMs,
        maxCommandTimeMs,
        createdAt,
        updatedAt: createdAt,
      } satisfies RuntimeSessionFileRecord;

      sessionRepository.create({
        threadId,
        agentId: project.id,
        runtimeSessionId,
        status: 'queued',
        baseCommitHash,
        worktreePath,
        maxSteps,
        startedAt: createdAt,
        heartbeatAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      });

      writeRuntimeSessionFile(worktreePath, sessionFile);

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
        buildLaunchCommand(project.agent, model, prompt),
        toStringEnv(process.env, {
          RALPHITO_RUNTIME_SESSION_ID: runtimeSessionId,
          RALPHITO_ENGINE_MANAGED: '1',
          RALPHITO_PROJECT_ID: project.id,
          RALPHITO_WORKTREE_PATH: worktreePath,
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

      this.commandRunner.spawnDetached(
        process.execPath,
        ['--import', 'tsx', path.join(project.path, 'src/features/engine/cli.ts'), 'run-loop', runtimeSessionId],
        {
          cwd: project.path,
          env: process.env,
        },
      );

      await this.tmuxRuntime.sendLiteral(runtimeSessionId, prompt);

      return {
        runtimeSessionId,
        baseCommitHash,
        worktreePath,
        branchName,
      } satisfies SpawnRuntimeSessionResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (worktreePath) {
        writeRuntimeFailureRecord(worktreePath, {
          runtimeSessionId,
          kind: 'spawn_failed',
          summary: message,
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

      throw error;
    }
  }
}
