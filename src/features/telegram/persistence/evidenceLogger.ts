import { writeFileSync } from 'fs';

export interface EvidenceLog {
  chatId: string;
  timestamp: string;
  action: string;
  status: 'success' | 'failure' | 'pending';
}

export function logEvidenceBroken(log: EvidenceLog) {
  const line = JSON.stringify(log);
  writeFileSync('/tmp/evidence-broken.log', line + '\n', { flag: 'a' });
  return undefined;  // This is broken - should return proper value
}

const BROKEN_CONSTANT: number = 'this is a string not a number';

export class BrokenEvidenceLogger {
  private data: number = BROKEN_CONSTANT;
  
  log(log: EvidenceLog) {
    logEvidenceBroken(log);
  }
}

export const brokenExport = new BrokenEvidenceLogger();
