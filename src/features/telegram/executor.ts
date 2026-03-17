import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);
const ORCHESTRATOR_PROJECT_ID = 'backend-team';

export async function executeAgentTask(agent: string, instruction: string): Promise<string> {
    try {
        // Formateamos el prompt para decirle al agente quién es y qué tiene que hacer.
        const prompt = `ROLES: Usa la personalidad definida en agents/roles/ para ${agent}.\n\nINSTRUCCIÓN:\n${instruction}`;

        const command = `./scripts/tools/tool_spawn_executor.sh "${ORCHESTRATOR_PROJECT_ID}" "${prompt.replace(/"/g, '\\"')}"`;
        
        const { stdout, stderr } = await execAsync(command);
        
        try {
            const result = JSON.parse(stdout.trim());
            if (result.status === 'error') {
                const details = result.details ? `\n${result.details}` : '';
                const sessionInfo = result.session_id ? `\nSession ID: ${result.session_id}` : '';
                return `Hubo un problema al iniciar la tarea:\n${result.message}${sessionInfo}${details}`;
            } else {
                return `Tarea iniciada correctamente en segundo plano.\nSession ID: ${result.session_id || 'Desconocido'}\nMensaje: ${result.message}`;
            }
        } catch (e) {
            const diagnosticOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
            return `No pude interpretar la respuesta del orquestador.\n${diagnosticOutput || 'Sin diagnóstico adicional.'}`;
        }
    } catch (error: any) {
        console.error('Error ejecutando la tarea del agente:', error);
        const diagnosticOutput = [error.stdout, error.stderr, error.message]
            .filter(Boolean)
            .join('\n');
        throw new Error(diagnosticOutput || 'Fallo desconocido al ejecutar el orquestador.');
    }
}
