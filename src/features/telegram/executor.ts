import { exec } from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(exec);

export async function executeAgentTask(agent: string, instruction: string): Promise<string> {
    try {
        // Formateamos el prompt para decirle al agente quién es y qué tiene que hacer.
        const prompt = `ROLES: Usa la personalidad definida en agents/roles/ para ${agent}.\n\nINSTRUCCIÓN:\n${instruction}`;
        
        // Ejecutamos tu script de spawn existente
        // Asumiendo que el proyecto es "RalphitoRevolution"
        const command = `./scripts/tools/tool_spawn_executor.sh "RalphitoRevolution" "${prompt.replace(/"/g, '\\"')}"`;
        
        const { stdout, stderr } = await execAsync(command);
        
        // Normalmente tool_spawn_executor.sh devuelve un JSON, intentemos parsearlo
        try {
            const result = JSON.parse(stdout.trim());
            if (result.status === 'error') {
                return `Hubo un problema al iniciar la tarea:\n${result.message}`;
            } else {
                return `Tarea iniciada correctamente en segundo plano.\nSession ID: ${result.session_id || 'Desconocido'}\nMensaje: ${result.message}`;
            }
        } catch (e) {
            // Si no es JSON, devolvemos la salida en crudo
            return `Ejecución finalizada.\n\nSalida:\n${stdout}\n${stderr}`;
        }
    } catch (error: any) {
        console.error('Error ejecutando la tarea del agente:', error);
        throw new Error(error.stdout || error.message);
    }
}
