import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { getAoStructuredSessions, type AoStructuredSession } from '../ao/aoSessionAdapter.js';
import { getRalphitoDatabase } from '../persistence/db/index.js';
import { updateTaskStatus, type RalphitoTaskStatus } from '../tasks/taskStateService.js';

interface ThreadRow {
  threadId: number;
  channel: string;
  externalChatId: string;
  title: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  sourceSpecPath: string | null;
  componentPath: string | null;
  status: RalphitoTaskStatus;
  assignedAgent: string | null;
  aoSessionId: string | null;
  priority: string;
  updatedAt: string;
  completedAt: string | null;
}

interface MessageRow {
  id: number;
  senderName: string | null;
  senderType: string;
  role: string | null;
  rawText: string;
  createdAt: string;
}

interface EventRow {
  id: number;
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

interface AgentSessionRow {
  agentId: string;
  status: string;
  updatedAt: string;
}

interface DashboardSessionMeta {
  thread: ThreadRow | null;
  task: TaskRow | null;
  lastGuardrailError: string | null;
  agentSession: AgentSessionRow | null;
}

export interface UnifiedDashboardSession {
  id: string;
  projectId: string | null;
  role: 'worker' | 'orchestrator';
  status: string | null;
  activity: string | null;
  branch: string | null;
  summary: string | null;
  issue: string | null;
  prUrl: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
  source: 'dashboard_api' | 'ao_status_json';
  thread: {
    id: number;
    channel: string;
    externalChatId: string;
    title: string | null;
  } | null;
  activeTask: {
    id: string;
    title: string;
    status: RalphitoTaskStatus;
    priority: string;
    updatedAt: string;
  } | null;
  agentBinding: {
    agentId: string;
    status: string;
    updatedAt: string;
  } | null;
  lastGuardrailError: string | null;
}

export interface UnifiedDashboardSessionDetail {
  session: UnifiedDashboardSession;
  messages: Array<{
    id: number;
    senderName: string | null;
    senderType: string;
    role: string | null;
    text: string;
    createdAt: string;
  }>;
  timeline: Array<{
    id: number;
    eventType: string;
    payload: unknown;
    createdAt: string;
  }>;
}

const AO_DATA_DIR = process.env.AO_DATA_DIR || path.join(process.env.HOME || '', '.agent-orchestrator');
const MESSAGE_LIMIT = 20;
const TIMELINE_LIMIT = 20;

function truncateError(errorText: string) {
  const normalized = errorText.trim();
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 697)}...`;
}

function getGuardrailErrorForSession(sessionId: string) {
  try {
    const orchestratorDirs = readdirSync(AO_DATA_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const dir of orchestratorDirs) {
      const errorPath = path.join(AO_DATA_DIR, dir.name, 'worktrees', sessionId, '.guardrail_error.log');
      try {
        return truncateError(readFileSync(errorPath, 'utf8'));
      } catch {
        // continue
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getSessionMeta(sessionId: string): DashboardSessionMeta {
  const db = getRalphitoDatabase();

  const thread = db
    .prepare(
      `
        SELECT
          threads.id AS threadId,
          threads.channel AS channel,
          threads.external_chat_id AS externalChatId,
          threads.title AS title
        FROM agent_sessions
        INNER JOIN threads ON threads.id = agent_sessions.thread_id
        WHERE agent_sessions.ao_session_id = ?
        LIMIT 1
      `,
    )
    .get(sessionId) as ThreadRow | undefined;

  const task = db
    .prepare(
      `
        SELECT
          id,
          title,
          source_spec_path AS sourceSpecPath,
          component_path AS componentPath,
          status,
          assigned_agent AS assignedAgent,
          ao_session_id AS aoSessionId,
          priority,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM tasks
        WHERE ao_session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `,
    )
    .get(sessionId) as TaskRow | undefined;

  const agentSession = db
    .prepare(
      `
        SELECT agent_id AS agentId, status, updated_at AS updatedAt
        FROM agent_sessions
        WHERE ao_session_id = ?
        LIMIT 1
      `,
    )
    .get(sessionId) as AgentSessionRow | undefined;

  return {
    thread: thread || null,
    task: task || null,
    agentSession: agentSession || null,
    lastGuardrailError: getGuardrailErrorForSession(sessionId),
  };
}

function toUnifiedSession(session: AoStructuredSession, meta: DashboardSessionMeta): UnifiedDashboardSession {
  return {
    ...session,
    thread: meta.thread
      ? {
          id: meta.thread.threadId,
          channel: meta.thread.channel,
          externalChatId: meta.thread.externalChatId,
          title: meta.thread.title,
        }
      : null,
    activeTask: meta.task
      ? {
          id: meta.task.id,
          title: meta.task.title,
          status: meta.task.status,
          priority: meta.task.priority,
          updatedAt: meta.task.updatedAt,
        }
      : null,
    agentBinding: meta.agentSession,
    lastGuardrailError: meta.lastGuardrailError,
  };
}

export async function getUnifiedDashboardSessions() {
  const sessions = await getAoStructuredSessions();

  return sessions.map((session) => toUnifiedSession(session, getSessionMeta(session.id)));
}

export async function getUnifiedDashboardSessionDetail(sessionId: string): Promise<UnifiedDashboardSessionDetail | null> {
  const sessions = await getUnifiedDashboardSessions();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) return null;

  const db = getRalphitoDatabase();
  const messages = session.thread
    ? ((db
        .prepare(
          `
            SELECT id, sender_name AS senderName, sender_type AS senderType, role, raw_text AS rawText, created_at AS createdAt
            FROM messages
            WHERE thread_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          `,
        )
        .all(session.thread.id, MESSAGE_LIMIT) as MessageRow[])
        .reverse()
        .map((message) => ({
          id: message.id,
          senderName: message.senderName,
          senderType: message.senderType,
          role: message.role,
          text: message.rawText,
          createdAt: message.createdAt,
        })))
    : [];

  const timeline = session.activeTask
    ? ((db
        .prepare(
          `
            SELECT id, event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
            FROM task_events
            WHERE task_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          `,
        )
        .all(session.activeTask.id, TIMELINE_LIMIT) as EventRow[])
        .reverse()
        .map((event) => ({
          id: event.id,
          eventType: event.eventType,
          payload: JSON.parse(event.payloadJson),
          createdAt: event.createdAt,
        })))
    : [];

  return {
    session,
    messages,
    timeline,
  };
}

export async function updateDashboardTaskStatus(taskId: string, status: RalphitoTaskStatus) {
  const db = getRalphitoDatabase();
  const task = db
    .prepare(
      `
        SELECT id, source_spec_path AS sourceSpecPath, assigned_agent AS assignedAgent, ao_session_id AS aoSessionId
        FROM tasks
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(taskId) as { id: string; sourceSpecPath: string | null; assignedAgent: string | null; aoSessionId: string | null } | undefined;

  if (!task || !task.sourceSpecPath) {
    return false;
  }

  updateTaskStatus({
    sourceSpecPath: task.sourceSpecPath,
    taskId,
    status,
    ...(task.assignedAgent ? { assignedAgent: task.assignedAgent } : {}),
    ...(task.aoSessionId ? { aoSessionId: task.aoSessionId } : {}),
  });

  return true;
}
