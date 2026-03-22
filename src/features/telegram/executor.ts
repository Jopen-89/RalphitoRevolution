import { getRaymonOrchestrator } from '../engine/raymonOrchestrator.js';

const ORCHESTRATOR_PROJECT_ID = 'backend-team';

export async function executeAgentTask(agent: string, instruction: string): Promise<string> {
  const prompt = `ROLES: Usa la personalidad definida en agents/roles/ para ${agent}.\n\nINSTRUCCIÓN:\n${instruction}`;

  try {
    const orchestrator = getRaymonOrchestrator();
    const result = await orchestrator.spawn({
      project: ORCHESTRATOR_PROJECT_ID,
      prompt,
    });

    return `Tarea iniciada correctamente en segundo plano.\nSession ID: ${result.runtimeSessionId}\nMensaje: Ralphito Engine lanzó el executor loop.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message || 'Fallo desconocido al ejecutar el orquestador.');
  }
}
