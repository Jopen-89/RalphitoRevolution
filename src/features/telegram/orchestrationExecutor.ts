import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);
const ORCHESTRATOR_PROJECT_ID = 'backend-team';

export interface OrchestrationResult {
  response: string;
  sessionId?: string;
}

export function isExplicitExecutionIntent(instruction: string) {
  const normalized = instruction.trim().toLowerCase();

  const executionPatterns = [
    /^(delega|delegar|delegalo|delegalo ya)\b/,
    /^(lanza|lanzar|lanzalo|lan[cz]adlo)\b/,
    /^(ejecuta|ejecutar|ejec[úu]talo)\b/,
    /^(pon(?:lo)? en marcha|pon(?:lo)? a trabajar)\b/,
    /^(spawnea|spawn|run)\b/,
    /^(orquesta|orquesta esto|mueve esto)\b/,
  ];

  return executionPatterns.some((pattern) => pattern.test(normalized));
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
