import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';

interface SummaryRow {
  summary: string;
  createdAt: string;
}

interface MessageRow {
  senderName: string | null;
  rawText: string;
  createdAt: string;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assignedAgent: string | null;
  updatedAt: string;
  componentPath: string | null;
}

interface TaskEventRow {
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

interface SessionTaskRow {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface MemoryContextBundle {
  threadSummary: string | null;
  sessionSummary: string | null;
  taskSummary: string | null;
}

const THREAD_SCOPE = 'thread';
const SESSION_SCOPE = 'runtime_session';
const TASK_SCOPE = 'task';
const MAX_MESSAGE_POINTS = 6;
const MAX_EVENT_POINTS = 6;

function trimText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function safeParsePayload(payloadJson: string) {
  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function persistSummary(scopeType: string, scopeId: string, summary: string) {
  const db = getRalphitoDatabase();
  const latest = db
    .prepare(
      `
        SELECT summary, created_at AS createdAt
        FROM session_summaries
        WHERE scope_type = ? AND scope_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(scopeType, scopeId) as SummaryRow | undefined;

  if (latest?.summary === summary) {
    return summary;
  }

  db.prepare(
    'INSERT INTO session_summaries (scope_type, scope_id, summary, created_at) VALUES (?, ?, ?, ?)',
  ).run(scopeType, scopeId, summary, new Date().toISOString());

  return summary;
}

export function getLatestSummary(scopeType: string, scopeId: string) {
  const db = getRalphitoDatabase();
  const row = db
    .prepare(
      `
        SELECT summary
        FROM session_summaries
        WHERE scope_type = ? AND scope_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(scopeType, scopeId) as { summary: string } | undefined;

  return row?.summary || null;
}

export function refreshThreadSummary(chatId: string) {
  const db = getRalphitoDatabase();
  const messages = db
    .prepare(
      `
        SELECT messages.sender_name AS senderName, messages.raw_text AS rawText, messages.created_at AS createdAt
        FROM threads
        INNER JOIN messages ON messages.thread_id = threads.id
        WHERE threads.channel = 'telegram' AND threads.external_chat_id = ?
        ORDER BY messages.created_at DESC, messages.id DESC
        LIMIT ?
      `,
    )
    .all(chatId, MAX_MESSAGE_POINTS) as MessageRow[];

  if (messages.length === 0) return null;

  const ordered = [...messages].reverse();
  const bullets = ordered.map(
    (message) => `- ${message.senderName || 'Sistema'}: ${trimText(message.rawText, 140)}`,
  );
  const summary = ['Resumen persistente del hilo de Telegram:', ...bullets].join('\n');

  return persistSummary(THREAD_SCOPE, chatId, summary);
}

export function refreshRuntimeSessionSummary(sessionId: string) {
  const db = getRalphitoDatabase();
  const sessionTasks = db
    .prepare(
      `
        SELECT id, title, status, updated_at AS updatedAt
        FROM tasks
        WHERE runtime_session_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 3
      `,
    )
    .all(sessionId) as SessionTaskRow[];

  const messages = db
    .prepare(
      `
        SELECT messages.sender_name AS senderName, messages.raw_text AS rawText, messages.created_at AS createdAt
        FROM agent_sessions
        INNER JOIN threads ON threads.id = COALESCE(agent_sessions.origin_thread_id, agent_sessions.thread_id)
        INNER JOIN messages ON messages.thread_id = threads.id
        WHERE agent_sessions.runtime_session_id = ?
        ORDER BY messages.created_at DESC, messages.id DESC
        LIMIT ?
      `,
    )
    .all(sessionId, 4) as MessageRow[];

  if (sessionTasks.length === 0 && messages.length === 0) return null;

  const sections: string[] = ['Resumen persistente de la runtime session:'];

  if (sessionTasks.length > 0) {
    sections.push(...sessionTasks.map((task) => `- task ${task.id}: ${task.status} (${trimText(task.title, 80)})`));
  }

  if (messages.length > 0) {
    sections.push(...[...messages].reverse().map((message) => `- ${message.senderName || 'Sistema'} dijo: ${trimText(message.rawText, 120)}`));
  }

  return persistSummary(SESSION_SCOPE, sessionId, sections.join('\n'));
}

export function refreshTaskSummary(taskId: string) {
  const db = getRalphitoDatabase();
  const task = db
    .prepare(
      `
        SELECT id, title, status, assigned_agent AS assignedAgent, updated_at AS updatedAt, component_path AS componentPath
        FROM tasks
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(taskId) as TaskRow | undefined;

  if (!task) return null;

  const events = db
    .prepare(
      `
        SELECT event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
        FROM task_events
        WHERE task_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(taskId, MAX_EVENT_POINTS) as TaskEventRow[];

  const eventBullets = events.reverse().map((event) => {
    const payload = safeParsePayload(event.payloadJson);
    const status = typeof payload?.status === 'string' ? payload.status : null;
    const reason = typeof payload?.failureReason === 'string' ? payload.failureReason : null;
    const agent = typeof payload?.assignedAgent === 'string' ? payload.assignedAgent : null;
    const parts = [event.eventType];
    if (status) parts.push(`status=${status}`);
    if (agent) parts.push(`agent=${agent}`);
    if (reason) parts.push(`reason=${trimText(reason, 80)}`);
    return `- ${parts.join(' · ')}`;
  });

  const summary = [
    `Resumen persistente de task ${task.id}:`,
    `- titulo: ${trimText(task.title, 100)}`,
    `- estado actual: ${task.status}`,
    `- agente: ${task.assignedAgent || 'sin asignar'}`,
    `- componente: ${task.componentPath || 'sin component_path'}`,
    ...eventBullets,
  ].join('\n');

  return persistSummary(TASK_SCOPE, taskId, summary);
}

export function getLatestTaskIdForSession(sessionId: string) {
  const db = getRalphitoDatabase();
  const row = db
    .prepare(
      `
        SELECT id
        FROM tasks
        WHERE runtime_session_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(sessionId) as { id: string } | undefined;

  return row?.id || null;
}

export function refreshMemoryContext(chatId: string, sessionId?: string | null): MemoryContextBundle {
  const threadSummary = refreshThreadSummary(chatId);

  if (!sessionId) {
    return {
      threadSummary,
      sessionSummary: null,
      taskSummary: null,
    };
  }

  const sessionSummary = refreshRuntimeSessionSummary(sessionId);
  const taskId = getLatestTaskIdForSession(sessionId);
  const taskSummary = taskId ? refreshTaskSummary(taskId) : null;

  return {
    threadSummary,
    sessionSummary,
    taskSummary,
  };
}

export function formatMemoryContext(bundle: MemoryContextBundle) {
  const sections = [bundle.threadSummary, bundle.sessionSummary, bundle.taskSummary].filter(
    (value): value is string => Boolean(value),
  );

  if (sections.length === 0) return '';

  return ['[MEMORIA PERSISTENTE]', ...sections, '[FIN DE MEMORIA PERSISTENTE]'].join('\n\n');
}
