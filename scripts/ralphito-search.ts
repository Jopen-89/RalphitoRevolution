#!/usr/bin/env node

import { initializeRalphitoDatabase } from '../src/features/persistence/db/index.js';
import { indexWorkspaceDocuments, searchIndexedDocuments } from '../src/features/search/codeIndexService.js';

initializeRalphitoDatabase();

async function main() {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case 'index': {
      const result = await indexWorkspaceDocuments();
      console.log(`Indexed ${result.indexedCount} files. Removed ${result.staleRemoved} stale documents.`);
      return;
    }
    case 'search': {
      const query = args.join(' ').trim();
      if (!query) {
        throw new Error('Uso: ralphito-search.ts search <consulta>');
      }
      const results = searchIndexedDocuments(query);
      console.log(JSON.stringify(results, null, 2));
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
