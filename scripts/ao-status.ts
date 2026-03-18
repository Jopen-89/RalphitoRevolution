#!/usr/bin/env node

import chalk from 'chalk';
import { getAoStructuredSessions, isActiveAoSession } from '../src/features/ao/aoSessionAdapter.js';

function formatSessionLine(session: Awaited<ReturnType<typeof getAoStructuredSessions>>[number]) {
  const status = session.status || 'unknown';
  const branch = session.branch || '-';
  const summary = session.summary || session.issue || '-';
  const activity = session.lastActivityLabel || session.lastActivityAt || '-';

  return `  ${session.id}  (${activity})  ${branch}  [${status}]  ${summary}`;
}

async function main() {
  const command = process.argv[2] || 'table';
  const sessions = await getAoStructuredSessions();

  switch (command) {
    case 'json': {
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    case 'active-count': {
      console.log(String(sessions.filter(isActiveAoSession).length));
      return;
    }
    case 'table': {
      if (sessions.length === 0) {
        console.log(chalk.dim('  (no active sessions)'));
        return;
      }

      for (const session of sessions) {
        console.log(formatSessionLine(session));
      }
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
