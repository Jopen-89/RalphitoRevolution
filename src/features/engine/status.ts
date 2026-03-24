import { readRuntimeSessionFile } from './runtimeFiles.js';
import { getRuntimeSessionRepository, type RuntimeSessionRecord } from './runtimeSessionRepository.js';
import { TmuxRuntime } from './tmuxRuntime.js';

export interface EngineStatusSession {
  id: string;
  status: string;
  projectId: string | null;
  role: 'worker';
  activity: string | null;
  branch: string | null;
  summary: string | null;
  failureKind: string | null;
  failureSummary: string | null;
  failureReasonCode: string | null;
  issue: string | null;
  prUrl: string | null;
  createdAt: string;
  lastActivityAt: string;
  lastActivityLabel: string;
  alive: boolean;
  source: 'ralphito_engine';
}

function mapSession(
  session: RuntimeSessionRecord,
  alive: boolean,
  branchName: string | null,
  projectId: string | null,
  summary: string | null,
) {
  return {
    id: session.runtimeSessionId,
    status: session.status,
    projectId,
    role: 'worker',
    activity: alive ? 'running' : session.status === 'running' || session.status === 'queued' ? 'stale' : session.status,
    branch: branchName,
    summary,
    failureKind: session.failureKind,
    failureSummary: session.failureSummary,
    failureReasonCode: session.failureReasonCode,
    issue: null,
    prUrl: null,
    createdAt: session.createdAt,
    lastActivityAt: session.heartbeatAt || session.updatedAt,
    lastActivityLabel: session.heartbeatAt || session.updatedAt,
    alive,
    source: 'ralphito_engine',
  } satisfies EngineStatusSession;
}

const TERMINAL_RUNTIME_STATUSES = new Set(['done', 'failed', 'cancelled', 'stuck']);

interface GetEngineSessionsStatusInput {
  sessions?: RuntimeSessionRecord[];
  tmuxRuntime?: Pick<TmuxRuntime, 'isAlive'>;
}

export async function getEngineSessionsStatus(input: GetEngineSessionsStatusInput = {}) {
  const sessions = input.sessions || getRuntimeSessionRepository().listRecent();
  const tmuxRuntime = input.tmuxRuntime || new TmuxRuntime();

  return Promise.all(
    sessions.map(async (session) => {
      const sessionFile = session.worktreePath ? readRuntimeSessionFile(session.worktreePath) : null;
      let alive = false;

      if (!TERMINAL_RUNTIME_STATUSES.has(session.status)) {
        try {
          alive = await tmuxRuntime.isAlive(session.runtimeSessionId);
        } catch {
          alive = false;
        }
      }

      const summary =
        session.failureSummary ||
        sessionFile?.workItemKey ||
        sessionFile?.beadPath ||
        session.agentId;

      return mapSession(
        session,
        alive,
        sessionFile?.branchName || null,
        sessionFile?.projectId || session.agentId,
        summary,
      );
    }),
  );
}

export function formatEngineSessionLine(session: EngineStatusSession) {
  const activity = session.alive ? 'alive' : 'dead';
  const reasonSuffix = session.failureReasonCode ? `  reason=${session.failureReasonCode}` : '';
  return `  ${session.id}  (${activity})  ${session.branch || '-'}  [${session.status}]  ${session.summary || '-'}${reasonSuffix}`;
}
