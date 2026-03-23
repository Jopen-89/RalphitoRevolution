import { clearRuntimeFailureRecord, readRuntimeFailureRecord } from './runtimeFiles.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';

function buildResumePrompt(summary: string, tail: string | null) {
  const sections = [
    'La ejecucion anterior fallo.',
    `Resumen corto: ${summary}`,
  ];

  if (tail) {
    sections.push(`Tail:\n\`\`\`\n${tail}\n\`\`\``);
  }

  sections.push('Continua desde ahi. Corrige el fallo y vuelve a ejecutar `bd sync` si aplica.');
  return sections.join('\n\n');
}

export async function resumeRuntimeSession(runtimeSessionId: string, tmuxRuntime = new TmuxRuntime()) {
  const sessionRepository = getRuntimeSessionRepository();
  const session = sessionRepository.getByRuntimeSessionId(runtimeSessionId);

  if (!session?.worktreePath) {
    throw new Error(`Sesion no encontrada o sin worktree: ${runtimeSessionId}`);
  }

  const failure = readRuntimeFailureRecord(session.worktreePath);

  if (!(await tmuxRuntime.isAlive(runtimeSessionId))) {
    throw new Error(`La sesion ${runtimeSessionId} no esta viva; no puedo reinyectar contexto.`);
  }

  if (failure) {
    await tmuxRuntime.sendLiteral(runtimeSessionId, buildResumePrompt(failure.summary, failure.logTail));
    clearRuntimeFailureRecord(session.worktreePath);
  }

  if (session.status === 'suspended_human_input') {
    console.log(`[resumeRuntimeSession:${runtimeSessionId}] Resuming from suspended state, prompt may have been resolved manually`);
  }

  sessionRepository.resume({ runtimeSessionId });
}
