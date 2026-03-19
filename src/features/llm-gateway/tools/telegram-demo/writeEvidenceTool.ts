import fs from 'fs';
import path from 'path';

export interface WriteEvidenceResult {
  filePath: string;
  bytesWritten: number;
  success: boolean;
}

const EVIDENCE_DIR = 'docs/automation/evidence/';

export async function writeEvidenceTool(content: string): Promise<WriteEvidenceResult> {
  const timestamp = new Date().toISOString();
  const filename = `evidence_${timestamp.replace(/[:.]/g, '-')}.txt`;
  const filePath = path.join(EVIDENCE_DIR, filename);

  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullContent = `[${timestamp}] ${content}`;
    fs.writeFileSync(filePath, fullContent);
    return {
      filePath,
      bytesWritten: Buffer.byteLength(fullContent),
      success: true,
    };
  } catch (error) {
    return {
      filePath,
      bytesWritten: 0,
      success: false,
    };
  }
}