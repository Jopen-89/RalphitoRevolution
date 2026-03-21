import type { Tool, ToolCall } from './toolRegistry.js';
import { getRaymonOrchestrator } from '../../engine/raymonOrchestrator.js';

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
  ];
}

export function createToolCall(id: string, name: string, arguments_: Record<string, unknown>): ToolCall {
  return { id, name, arguments: arguments_ };
}
