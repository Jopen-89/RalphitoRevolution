import path from 'path';
import { CommandRunner } from '../../infrastructure/runtime/commandRunner.js';
import { ProjectService } from '../services/ProjectService.js';
import { buildEnginePrompt } from './promptBuilder.js';
import {
  clearRuntimeExitCode,
  clearRuntimeFailureRecord,
  readRuntimeFailureRecord,
  readRuntimeSessionFile,
  updateRuntimeSessionFile,
} from './runtimeFiles.js';
import { getRuntimeLockRepository } from './runtimeLockRepository.js';
import {
  buildRuntimeEnvironment,
  buildRuntimeLaunchCommand,
  spawnRuntimeLoop,
} from './runtimeLaunch.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { TmuxRuntime } from '../../infrastructure/runtime/tmuxRuntime.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';

function buildResumePrompt(kind: string, summary: string, reasonCode: string | null, tail: string | null) {
  const sections = [
    'La ejecucion anterior fallo.',
    `Tipo: ${kind}`,
    `Resumen corto: ${summary}`,
  ];

  if (reasonCode) {
    sections.push(`Motivo verificacion: ${reasonCode}`);
  }

  if (tail) {
    sections.push(`Tail:\n\`\`\`\n${tail}\n\`\`\``);
  }

  sections.push('Continua desde ahi. Corrige el fallo y vuelve a ejecutar `finish_task` si aplica.');
  return sections.join('\n\n');
}

function buildResumedTaskPrompt(originalPrompt: string, resumePrompt: string | null) {
  if (!resumePrompt) return originalPrompt;
  return `${originalPrompt}\n\n## Resume Context\n${resumePrompt}`;
}

function resolveBeadPath(repoRoot: string, beadPath: string | null) {
  if (!beadPath) return null;
  return path.isAbsolute(beadPath) ? beadPath : path.join(repoRoot, beadPath);
}

export async function resumeRuntimeSession(
  runtimeSessionId: string,
  tmuxRuntime = new TmuxRuntime(),
  commandRunner = new CommandRunner(),
  options: { spawnLoop?: boolean } = {},
) {
  const sessionRepository = getRuntimeSessionRepository();
  const session = sessionRepository.getByRuntimeSessionId(runtimeSessionId);

  if (!session?.worktreePath) {
    throw new Error(`Sesion no encontrada o sin worktree: ${runtimeSessionId}`);
  }

  const failure = readRuntimeFailureRecord(session.worktreePath);
  const resumePrompt = failure
    ? buildResumePrompt(failure.kind, failure.summary, failure.reasonCode, failure.logTail)
    : null;
  const sessionFile = readRuntimeSessionFile(session.worktreePath);
  const alive = await tmuxRuntime.isAlive(runtimeSessionId);

  if (!alive) {
    if (!sessionFile) {
      throw new Error(`La sesion ${runtimeSessionId} no tiene .ralphito-session.json; no puedo relanzarla.`);
    }

    const project = ProjectService.resolve(sessionFile.projectId);
    const beadPath = resolveBeadPath(project.path, sessionFile.beadPath);

    if (beadPath) {
      getRuntimeLockRepository().acquireForSession({
        runtimeSessionId,
        targets: resolveWriteScopeTargetsFromBeadFile(beadPath, project.path),
      });
    }

    clearRuntimeExitCode(session.worktreePath);

    const prompt = buildEnginePrompt(
      project,
      buildResumedTaskPrompt(sessionFile.prompt, resumePrompt),
      sessionFile.branchName,
    );

    await tmuxRuntime.createSession(
      runtimeSessionId,
      session.worktreePath,
      buildRuntimeLaunchCommand(sessionFile.agent, sessionFile.model),
      buildRuntimeEnvironment({
        runtimeSessionId,
        worktreePath: session.worktreePath,
        projectId: project.id,
        systemPrompt: prompt.systemPrompt,
        instruction: prompt.userTask,
        provider: sessionFile.provider,
        model: sessionFile.model,
      }),
    );

    const pid = await tmuxRuntime.getPanePid(runtimeSessionId);
    updateRuntimeSessionFile(session.worktreePath, { pid });
    sessionRepository.resume({ runtimeSessionId });

    if (pid) {
      sessionRepository.attachPid({
        runtimeSessionId,
        pid,
        worktreePath: session.worktreePath,
        status: 'running',
      });
    } else {
      sessionRepository.heartbeat({
        runtimeSessionId,
        status: 'running',
        worktreePath: session.worktreePath,
        maxSteps: session.maxSteps ?? sessionFile.maxSteps,
      });
    }

    if (resumePrompt) {
      clearRuntimeFailureRecord(session.worktreePath);
    }

    if (options.spawnLoop !== false) {
      spawnRuntimeLoop(project.path, runtimeSessionId, commandRunner);
    }
    return;
  }

  if (resumePrompt) {
    await tmuxRuntime.sendLiteral(runtimeSessionId, resumePrompt);
    clearRuntimeFailureRecord(session.worktreePath);
  }

  if (session.status === 'suspended_human_input') {
    console.log(`[resumeRuntimeSession:${runtimeSessionId}] Resuming from suspended state, prompt may have been resolved manually`);
  }

  sessionRepository.resume({ runtimeSessionId });
}
