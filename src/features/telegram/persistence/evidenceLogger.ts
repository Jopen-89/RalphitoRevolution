import { mkdir, appendFile } from 'fs/promises';
import path from 'path';

export interface EvidenceLogEntry {
  chatId: string;
  action: string;
  status: string;
}

const LOGS_DIR = path.join(process.cwd(), 'docs', 'automation', 'logs');

async function ensureLogsDir() {
  await mkdir(LOGS_DIR, { recursive: true });
}

async function getLogFilePath(): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `evidence-${date}.jsonl`);
}

export async function logEvidence(entry: EvidenceLogEntry): Promise<void> {
  await ensureLogsDir();

  const logEntry = {
    chatId: entry.chatId,
    timestamp: new Date().toISOString(),
    action: entry.action,
    status: entry.status,
  };

  const line = JSON.stringify(logEntry) + '\n';
  const filePath = await getLogFilePath();
  await appendFile(filePath, line, 'utf8');
}
