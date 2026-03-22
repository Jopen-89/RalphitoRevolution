import type { Tool, ToolCall } from './toolRegistry.js';
import type { ToolDefinition } from '../interfaces/gateway.types.js';
import { getRaymonOrchestrator } from '../../engine/raymonOrchestrator.js';
import { sendTelegramMessage, getAllowedChatId } from '../../telegram/telegramSender.js';

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Parameter '${name}' must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

export const RAYMON_TOOL_NAMES = [
  'spawn_executor',
  'check_status',
  'resume_executor',
  'run_divergence_phase',
  'summon_agent_to_chat',
] as const;

export type RaymonToolName = (typeof RAYMON_TOOL_NAMES)[number];

export function isRaymonToolName(name: string): name is RaymonToolName {
  return RAYMON_TOOL_NAMES.includes(name as RaymonToolName);
}

export function createRaymonTools(): Tool[] {
  const orchestrator = getRaymonOrchestrator();

  return [
    {
      name: 'spawn_executor',
      description: 'Lanza un Ralphito executor con una tarea de implementación.',
      execute: async (params: Record<string, unknown>) => {
        const project = requireString(params.project, 'project');
        const prompt = requireString(params.prompt, 'prompt');
        const beadPath = optionalString(params.beadPath);

        const result = await orchestrator.spawn({
          project,
          prompt,
          ...(beadPath ? { beadPath } : {}),
        });

        return {
          sessionId: result.runtimeSessionId,
          baseCommitHash: result.baseCommitHash,
          worktreePath: result.worktreePath,
          branchName: result.branchName,
        };
      },
    },
    {
      name: 'check_status',
      description: 'Reporta estado consolidado de sesiones y guardrails de Ralphito.',
      execute: async () => {
        const status = await orchestrator.getStatus();

        const lines: string[] = [];

        if (status.sessions.length === 0) {
          lines.push('No hay sesiones activas.');
        } else {
          lines.push(`Sesiones activas: ${status.sessions.filter((s) => s.alive).length} / ${status.sessions.length}`);
          for (const session of status.sessions) {
            lines.push(`- ${session.id} [${session.status}] alive=${session.alive}`);
          }
        }

        if (status.guardrailFailures.length > 0) {
          lines.push(`Ralphitos caídos: ${status.guardrailFailures.length}`);
          for (const f of status.guardrailFailures) {
            lines.push(`- ${f.sessionId}: ${f.errorSnippet.split('\n')[0]}`);
          }
        }

        lines.push(`Autopilot: ${status.autopilotActive ? 'activo' : 'inactivo'}`);

        return lines.join('\n');
      },
    },
    {
      name: 'resume_executor',
      description: 'Resucita un Ralphito que murió por guardrail.',
      execute: async (params: Record<string, unknown>) => {
        const sessionId = requireString(params.sessionId, 'sessionId');
        const result = await orchestrator.resume(sessionId);
        return result;
      },
    },
    {
      name: 'run_divergence_phase',
      description: 'Inicia investigación paralela con 4 equipos de agentes.',
      execute: async (params: Record<string, unknown>) => {
        const projectId = requireString(params.projectId, 'projectId');
        const seedIdea = requireString(params.seedIdea, 'seedIdea');

        const result = await orchestrator.launchDivergence(projectId, seedIdea);
        return result;
      },
    },
    {
      name: 'summon_agent_to_chat',
      description:
        'Invoca a otro agente al chat de Telegram de forma programática, mencionándolo por su nombre. Útil para que Raymon llame a Moncho, Poncho, Lola, etc. cuando necesite su input.',
      execute: async (params: Record<string, unknown>) => {
        const agentName = requireString(params.agentName, 'agentName');
        const message = optionalString(params.message) || `Hey @${agentName}, necesitas intervenir aquí.`;

        const chatId = getAllowedChatId();
        const result = await sendTelegramMessage(chatId, message);

        return {
          success: result.success,
          agentName,
          message,
          messageId: result.messageId,
        };
      },
    },
  ];
}

export function createRaymonToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'spawn_executor',
      description: 'Lanza un Ralphito executor con una tarea de implementación.',
      parameters: {
        project: { type: 'string', description: 'Nombre del proyecto backend-team' },
        prompt: { type: 'string', description: 'Prompt de la tarea a ejecutar' },
        beadPath: { type: 'string', description: 'Ruta opcional del bead' },
      },
    },
    {
      name: 'check_status',
      description: 'Reporta estado consolidado de sesiones y guardrails de Ralphito.',
      parameters: {},
    },
    {
      name: 'resume_executor',
      description: 'Resucita un Ralphito que murió por guardrail.',
      parameters: {
        sessionId: { type: 'string', description: 'ID de la sesión a resume' },
      },
    },
    {
      name: 'run_divergence_phase',
      description: 'Inicia investigación paralela con 4 equipos de agentes.',
      parameters: {
        projectId: { type: 'string', description: 'ID del proyecto' },
        seedIdea: { type: 'string', description: 'Idea inicial para divergencia' },
      },
    },
    {
      name: 'summon_agent_to_chat',
      description: 'Invoca a otro agente al chat de Telegram.',
      parameters: {
        agentName: { type: 'string', description: 'Nombre del agente a invocar (sin @)' },
        message: { type: 'string', description: 'Mensaje opcional de contexto' },
      },
    },
  ];
}

export function createToolCall(id: string, name: string, arguments_: Record<string, unknown>): ToolCall {
  return { id, name, arguments: arguments_ };
}
