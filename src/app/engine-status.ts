#!/usr/bin/env node
// @ts-nocheck

import chalk from 'chalk';
import {
  formatEngineSessionLine,
  getEngineNotificationRepository,
  getEngineSessionsStatus,
} from '../core/engine/index.js';

function formatNotificationLine(notification: ReturnType<typeof getEngineNotificationRepository>['listRecent'][number]) {
  const chat = notification.targetChatId || '-';
  const sessionId = notification.runtimeSessionId || '-';
  const errorSuffix = notification.errorMessage ? ` error=${notification.errorMessage}` : '';
  return `  ${notification.createdAt}  [${notification.status}]  ${notification.eventType}  session=${sessionId}  chat=${chat}  attempts=${notification.attemptCount}${errorSuffix}`;
}

async function main() {
  const command = process.argv[2] || 'table';
  const sessions = await getEngineSessionsStatus();
  const notificationRepository = getEngineNotificationRepository();

  switch (command) {
    case 'json': {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    case 'active-count': {
      console.log(String(sessions.filter((session) => session.alive && session.status === 'running').length));
      return;
    }
    case 'table': {
      if (sessions.length === 0) {
        console.log(chalk.dim('  (no recent sessions)'));
        return;
      }

      for (const session of sessions) {
        console.log(formatEngineSessionLine(session));
      }
      return;
    }
    case 'notifications': {
      const notifications = notificationRepository.listRecent(20);
      if (notifications.length === 0) {
        console.log(chalk.dim('  (no notifications)'));
        return;
      }

      for (const notification of notifications) {
        console.log(formatNotificationLine(notification));
      }
      return;
    }
    case 'notifications-json': {
      console.log(JSON.stringify(notificationRepository.listRecent(20), null, 2));
      return;
    }
    case 'notification-summary': {
      console.log(JSON.stringify(notificationRepository.getSummary(), null, 2));
      return;
    }
    default:
      throw new Error(`Comando no soportado: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
