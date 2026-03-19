import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import * as util from 'util';

const execFileAsync = util.promisify(execFile);

export type VisualProviderType = 'gemini' | 'openai' | 'opencode' | 'codex';

export interface SpawnExecutorPayload {
  project: string;
  prompt: string;
  beadPath?: string;
  workItemKey?: string;
  model?: string;
  qaConfig?: QAConfig;
}

export interface QAViewportConfig {
  width: number;
  height: number;
}

export interface QASelectorSet {
  user?: string;
  password?: string;
  submit?: string;
}

export interface QAConfig {
  enableVisualQa?: boolean;
  shadowMode?: boolean;
  enableE2eQa?: boolean;
  e2eShadowMode?: boolean;
  devServerCommand?: string;
  baseUrl?: string;
  healthcheckUrl?: string;
  visualRoutes?: string[];
  e2eRoutes?: string[];
  formRoutes?: string[];
  e2eProfile?: string;
  designRuleset?: string;
  evidencePath?: string;
  waitForSelector?: string;
  waitForMs?: number;
  viewport?: QAViewportConfig;
  requiredSelectors?: string[];
  loginRoute?: string;
  loginSelectors?: QASelectorSet;
  visualProvider?: {
    provider: VisualProviderType;
    model: string;
  };
  visualProviderFallbacks?: {
    provider: VisualProviderType;
    model: string;
  }[];
}

export interface SpawnExecutorResult {
  status?: string;
  message?: string;
  session_id?: string;
  details?: string;
  model?: string;
  bead_spec_hash?: string;
  bead_spec_version?: string;
}

export function extractBeadPathFromText(text: string) {
  const match = text.match(/docs\/specs\/[^\s]*bead[^\s]*\.md/);
  return match?.[0] || undefined;
}

export async function runSpawnExecutor(payload: SpawnExecutorPayload) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ralphito-spawn-'));
  const payloadPath = path.join(tmpDir, 'payload.json');

  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}
`, 'utf8');

  try {
    const { stdout, stderr } = await execFileAsync('./scripts/tools/tool_spawn_executor.sh', ['--payload-file', payloadPath], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    try {
      return JSON.parse(stdout.trim()) as SpawnExecutorResult;
    } catch {
      const diagnosticOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      throw new Error(diagnosticOutput || 'No pude interpretar la respuesta del orquestador.');
    }
  } finally {
    await rm(tmpDir, { force: true, recursive: true });
  }
}
