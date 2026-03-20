import { mkdir, stat, writeFile } from 'fs/promises';
import path from 'path';

const LOG_DIR = 'docs/automation/logs';

export interface EvidenceLogEntry {
  action: string;
  artifactPath?: string;
  chatId: string;
  errorMessage?: string;
  intent: string;
  status: 'failure' | 'success';
  timestamp: string;
}

export interface EvidenceLogRecord extends EvidenceLogEntry {
  filePath: string;
}

export interface EvidenceLogger {
  log(entry: EvidenceLogEntry): Promise<EvidenceLogRecord>;
}

export class FileEvidenceLogger implements EvidenceLogger {
  async log(entry: EvidenceLogEntry): Promise<EvidenceLogRecord> {
    await mkdir(LOG_DIR, { recursive: true });

    const filename = this.buildFileName(entry);
    const filePath = path.join(LOG_DIR, filename);
    const record = {
      ...entry,
      filePath,
    } satisfies EvidenceLogRecord;

    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

    const fileStats = await stat(filePath);

    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`No se pudo validar el log de evidencia en ${filePath}.`);
    }

    return record;
  }

  private buildFileName(entry: EvidenceLogEntry) {
    const safeChatId = entry.chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeTimestamp = entry.timestamp.replace(/[:.]/g, '-');

    return `${safeChatId}_${entry.action}_${entry.status}_${safeTimestamp}.json`;
  }
}
