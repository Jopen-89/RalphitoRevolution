import type { Tool, ToolCall } from './toolRegistry.js';
import type { Provider, ToolDefinition } from '../../core/domain/gateway.types.js';
import { getOrchestrator } from '../../core/engine/orchestrator.js';
import { sendTelegramMessage, getAllowedChatId } from '../../interfaces/telegram/telegramSender.js';
import { loadAgentRegistry, resolveAgentReference } from '../../interfaces/telegram/agentRegistry.js';
import { invokeAgentInChatThread } from '../../interfaces/telegram/agentInvocationService.js';
import { BeadLifecycleService } from '../../core/services/BeadLifecycleService.js';
import { RuntimeSessionLifecycleService } from '../../core/services/RuntimeSessionLifecycleService.js';
import { normalizeBeadPriority } from '../../core/domain/bead.types.js';

const VALID_PROVIDERS = new Set<Provider>(['gemini', 'openai', 'opencode', 'codex']);

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

function optionalProvider(value: unknown): Provider | undefined {
  if (typeof value !== 'string') return undefined;
  return VALID_PROVIDERS.has(value as Provider) ? (value as Provider) : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}

function formatBacklogLine(index: number, item: ReturnType<typeof BeadLifecycleService.listBacklog>[number]) {
  const beadLabel = item.beadPath ? ` bead=${item.beadPath}` : '';
  const agentLabel = item.assignedAgent ? ` agent=${item.assignedAgent}` : '';
  return `${index + 1}. [${item.priority}/${item.status}] ${item.id} - ${item.title}${agentLabel}${beadLabel}`;
}

export const RAYMON_TOOL_NAMES = [
  'spawn_session',
  'list_project_backlog',
  'set_task_priority',
  'check_status',
  'resume_session',
  'run_divergence_phase',
  'summon_agent_to_chat',
  'cancel_session',
  'reap_stale_sessions',
] as const;

export type RaymonToolName = (typeof RAYMON_TOOL_NAMES)[number];

const CANCELLED_BY_RAYMON_SUMMARY = 'Sesión cancelada por Raymon via cancel_session';

export function isRaymonToolName(name: string): name is RaymonToolName {
  return RAYMON_TOOL_NAMES.includes(name as RaymonToolName);
}

interface RaymonToolContext {
  originThreadId?: number;
  notificationChatId?: string;
  currentAgentId?: string;
}

function assertRaymonCaller(context: RaymonToolContext, toolName: string) {
  if (context.currentAgentId && context.currentAgentId !== 'raymon') {
    throw new Error(`Tool '${toolName}' solo puede ser usada por Raymon. Caller actual: '${context.currentAgentId}'.`);
  }
}

export function createRaymonTools(context: RaymonToolContext = {}): Tool[] {
  const orchestrator = getOrchestrator();

  return [
    {
      name: 'spawn_session',
      description: 'Lanza una sesión de Ralphito para una task persistida en SQLite.',
      execute: async (params: Record<string, unknown>) => {
        const project = optionalString(params.project) || 'system';
        const taskId = optionalString(params.taskId);
        const beadPath = optionalString(params.beadPath);
        const prompt = optionalString(params.prompt);
        const provider = optionalProvider(params.provider);
        const model = optionalString(params.model);

        if (!taskId && !beadPath) {
          throw new Error("spawn_session requiere 'taskId' o 'beadPath'. Ejecución libre por prompt ya no está permitida.");
        }

        const result = await orchestrator.spawn({
          ...(project ? { project } : {}),
          ...(taskId ? { taskId } : {}),
          ...(prompt ? { prompt } : {}),
          ...(beadPath ? { beadPath } : {}),
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          ...(typeof context.originThreadId === 'number' ? { originThreadId: context.originThreadId } : {}),
          ...(context.notificationChatId ? { notificationChatId: context.notificationChatId } : {}),
        });

        return {
          taskId: result.taskId,
          executionJobId: result.executionJobId,
          sessionId: result.runtimeSessionId,
          baseCommitHash: result.baseCommitHash,
          worktreePath: result.worktreePath,
          branchName: result.branchName,
        };
      },
    },
    {
      name: 'list_project_backlog',
      description: 'Lista el backlog de tasks por proyecto y devuelve un orden recomendado para Raymon.',
      execute: async (params: Record<string, unknown>) => {
        const projectId = optionalString(params.projectId);
        const rawStatus = optionalString(params.status);
        const rawPriority = optionalString(params.priority);
        const assignedAgent = optionalString(params.assignedAgent);
        const limit = optionalPositiveNumber(params.limit) || 20;

        const normalizedStatus = rawStatus === 'all' || rawStatus === 'open' || rawStatus === 'pending' || rawStatus === 'in_progress' || rawStatus === 'blocked' || rawStatus === 'done' || rawStatus === 'failed' || rawStatus === 'cancelled'
          ? rawStatus
          : 'open';

        const tasks = BeadLifecycleService.listBacklog({
          ...(projectId ? { projectId } : {}),
          status: normalizedStatus,
          ...(rawPriority ? { priority: normalizeBeadPriority(rawPriority) } : {}),
          ...(assignedAgent ? { assignedAgent } : {}),
          limit,
        });

        return {
          projectId: projectId || null,
          status: normalizedStatus,
          priority: rawPriority ? normalizeBeadPriority(rawPriority) : null,
          assignedAgent: assignedAgent || null,
          total: tasks.length,
          recommendedOrder: tasks.map((task, index) => ({
            rank: index + 1,
            taskId: task.id,
            title: task.title,
            priority: task.priority,
            status: task.status,
            beadPath: task.beadPath,
          })),
          summary:
            tasks.length === 0
              ? 'No backlog tasks matched the current filters.'
              : tasks.map((task, index) => formatBacklogLine(index, task)).join('\n'),
        };
      },
    },
    {
      name: 'set_task_priority',
      description: 'Actualiza la prioridad de una task del backlog para reflejar la decision de Raymon.',
      execute: async (params: Record<string, unknown>) => {
        const taskId = optionalString(params.taskId);
        const beadPath = optionalString(params.beadPath);
        const projectId = optionalString(params.projectId);

        if (!taskId && !beadPath) {
          throw new Error("Parameter 'taskId' or 'beadPath' is required.");
        }

        const priority = normalizeBeadPriority(requireString(params.priority, 'priority'));
        const updated = BeadLifecycleService.setTaskPriority({
          ...(taskId ? { taskId } : {}),
          ...(beadPath ? { beadPath } : {}),
          ...(projectId ? { projectId } : {}),
          priority,
        });

        if (!updated) {
          throw new Error('Task not found for reprioritization.');
        }

        return {
          taskId: updated.id,
          projectId: updated.projectId,
          priority: updated.priority,
          status: updated.status,
          beadPath: updated.beadPath,
          success: true,
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
      name: 'resume_session',
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
        assertRaymonCaller(context, 'summon_agent_to_chat');
        const agentName = requireString(params.agentName, 'agentName');
        const agents = loadAgentRegistry();
        const agent = resolveAgentReference(agents, agentName);
        if (!agent) {
          throw new Error(`No conozco al agente '${agentName}'.`);
        }

        const instruction = optionalString(params.message) || `${agent.name}, Raymon te necesita en este hilo.`;

        const chatId = context.notificationChatId || getAllowedChatId();
        const statusText = `⏳ ${agent.name} (${agent.role}) se está incorporando al hilo...`;
        const result = await sendTelegramMessage(chatId, statusText, {
          senderPath: 'gateway.raymonTools.summon.status',
          agentId: agent.id,
        });

        if (!result.messageId) {
          throw new Error(`No pude publicar el mensaje inicial para ${agent.name}.`);
        }

        const agentResult = await invokeAgentInChatThread({
          chatId,
          agent,
          instruction,
          statusMessageId: result.messageId,
          initiator: {
            id: 'raymon',
            name: 'Raymon',
          },
        });

        return {
          success: result.success,
          agentName: agent.name,
          agentId: agent.id,
          message: instruction,
          messageId: result.messageId,
          sessionId: agentResult.sessionId,
          response: agentResult.response,
        };
      },
    },
    {
      name: 'cancel_session',
      description:
        'Cancela y mata una sesión específica de Ralphito. Útil cuando una sesión se queda colgada o necesita detenerse manualmente.',
      execute: async (params: Record<string, unknown>) => {
        const sessionId = requireString(params.sessionId, 'sessionId');
        const result = await new RuntimeSessionLifecycleService().cancel({
          runtimeSessionId: sessionId,
          reason: CANCELLED_BY_RAYMON_SUMMARY,
        });

        return {
          success: result.runtimeStopped,
          sessionId,
          killed: result.killed,
          message: result.runtimeStopped
            ? `Sesión ${sessionId} cancelada`
            : `No se pudo detener sesión ${sessionId}; queda cancelada y el loop la cerrará`,
        };
      },
    },
    {
      name: 'reap_stale_sessions',
      description:
        'Audita sesiones en la base de datos y marca como stuck/failed cualquier sesión que figure como running pero no tenga proceso TMUX vivo. Limpia locks y worktrees asociados.',
      execute: async () => {
        const result = await new RuntimeSessionLifecycleService().reapStaleSessions();

        return {
          audited: result.auditedSessions,
          staleSessionsFound: result.staleSessions.length,
          staleSessions: result.staleSessions,
          releasedLocks: result.releasedLocks,
          removedWorktrees: result.removedWorktrees,
          killedTmuxSessions: result.killedTmuxSessions,
          killedPids: result.killedPids,
          message:
            result.staleSessions.length === 0
              ? `Auditada ${result.auditedSessions} sesiones. Sin stale sessions.`
              : `Auditada ${result.auditedSessions} sesiones. Stale: ${result.staleSessions.join(', ')}`,
        };
      },
    },
  ];
}

export function createRaymonToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'spawn_session',
      description: 'Lanza una sesión de Ralphito para una task persistida.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Nombre del proyecto (opcional, por defecto: system)' },
          taskId: { type: 'string', description: 'ID canonico de la task persistida a ejecutar' },
          prompt: { type: 'string', description: 'Notas opcionales extra para el executor; ya no habilita spawn libre por sí solo' },
          beadPath: { type: 'string', description: 'Ruta del bead si no conoces taskId; debe existir task registrada' },
          provider: { type: 'string', description: 'Provider LLM real opcional: gemini, openai, opencode o codex' },
          model: { type: 'string', description: 'Modelo LLM real opcional para el loop del engine' },
        },
        required: [],
      },
    },
    {
      name: 'list_project_backlog',
      description: 'Lista backlog por proyecto con el orden recomendado para Raymon.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id canonico a consultar' },
          status: { type: 'string', description: 'Filtro de estado: open, all, pending, in_progress, blocked, done, failed o cancelled' },
          priority: { type: 'string', description: 'Filtro opcional de prioridad: low, medium o high' },
          assignedAgent: { type: 'string', description: 'Filtro opcional por agente asignado' },
          limit: { type: 'number', description: 'Cantidad maxima de tasks a devolver' },
        },
      },
    },
    {
      name: 'set_task_priority',
      description: 'Actualiza prioridad de una task del backlog.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID canonico de la task' },
          beadPath: { type: 'string', description: 'Ruta del bead si no se conoce taskId' },
          projectId: { type: 'string', description: 'Project id canonico para resolver beadPath relativo' },
          priority: { type: 'string', description: 'Nueva prioridad: low, medium o high' },
        },
        required: ['priority'],
      },
    },
    {
      name: 'check_status',
      description: 'Reporta estado consolidado de sesiones y guardrails de Ralphito.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'resume_session',
      description: 'Resucita un Ralphito que murió por guardrail.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID de la sesión a resume' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'run_divergence_phase',
      description: 'Inicia investigación paralela con 4 equipos de agentes.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID del proyecto' },
          seedIdea: { type: 'string', description: 'Idea inicial para divergencia' },
        },
        required: ['projectId', 'seedIdea'],
      },
    },
    {
      name: 'summon_agent_to_chat',
      description: 'Invoca a otro agente al chat de Telegram.',
      parameters: {
        type: 'object',
        properties: {
          agentName: { type: 'string', description: 'Nombre del agente a invocar (sin @)' },
          message: { type: 'string', description: 'Mensaje opcional de contexto' },
        },
        required: ['agentName'],
      },
    },
    {
      name: 'cancel_session',
      description: 'Cancela y mata una sesión específica de Ralphito.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID de la sesión a cancelar' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'reap_stale_sessions',
      description: 'Audita y limpia sesiones zombies (running sin TMUX vivo).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

export function createToolCall(id: string, name: string, arguments_: Record<string, unknown>): ToolCall {
  return { id, name, arguments: arguments_ };
}
