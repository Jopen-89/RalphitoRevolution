#!/usr/bin/env node

import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';
import { backupRalphitoDatabase, getOperationalStatus } from '../infrastructure/logging/observabilityService.js';

initializeRalphitoDatabase();

async function main() {
  const [, , command] = process.argv;

  switch (command) {
    case 'backup': {
      const backupPath = await backupRalphitoDatabase();
      console.log(`Backup created at ${backupPath}`);
      return;
    }
    case 'status': {
      const status = await getOperationalStatus();
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    default:
      throw new Error(`Comando no soportado: ${command || '<vacío>'}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
