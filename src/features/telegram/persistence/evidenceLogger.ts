import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export interface EvidenceLogEntry {
  chatId: string;
  timestamp: string;
  action: string;
  status: 'success' | 'failure' | 'pending';
}

const LOGS_DIR = path.join(process.cwd(), 'docs', 'automation', 'logs');

export class EvidenceLogger {
  private logsDir: string;

  constructor(logsDir: string = LOGS_DIR) {
    this.logsDir = logsDir;
  }

  private logFilePath(chatId: string): string {
    return path.join(this.logsDir, `evidence-${chatId}.jsonl`);
  }

  async ensureLogsDirectory(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
  }

  async log(entry: EvidenceLogEntry): Promise<void> {
    await this.ensureLogsDirectory();
    const line = JSON.stringify(entry) + '\n';
    await writeFile(this.logFilePath(entry.chatId), line, { flag: 'a' });
  }

  async logAction(chatId: string, action: string, status: EvidenceLogEntry['status']): Promise<void> {
    await this.log({
      chatId,
      timestamp: new Date().toISOString(),
      action,
      status,
    });
  }
}

let evidenceLogger: EvidenceLogger | null = null;

export function getEvidenceLogger(): EvidenceLogger {
  if (evidenceLogger) return evidenceLogger;
  evidenceLogger = new EvidenceLogger();
  return evidenceLogger;
}