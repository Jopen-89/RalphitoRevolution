import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);
const ORCHESTRATOR_PROJECT_ID = 'backend-team';

export interface OrchestrationResult {
  response: string;
  sessionId?: string;
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

  // OBLIGA a que la instrucción sea explícitamente técnica o contenga un archivo bead
  const hasBeadOrSpec = /\.bead\.md\b|\.spec\.md\b/i.test(normalized);
  
  const executionPatterns = [
    /^(ejecuta|ejecutar|programa)\b.*\bbead\b/i,
    /^(orquesta|lanza|ejecuta)\b.*\b(código|script|implementación)\b/i,
  ];

  return hasBeadOrSpec || executionPatterns.some((pattern) => pattern.test(normalized));
}

export async function executeOrchestrationTask(agentId: string, instruction: string): Promise<OrchestrationResult> {
  try {
    const prompt = `ROLES: Usa la personalidad definida en agents/roles/ para ${agentId}.\n\nINSTRUCCIÓN:\n${instruction}`;
    const escapedPrompt = prompt.replace(/"/g, '\\"');
    const command = `./scripts/tools/tool_spawn_executor.sh "${ORCHESTRATOR_PROJECT_ID}" "${escapedPrompt}"`;

    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    try {
      const result = JSON.parse(stdout.trim()) as {
        status?: string;
        message?: string;
        session_id?: string;
        details?: string;
      };

      if (result.status === 'error') {
        const details = result.details ? `\n${result.details}` : '';
        const sessionInfo = result.session_id ? `\nSession ID: ${result.session_id}` : '';
        throw new Error(`${result.message || 'No pude lanzar la tarea.'}${sessionInfo}${details}`);
      }

      const sessionInfo = result.session_id ? ` He abierto la sesión ${result.session_id}.` : '';
      return {
        ...(result.session_id ? { sessionId: result.session_id } : {}),
        response: `Lo pongo en marcha.${sessionInfo} ${result.message || 'Puedes seguir el progreso por estado cuando quieras.'}`.trim(),
      };
    } catch (parseError) {
      const diagnosticOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      throw new Error(diagnosticOutput || 'No pude interpretar la respuesta del orquestador.');
    }
  } catch (error: any) {
    const diagnosticOutput = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    throw new Error(diagnosticOutput || 'Fallo desconocido al lanzar la tarea en segundo plano.');
  }
}
