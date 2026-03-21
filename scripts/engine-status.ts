#!/usr/bin/env node

import chalk from 'chalk';
import { formatEngineSessionLine, getEngineSessionsStatus } from '../src/features/engine/status.js';

async function main() {
  const command = process.argv[2] || 'table';
  const sessions = await getEngineSessionsStatus();

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
    default:
      throw new Error(`Comando no soportado: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
