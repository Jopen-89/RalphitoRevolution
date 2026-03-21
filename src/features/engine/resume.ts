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
  if (!failure) {
    throw new Error(`No hay fallo estructurado para ${runtimeSessionId}`);
  }

  if (!(await tmuxRuntime.isAlive(runtimeSessionId))) {
    throw new Error(`La sesion ${runtimeSessionId} no esta viva; no puedo reinyectar contexto.`);
  }

  await tmuxRuntime.sendLiteral(runtimeSessionId, buildResumePrompt(failure.summary, failure.logTail));
  clearRuntimeFailureRecord(session.worktreePath);
  sessionRepository.resume({ runtimeSessionId });
}
