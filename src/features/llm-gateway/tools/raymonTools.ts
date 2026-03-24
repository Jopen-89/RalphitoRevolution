import type { Tool, ToolCall } from './toolRegistry.js';
import type { Provider, ToolDefinition } from '../interfaces/gateway.types.js';
import { getRaymonOrchestrator } from '../../engine/raymonOrchestrator.js';
import { sendTelegramMessage, getAllowedChatId } from '../../telegram/telegramSender.js';
import { TmuxRuntime } from '../../engine/tmuxRuntime.js';
import { getRuntimeSessionRepository } from '../../engine/runtimeSessionRepository.js';
import { getRuntimeLockRepository } from '../../engine/runtimeLockRepository.js';
import { WorktreeManager } from '../../engine/worktreeManager.js';

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

export const RAYMON_TOOL_NAMES = [
  'spawn_executor',
  'check_status',
  'resume_executor',
  'run_divergence_phase',
  'summon_agent_to_chat',
  'cancel_executor',
  'cleanup_zombies',
] as const;

export type RaymonToolName = (typeof RAYMON_TOOL_NAMES)[number];

export function isRaymonToolName(name: string): name is RaymonToolName {
  return RAYMON_TOOL_NAMES.includes(name as RaymonToolName);
}

interface RaymonToolContext {
  originThreadId?: number;
  notificationChatId?: string;
}

export function createRaymonTools(context: RaymonToolContext = {}): Tool[] {
  const orchestrator = getRaymonOrchestrator();

  return [
    {
      name: 'spawn_executor',
      description: 'Lanza un Ralphito executor con una tarea de implementación.',
      execute: async (params: Record<string, unknown>) => {
        const project = optionalString(params.project) || 'backend-team';
        const prompt = requireString(params.prompt, 'prompt');
        const beadPath = optionalString(params.beadPath);
        const provider = optionalProvider(params.provider);
        const model = optionalString(params.model);

        const result = await orchestrator.spawn({
          project,
          prompt,
          ...(beadPath ? { beadPath } : {}),
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          ...(typeof context.originThreadId === 'number' ? { originThreadId: context.originThreadId } : {}),
          ...(context.notificationChatId ? { notificationChatId: context.notificationChatId } : {}),
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
    {
      name: 'cancel_executor',
      description:
        'Cancela y mata una sesión específica de Ralphito. Útil cuando una sesión se queda colgada o necesita detenerse manualmente.',
      execute: async (params: Record<string, unknown>) => {
        const sessionId = requireString(params.sessionId, 'sessionId');

        const tmuxRuntime = new TmuxRuntime();
        const killed = await tmuxRuntime.killSession(sessionId);

        const sessionRepo = getRuntimeSessionRepository();
        const session = sessionRepo.getByRuntimeSessionId(sessionId);

        if (session) {
          sessionRepo.fail({
            runtimeSessionId: sessionId,
            failureKind: 'cancelled_by_user',
            failureSummary: 'Sesión cancelada por Raymon via cancel_executor',
          });

          const lockRepo = getRuntimeLockRepository();
          lockRepo.releaseForSession(sessionId);
        }

        return {
          success: killed,
          sessionId,
          killed,
          message: killed
            ? `Sesión ${sessionId} cancelada`
            : `No se pudo matar sesión ${sessionId} (puede que ya esté muerta)`,
        };
      },
    },
    {
      name: 'cleanup_zombies',
      description:
        'Audita sesiones en la base de datos y marca como stuck/failed cualquier sesión que figure como running pero no tenga proceso TMUX vivo. Limpia locks y worktrees asociados.',
      execute: async () => {
        const tmuxRuntime = new TmuxRuntime();
        const sessionRepo = getRuntimeSessionRepository();
        const lockRepo = getRuntimeLockRepository();
        const worktreeManager = new WorktreeManager();
        const nowIso = new Date().toISOString();

        const sessions = sessionRepo.listActive();
        const zombies: string[] = [];

        for (const session of sessions) {
          if (session.status !== 'running') continue;

          const alive = await tmuxRuntime.isAlive(session.runtimeSessionId);
          if (!alive) {
            sessionRepo.markStuck({
              runtimeSessionId: session.runtimeSessionId,
              failureKind: 'zombie_session',
              failureSummary: `Sesión marcada running pero tmux murió sin razón`,
              heartbeatAt: nowIso,
              finishedAt: nowIso,
            });
            lockRepo.releaseForSession(session.runtimeSessionId);

            if (session.worktreePath && worktreeManager.isManagedWorkspace(session.worktreePath)) {
              await worktreeManager.teardownWorkspacePath(session.worktreePath);
            }

            zombies.push(session.runtimeSessionId);
          }
        }

        return {
          audited: sessions.length,
          zombiesFound: zombies.length,
          zombies,
          message:
            zombies.length === 0
              ? `Auditada ${sessions.length} sesiones. Sin zombies.`
              : `Auditada ${sessions.length} sesiones. Zombies encontrados: ${zombies.join(', ')}`,
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
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Nombre del proyecto (opcional, por defecto: backend-team)' },
          prompt: { type: 'string', description: 'Prompt de la tarea a ejecutar' },
          beadPath: { type: 'string', description: 'Ruta opcional del bead' },
          provider: { type: 'string', description: 'Provider LLM real opcional: gemini, openai, opencode o codex' },
          model: { type: 'string', description: 'Modelo LLM real opcional para el loop del engine' },
        },
        required: ['prompt'],
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
      name: 'resume_executor',
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
      name: 'cancel_executor',
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
      name: 'cleanup_zombies',
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
