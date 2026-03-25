import {
  DEFAULT_ENGINE_NOTIFICATION_MAX_ATTEMPTS,
  DEFAULT_ENGINE_NOTIFICATION_POLL_INTERVAL_MS,
  getEngineNotificationRepository,
  type EngineNotificationSummary,
  type EngineNotificationRecord,
  type SessionGuardrailFailedNotificationPayload,
  type SessionInteractiveBlockedNotificationPayload,
  type SessionReapedNotificationPayload,
  type SessionSpawnFailedNotificationPayload,
  type SessionStartedNotificationPayload,
  type SessionSyncedNotificationPayload,
  type SessionTimeoutNotificationPayload,
} from '../../core/engine/index.js';
import type { SessionSuspendedHumanInputNotificationPayload } from '../../core/engine/engineNotifications.js';
import { sendTelegramMessage, type SendTelegramMessageResult } from './telegramSender.js';

export interface EngineNotificationPollResult {
  scanned: number;
  claimed: number;
  delivered: number;
  failed: number;
  busy: boolean;
  summary: EngineNotificationSummary;
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function compactLine(label: string, value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? `${label}: ${escapeHtml(normalized)}` : null;
}

function truncate(text: string | null | undefined, maxLength = 220) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function formatStarted(
  runtimeSessionId: string | null,
  payload: SessionStartedNotificationPayload,
) {
  return [
    'Autopilot: sesion iniciada',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Proyecto', payload.projectId),
    compactLine('Rama', payload.branchName),
    compactLine('Work item', payload.workItemKey),
    compactLine('Bead', payload.beadPath),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSpawnFailed(
  runtimeSessionId: string | null,
  payload: SessionSpawnFailedNotificationPayload,
) {
  return [
    'Autopilot: spawn fallido',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Proyecto', payload.projectId),
    compactLine('Rama', payload.branchName),
    compactLine('Work item', payload.workItemKey),
    compactLine('Bead', payload.beadPath),
    compactLine('Error', truncate(payload.error)),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatTimeout(
  runtimeSessionId: string | null,
  payload: SessionTimeoutNotificationPayload,
) {
  return [
    'Autopilot: timeout',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Tipo', payload.kind),
    compactLine('Detalle', truncate(payload.summary)),
    compactLine('Hint', truncate(payload.hint)),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatInteractiveBlocked(
  runtimeSessionId: string | null,
  payload: SessionInteractiveBlockedNotificationPayload,
) {
  return [
    'Autopilot: sesion bloqueada',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Tipo', payload.kind),
    compactLine('Detalle', truncate(payload.summary)),
    compactLine('Hint', truncate(payload.hint)),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSuspendedHumanInput(
  runtimeSessionId: string | null,
  payload: SessionSuspendedHumanInputNotificationPayload,
) {
  return [
    'Autopilot: sesion pausada por input humano',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Tipo', payload.kind),
    compactLine('Detalle', truncate(payload.summary)),
    compactLine('Prompt', truncate(payload.prompt, 320)),
    compactLine('Hint', truncate(payload.hint)),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatGuardrailFailed(
  runtimeSessionId: string | null,
  payload: SessionGuardrailFailedNotificationPayload,
) {
  return [
    'Autopilot: guardrail fallo',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Guardrail', payload.guardrail),
    compactLine('Bead', payload.beadId),
    compactLine('Titulo', payload.title),
    compactLine('Resumen', truncate(payload.summary)),
    compactLine('Snippet', truncate(payload.snippet, 320)),
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSynced(
  runtimeSessionId: string | null,
  payload: SessionSyncedNotificationPayload,
) {
  return [
    'Autopilot: aterrizado en rama/PR',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Rama', payload.branchName),
    compactLine('Bead', payload.beadId),
    compactLine('Titulo', payload.title),
    compactLine('PR', payload.prUrl),
    'Estado: listo para revision o bd merge',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatReaped(
  runtimeSessionId: string | null,
  payload: SessionReapedNotificationPayload,
) {
  return [
    'Autopilot: sesion reaped',
    compactLine('Sesion', runtimeSessionId),
    compactLine('Motivo', payload.kind),
    compactLine('Detalle', truncate(payload.reason)),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatEngineNotificationMessage(notification: EngineNotificationRecord) {
  switch (notification.eventType) {
    case 'session.started':
      return formatStarted(notification.runtimeSessionId, notification.payload as SessionStartedNotificationPayload);
    case 'session.spawn_failed':
      return formatSpawnFailed(
        notification.runtimeSessionId,
        notification.payload as SessionSpawnFailedNotificationPayload,
      );
    case 'session.timeout':
      return formatTimeout(notification.runtimeSessionId, notification.payload as SessionTimeoutNotificationPayload);
    case 'session.interactive_blocked':
      return formatInteractiveBlocked(
        notification.runtimeSessionId,
        notification.payload as SessionInteractiveBlockedNotificationPayload,
      );
    case 'session.suspended_human_input':
      return formatSuspendedHumanInput(
        notification.runtimeSessionId,
        notification.payload as SessionSuspendedHumanInputNotificationPayload,
      );
    case 'session.guardrail_failed':
      return formatGuardrailFailed(
        notification.runtimeSessionId,
        notification.payload as SessionGuardrailFailedNotificationPayload,
      );
    case 'session.synced':
      return formatSynced(notification.runtimeSessionId, notification.payload as SessionSyncedNotificationPayload);
    case 'session.reaped':
      return formatReaped(notification.runtimeSessionId, notification.payload as SessionReapedNotificationPayload);
  }

  const unhandledEventType: never = notification.eventType;
  throw new Error(`Engine notification type no soportado: ${unhandledEventType}`);
}

export class EngineNotificationDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository = getEngineNotificationRepository(),
    private readonly send = sendTelegramMessage,
    private readonly pollIntervalMs = DEFAULT_ENGINE_NOTIFICATION_POLL_INTERVAL_MS,
  ) {}

  start() {
    if (this.timer) return;

    console.log(
      `[EngineNotificationDispatcher] started interval_ms=${this.pollIntervalMs}`,
    );
    void this.pollOnce().catch((error: unknown) => {
      console.error(
        '[EngineNotificationDispatcher] initial poll failed:',
        error instanceof Error ? error.message : String(error),
      );
    });
    this.timer = setInterval(() => {
      void this.pollOnce().catch((error: unknown) => {
        console.error(
          '[EngineNotificationDispatcher] interval poll failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
    }, this.pollIntervalMs);

    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    console.log('[EngineNotificationDispatcher] stopped');
  }

  async pollOnce(limit = 20) {
    if (this.running) {
      return {
        scanned: 0,
        claimed: 0,
        delivered: 0,
        failed: 0,
        busy: true,
        summary: this.repository.getSummary(),
      } satisfies EngineNotificationPollResult;
    }
    this.running = true;
    const result = {
      scanned: 0,
      claimed: 0,
      delivered: 0,
      failed: 0,
      busy: false,
      summary: this.repository.getSummary(),
    } satisfies EngineNotificationPollResult;

    try {
      const nowIso = new Date().toISOString();
      const notifications = this.repository.listDeliverable(nowIso, limit);
      result.scanned = notifications.length;

      for (const notification of notifications) {
        const claimed = this.repository.claim(notification.eventId, nowIso);
        if (!claimed) continue;
        result.claimed += 1;
        const outcome = await this.deliver(claimed);
        if (outcome === 'delivered') {
          result.delivered += 1;
        } else {
          result.failed += 1;
        }
      }
      result.summary = this.repository.getSummary();
      if (result.scanned > 0 || result.failed > 0) {
        console.log(
          `[EngineNotificationDispatcher] poll scanned=${result.scanned} claimed=${result.claimed} delivered=${result.delivered} failed=${result.failed} pending=${result.summary.pending} delivering=${result.summary.delivering}`,
        );
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private resolveTargetChatId(notification: EngineNotificationRecord) {
    if (notification.targetChatId) {
      return notification.targetChatId;
    }

    if (notification.runtimeSessionId) {
      return this.repository.resolveTargetChatId(notification.runtimeSessionId);
    }

    return process.env.TELEGRAM_ALLOWED_CHAT_ID?.trim() || null;
  }

  private async deliver(notification: EngineNotificationRecord) {
    const failedAt = new Date().toISOString();
    const targetChatId = this.resolveTargetChatId(notification);

    if (!targetChatId) {
      this.repository.markFailed({
        eventId: notification.eventId,
        attemptCount: notification.attemptCount + 1,
        errorMessage: 'No target chat id for engine notification',
        failedAt,
        terminal: true,
      });
      console.error(
        `[EngineNotificationDispatcher] failed event=${notification.eventId} type=${notification.eventType} reason=no_target_chat_id`,
      );
      return 'failed' as const;
    }

    try {
      const message = formatEngineNotificationMessage(notification);
      await this.send(targetChatId, message);
      this.repository.markDelivered(notification.eventId, new Date().toISOString());
      return 'delivered' as const;
    } catch (error) {
      const attemptCount = notification.attemptCount + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.repository.markFailed({
        eventId: notification.eventId,
        attemptCount,
        errorMessage,
        failedAt,
        terminal: attemptCount >= DEFAULT_ENGINE_NOTIFICATION_MAX_ATTEMPTS,
      });
      console.error(
        `[EngineNotificationDispatcher] failed event=${notification.eventId} type=${notification.eventType} attempt=${attemptCount} error=${errorMessage}`,
      );
      return 'failed' as const;
    }
  }
}

export type EngineNotificationSendFn = (
  chatId: string,
  text: string,
) => Promise<SendTelegramMessageResult>;
