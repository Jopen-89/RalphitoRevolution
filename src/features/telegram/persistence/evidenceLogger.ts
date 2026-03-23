import { promises as fs } from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'docs/automation/logs');

interface EvidenceLog {
  chatId: string;
  timestamp: string;
  action: string;
  status: string;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function logEvidence(
  chatId: string,
  action: string,
  status: string
): Promise<void> {
  await ensureDir(LOG_DIR);

  const entry: EvidenceLog = {
    chatId,
    timestamp: new Date().toISOString(),
    action,
    status,
  };

  const line = JSON.stringify(entry) + '\n';
  const filePath = path.join(LOG_DIR, `${chatId}.jsonl`);
  await fs.appendFile(filePath, line, 'utf-8');
}