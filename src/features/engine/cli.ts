import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  getRuntimeLockRepository,
  RuntimeLockConflictError,
  type RuntimeLockConflict,
} from './runtimeLockRepository.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';
import { RuntimeReaper } from './runtimeReaper.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';
import { WorktreeManager } from './worktreeManager.js';
import { SessionSupervisor } from './sessionSupervisor.js';
import { ExecutorLoop } from './executorLoop.js';
import { agentLoop } from './agentLoop.js';
import { getEngineSessionsStatus, formatEngineSessionLine } from './status.js';
import { resumeRuntimeSession } from './resume.js';
import {
  clearRuntimeFailureRecord,
  readRuntimeSessionFile,
  writeRuntimeFailureRecord,
} from './runtimeFiles.js';
import {
  enqueueEngineNotification,
  getEngineNotificationRepository,
} from './engineNotifications.js';
import { EngineNotificationDispatcher } from '../telegram/engineNotificationDispatcher.js';
import type { Provider } from '../llm-gateway/interfaces/gateway.types.js';

function printJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function relativeToCwd(targetPath: string) {
  return path.relative(process.cwd(), targetPath) || '.';
}

function serializeConflict(conflict: RuntimeLockConflict) {
  return {
    relation: conflict.relation,
    requestedPath: conflict.requestedPath,
    requestedRepoPath: relativeToCwd(conflict.requestedPath),
    blockingPath: conflict.blockingLock.path,
    blockingRepoPath: relativeToCwd(conflict.blockingLock.path),
    blockingRuntimeSessionId: conflict.blockingLock.runtimeSessionId,
  };
}

function formatConflictMessage(conflict: RuntimeLockConflict) {
  return [
    'MUTEX COLLISION:',
    `lock ${conflict.relation} activo en ${relativeToCwd(conflict.blockingLock.path)}`,
    `por sesion ${conflict.blockingLock.runtimeSessionId}.`,
  ].join(' ');
}

function readTailFromLog(logPath?: string) {
  if (!logPath || !existsSync(logPath)) return null;

  const lines = readFileSync(logPath, 'utf8').trim().split('\n');
  return lines.slice(-40).join('\n').trim() || null;
}

function readProvider(value: string | undefined): Provider | null {
  if (!value) return null;
  const normalized = value.trim();
  switch (normalized) {
    case 'gemini':
    case 'openai':
    case 'opencode':
    case 'codex':
      return normalized;
    default:
      return null;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const lockRepository = getRuntimeLockRepository();
  const sessionRepository = getRuntimeSessionRepository();

  switch (command) {
    case 'spawn-session': {
      const payloadFile = args[0];
      if (!payloadFile) {
        throw new Error('Uso: cli.ts spawn-session <payload_file>');
      }

      const supervisor = new SessionSupervisor();
      const payload = JSON.parse(readFileSync(payloadFile, 'utf8')) as Parameters<SessionSupervisor['spawn']>[0];
      const result = await supervisor.spawn(payload);

      printJson({
        status: 'success',
        session_id: result.runtimeSessionId,
        base_commit_hash: result.baseCommitHash,
        worktree_path: result.worktreePath,
        branch_name: result.branchName,
        message: 'Ralphito Engine inició la sesión y lanzó el executor loop.',
      });
      return;
    }

    case 'run-loop': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts run-loop <runtime_session_id>');
      }

      printJson({
        status: 'ok',
        ...(await new ExecutorLoop().run({ runtimeSessionId })),
      });
      return;
    }

    case 'agent-loop': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts agent-loop <runtime_session_id>');
      }

      const session = sessionRepository.getByRuntimeSessionId(runtimeSessionId);
      if (!session) {
        throw new Error(`Sesión no encontrada: ${runtimeSessionId}`);
      }

      const worktreePath = session.worktreePath;
      if (!worktreePath) {
        throw new Error(`Sesión sin worktreePath: ${runtimeSessionId}`);
      }

      const sessionFile = readRuntimeSessionFile(worktreePath);
      const provider = readProvider(process.env.RALPHITO_LLM_PROVIDER) || sessionFile?.provider || null;
      const model = process.env.RALPHITO_LLM_MODEL?.trim() || sessionFile?.model || null;

      const result = await agentLoop({
        runtimeSessionId,
        worktreePath,
        systemPrompt: process.env.RALPHITO_SYSTEM_PROMPT || '',
        instruction: process.env.RALPHITO_INSTRUCTION || '',
        provider,
        model,
      });

      process.exitCode = result.exitCode;
      printJson({
        status: result.exitCode === 0 ? 'done' : 'failed',
        runtimeSessionId,
        iterations: result.iterations,
        lastResponse: result.lastResponse,
      });
      return;
    }

    case 'resolve-write-scope': {
      const beadPath = args[0];
      if (!beadPath) throw new Error('Uso: cli.ts resolve-write-scope <bead_path>');

      printJson({
        status: 'ok',
        targets: resolveWriteScopeTargetsFromBeadFile(beadPath),
      });
      return;
    }

    case 'preflight-locks': {
      const beadPath = args[0];
      if (!beadPath) throw new Error('Uso: cli.ts preflight-locks <bead_path>');

      const targets = resolveWriteScopeTargetsFromBeadFile(beadPath);
      const conflict = lockRepository.findActiveConflict(targets);

      if (conflict) {
        printJson({
          status: 'error',
          message: formatConflictMessage(conflict),
          conflict: serializeConflict(conflict),
        });
        process.exitCode = 1;
        return;
      }

      printJson({ status: 'ok', targets });
      return;
    }

    case 'acquire-locks': {
      const runtimeSessionId = args[0];
      const beadPath = args[1];
      if (!runtimeSessionId || !beadPath) {
        throw new Error('Uso: cli.ts acquire-locks <runtime_session_id> <bead_path>');
      }

      const targets = resolveWriteScopeTargetsFromBeadFile(beadPath);
      const locks = lockRepository.acquireForSession({ runtimeSessionId, targets });

      printJson({ status: 'ok', locks });
      return;
    }

    case 'release-locks': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) throw new Error('Uso: cli.ts release-locks <runtime_session_id>');

      printJson({
        status: 'ok',
        released: lockRepository.releaseForSession(runtimeSessionId),
      });
      return;
    }

    case 'heartbeat-locks': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) throw new Error('Uso: cli.ts heartbeat-locks <runtime_session_id>');

      printJson({
        status: 'ok',
        locks: lockRepository.heartbeat({ runtimeSessionId }),
      });
      return;
    }

    case 'create-workspace': {
      const runtimeSessionId = args[0];
      const baseCommit = args[1];
      if (!runtimeSessionId || !baseCommit) {
        throw new Error('Uso: cli.ts create-workspace <runtime_session_id> <base_commit>');
      }

      const worktreeManager = new WorktreeManager();
      const worktreePath = await worktreeManager.createWorkspace(runtimeSessionId, baseCommit);

      printJson({ status: 'ok', worktreePath });
      return;
    }

    case 'teardown-workspace': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts teardown-workspace <runtime_session_id>');
      }

      const worktreeManager = new WorktreeManager();
      printJson({
        status: 'ok',
        removed: await worktreeManager.teardownWorkspace(runtimeSessionId),
      });
      return;
    }

    case 'reap-stale': {
      const reaper = new RuntimeReaper(
        getRuntimeSessionRepository(),
        lockRepository,
        new WorktreeManager(),
      );

      printJson({
        status: 'ok',
        ...(await reaper.reap()),
      });
      return;
    }

    case 'heartbeat-session': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts heartbeat-session <runtime_session_id>');
      }

      const session = sessionRepository.heartbeat({
        runtimeSessionId,
      });
      lockRepository.heartbeat({ runtimeSessionId });
      printJson({ status: 'ok', session });
      return;
    }

    case 'record-step': {
      const runtimeSessionId = args[0];
      const stepDelta = Number.parseInt(args[1] || '1', 10);
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts record-step <runtime_session_id> [delta]');
      }

      const session = sessionRepository.incrementStepCount({
        runtimeSessionId,
        stepDelta: Number.isFinite(stepDelta) ? stepDelta : 1,
      });
      lockRepository.heartbeat({ runtimeSessionId });
      printJson({ status: 'ok', session });
      return;
    }

    case 'record-failure': {
      const runtimeSessionId = args[0];
      const failureKind = args[1];
      const failureSummary = args[2];
      const logPath = args[3];
      if (!runtimeSessionId || !failureKind || !failureSummary) {
        throw new Error('Uso: cli.ts record-failure <runtime_session_id> <kind> <summary> [log_path]');
      }

      const failureLogTail = readTailFromLog(logPath);
      const existingSession = sessionRepository.getByRuntimeSessionId(runtimeSessionId);
      if (existingSession?.worktreePath) {
        const nowIso = new Date().toISOString();
        writeRuntimeFailureRecord(existingSession.worktreePath, {
          runtimeSessionId,
          kind: failureKind,
          summary: failureSummary,
          reasonCode: null,
          logTail: failureLogTail,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      const session = sessionRepository.fail({
        runtimeSessionId,
        failureKind,
        failureSummary,
        ...(failureLogTail ? { failureLogTail } : {}),
      });
      printJson({ status: 'ok', session });
      return;
    }

    case 'clear-failure': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts clear-failure <runtime_session_id>');
      }

      const session = sessionRepository.clearFailure({ runtimeSessionId });
      if (session?.worktreePath) {
        clearRuntimeFailureRecord(session.worktreePath);
      }
      printJson({ status: 'ok', session });
      return;
    }

    case 'finish-session': {
      const runtimeSessionId = args[0];
      const finishStatus = args[1] as 'done' | 'cancelled' | undefined;
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts finish-session <runtime_session_id> [done|cancelled]');
      }

      const session = sessionRepository.finish({
        runtimeSessionId,
        ...(finishStatus ? { status: finishStatus } : {}),
      });
      lockRepository.releaseForSession(runtimeSessionId);
      printJson({ status: 'ok', session });
      return;
    }

    case 'resume-session': {
      const runtimeSessionId = args[0];
      if (!runtimeSessionId) {
        throw new Error('Uso: cli.ts resume-session <runtime_session_id>');
      }

      await resumeRuntimeSession(runtimeSessionId);
      printJson({ status: 'ok', runtimeSessionId });
      return;
    }

    case 'enqueue-notification': {
      const rawRuntimeSessionId = args[0];
      const eventType = args[1];
      const payloadJson = args[2];
      const targetChatId = args[3];
      if (!rawRuntimeSessionId || !eventType || !payloadJson) {
        throw new Error(
          'Uso: cli.ts enqueue-notification <runtime_session_id|-> <event_type> <payload_json> [target_chat_id]',
        );
      }

      const payload = JSON.parse(payloadJson) as Record<string, unknown>;
      const notification = enqueueEngineNotification({
        runtimeSessionId: rawRuntimeSessionId === '-' ? null : rawRuntimeSessionId,
        eventType: eventType as Parameters<typeof enqueueEngineNotification>[0]['eventType'],
        payload: payload as never,
        ...(targetChatId ? { targetChatId } : {}),
      });
      printJson({ status: 'ok', notification });
      return;
    }

    case 'deliver-notifications': {
      const limitArg = args[0];
      const limit = limitArg ? Number.parseInt(limitArg, 10) : 20;
      if (Number.isNaN(limit) || limit <= 0) {
        throw new Error('Uso: cli.ts deliver-notifications [limit_positivo]');
      }

      const dispatcher = new EngineNotificationDispatcher();
      const result = await dispatcher.pollOnce(limit);
      printJson({ status: 'ok', ...result });
      return;
    }

    case 'notification-status': {
      const format = args[0] || 'summary';
      const limitArg = args[1];
      const limit = limitArg ? Number.parseInt(limitArg, 10) : 20;
      if (Number.isNaN(limit) || limit <= 0) {
        throw new Error('Uso: cli.ts notification-status [summary|json] [limit_positivo]');
      }

      const repository = getEngineNotificationRepository();
      switch (format) {
        case 'summary':
          printJson(repository.getSummary());
          return;
        case 'json':
          printJson(repository.listRecent(limit));
          return;
        default:
          throw new Error('Uso: cli.ts notification-status [summary|json] [limit_positivo]');
      }
    }

    case 'status': {
      const format = args[0] || 'table';
      const sessions = await getEngineSessionsStatus();

      switch (format) {
        case 'json':
          printJson(sessions);
          return;
        case 'active-count':
          process.stdout.write(`${sessions.filter((session) => session.alive && session.status === 'running').length}\n`);
          return;
        case 'table':
          if (sessions.length === 0) {
            process.stdout.write('  (no active sessions)\n');
            return;
          }
          for (const session of sessions) {
            process.stdout.write(`${formatEngineSessionLine(session)}\n`);
          }
          return;
        default:
          throw new Error(`Formato no soportado: ${format}`);
      }
    }

    default:
      throw new Error(
        [
          'Uso:',
          'cli.ts spawn-session <payload_file>',
          'cli.ts run-loop <runtime_session_id>',
          'cli.ts agent-loop <runtime_session_id>',
          'cli.ts resolve-write-scope <bead_path>',
          'cli.ts preflight-locks <bead_path>',
          'cli.ts acquire-locks <runtime_session_id> <bead_path>',
          'cli.ts release-locks <runtime_session_id>',
          'cli.ts heartbeat-locks <runtime_session_id>',
          'cli.ts create-workspace <runtime_session_id> <base_commit>',
          'cli.ts teardown-workspace <runtime_session_id>',
          'cli.ts reap-stale',
          'cli.ts heartbeat-session <runtime_session_id>',
          'cli.ts record-step <runtime_session_id> [delta]',
          'cli.ts record-failure <runtime_session_id> <kind> <summary> [log_path]',
          'cli.ts clear-failure <runtime_session_id>',
          'cli.ts finish-session <runtime_session_id> [done|cancelled]',
          'cli.ts resume-session <runtime_session_id>',
          'cli.ts enqueue-notification <runtime_session_id|-> <event_type> <payload_json> [target_chat_id]',
          'cli.ts deliver-notifications [limit_positivo]',
          'cli.ts notification-status [summary|json] [limit_positivo]',
          'cli.ts status [table|json|active-count]',
        ].join('\n'),
      );
  }
}

main().catch((error: unknown) => {
  if (error instanceof RuntimeLockConflictError) {
    printJson({
      status: 'error',
      message: formatConflictMessage(error.conflict),
      conflict: serializeConflict(error.conflict),
    });
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  printJson({ status: 'error', message });
  process.exit(1);
});
