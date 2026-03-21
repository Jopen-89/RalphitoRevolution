import { getRaymonOrchestrator } from '../engine/raymonOrchestrator.js';

const ORCHESTRATOR_PROJECT_ID = 'backend-team';

export interface OrchestrationResult {
  response: string;
  sessionId?: string;
  baseCommitHash?: string;
}

export type OrchestrationIntent = 'chat' | 'divergence' | 'execution' | 'status';

export function classifyIntent(_agentId: string, instruction: string): OrchestrationIntent {
  const normalized = instruction.trim().toLowerCase();

  const statusPatterns = [
    /\bestado\b/i,
    /\bstatus\b/i,
    /\bcomo va\b/i,
    /\bprogreso\b/i,
    /\bseguimiento\b/i,
  ];

  const divergencePatterns = [
    /\bdivergencia\b/i,
    /\bdiverge\b/i,
    /\bdesv[ií]ate\b/i,
    /\bmodo divergente\b/i,
  ];

  if (statusPatterns.some((pattern) => pattern.test(normalized))) {
    return 'status';
  }

  if (divergencePatterns.some((pattern) => pattern.test(normalized))) {
    return 'divergence';
  }

  if (isExplicitExecutionIntent(instruction)) {
    return 'execution';
  }

  return 'chat';
}

export function isExplicitExecutionIntent(instruction: string) {
  const normalized = instruction.trim().toLowerCase();

  const hasBeadOrSpec = /\.bead\.md\b|\.spec\.md\b/i.test(normalized);

  const executionPatterns = [
    /^(ejecuta|ejecutar|programa)\b.*\bbead\b/i,
    /^(orquesta|lanza|ejecuta)\b.*\b(código|script|implementación)\b/i,
    /^(genera|crea|escribe|guarda)\b.*\b(evidencia|archivo|log)\b/i,
  ];

  return hasBeadOrSpec || executionPatterns.some((pattern) => pattern.test(normalized));
}

export async function executeOrchestrationTask(agentId: string, instruction: string): Promise<OrchestrationResult> {
  const prompt = `ROLES: Usa la personalidad definida en agents/roles/ para ${agentId}.\n\nINSTRUCCIÓN:\n${instruction}`;

  try {
    const orchestrator = getRaymonOrchestrator();
    const result = await orchestrator.spawn({
      project: ORCHESTRATOR_PROJECT_ID,
      prompt,
    });

    const sessionInfo = result.runtimeSessionId ? ` He abierto la sesión ${result.runtimeSessionId}.` : '';
    return {
      sessionId: result.runtimeSessionId,
      baseCommitHash: result.baseCommitHash,
      response: `Lo pongo en marcha.${sessionInfo} Puedes seguir el progreso por estado cuando quieras.`.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message || 'Fallo desconocido al lanzar la tarea en segundo plano.');
  }
}
