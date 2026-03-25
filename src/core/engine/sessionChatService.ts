import { readFileSync } from 'fs';
import path from 'path';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import { deriveRuntimeTaskTitle, findRuntimeTaskLink } from './runtimeTaskLinking.js';
import { getGuardrailLogPath, getManagedRuntimeWorktreePath, readRuntimeSessionFile } from './runtimeFiles.js';

export interface SessionChatResult {
  externalChatId: string | null;
  notificationChatId: string | null;
  beadId: string | null;
  title: string | null;
  hasGuardrailError: boolean;
  guardrailError: string | null;
}

function truncateError(errorText: string) {
  const normalized = errorText.trim();
  if (normalized.length <= 700) return normalized;
  return `${normalized.slice(0, 697)}...`;
}

function getGuardrailErrorForSession(sessionId: string) {
  try {
    return truncateError(readFileSync(getGuardrailLogPath(getManagedRuntimeWorktreePath(sessionId)), 'utf8'));
  } catch {
    return null;
  }
}

function deriveFallbackBeadId(beadPath?: string | null) {
  if (!beadPath) return null;
  return path.basename(beadPath, path.extname(beadPath));
}

export function getSessionChat(sessionId: string): SessionChatResult {
  const db = getRalphitoDatabase();

  const session = db
    .prepare(
      `
        SELECT
          notification_chat_id AS notificationChatId,
          thread_id AS threadId,
          origin_thread_id AS originThreadId,
          worktree_path AS worktreePath
        FROM agent_sessions
        WHERE runtime_session_id = ?
        LIMIT 1
      `,
    )
    .get(sessionId) as {
      notificationChatId: string | null;
      threadId: number;
      originThreadId: number | null;
      worktreePath: string | null;
    } | undefined;

  const thread = session
    ? (db
        .prepare(
          `
            SELECT channel, external_chat_id AS externalChatId
            FROM threads
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(session.originThreadId ?? session.threadId) as {
          channel: string | null;
          externalChatId: string | null;
        } | undefined)
    : undefined;

  const sessionFile = session?.worktreePath ? readRuntimeSessionFile(session.worktreePath) : null;
  const task = findRuntimeTaskLink({
    runtimeSessionId: sessionId,
    projectId: sessionFile?.projectId ?? null,
    workItemKey: sessionFile?.workItemKey ?? null,
    beadPath: sessionFile?.beadPath ?? null,
  });
  const guardrailError = getGuardrailErrorForSession(sessionId);

  return {
    externalChatId:
      session?.notificationChatId ??
      (thread?.channel === 'telegram' ? thread.externalChatId : null) ??
      null,
    notificationChatId: session?.notificationChatId ?? null,
    beadId: task?.id ?? sessionFile?.workItemKey ?? deriveFallbackBeadId(sessionFile?.beadPath) ?? null,
    title: task?.title ?? deriveRuntimeTaskTitle(sessionFile?.beadPath) ?? null,
    hasGuardrailError: guardrailError !== null,
    guardrailError,
  };
}
