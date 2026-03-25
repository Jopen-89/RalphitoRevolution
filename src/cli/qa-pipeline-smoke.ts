#!/usr/bin/env node
// @ts-nocheck

import { execFile } from 'child_process';
import { copyFile, readFile, rm, writeFile } from 'fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as util from 'util';
import type { QAConfig } from '../core/engine/qaConfig.js';
import { startDevServer, stopDevServer, waitForReady, type DevServerHandle } from './dev-server.js';

const execFileAsync = util.promisify(execFile);
const repoRoot = process.cwd();
const sessionPath = path.join(repoRoot, '.ralphito-session.json');
const backupPath = path.join(repoRoot, '.ralphito-session.json.qa-smoke-backup');

const qaConfig: QAConfig = {
  enableVisualQa: true,
  shadowMode: true,
  enableE2eQa: true,
  e2eShadowMode: true,
  devServerCommand: '',
  baseUrl: 'http://127.0.0.1:4173',
  healthcheckUrl: 'http://127.0.0.1:4173/health',
  visualRoutes: ['/', '/settings'],
  e2eRoutes: ['/', '/login', '/settings'],
  designRuleset: 'docs/specs/projects/qa-pipeline-smoke/design-rubric.md',
  e2eProfile: 'qa-pipeline-smoke',
  evidencePath: '~/.ralphito/qa/smoke',
  waitForSelector: '[data-ready="true"]',
  requiredSelectors: ['main', 'nav', 'form'],
  loginRoute: '/login',
  loginSelectors: {
    user: 'input[name="email"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"]',
  },
  visualProvider: {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
  },
  visualProviderFallbacks: [
    { provider: 'opencode', model: 'minimax-m2.7' },
  ],
};

async function backupExistingSession() {
  if (fs.existsSync(sessionPath)) {
    await copyFile(sessionPath, backupPath);
  }
}

async function restoreExistingSession() {
  try {
    if (fs.existsSync(backupPath)) {
      await copyFile(backupPath, sessionPath);
      await rm(backupPath, { force: true });
      return;
    }

    await rm(sessionPath, { force: true });
  } catch (error) {
    console.warn(`[qa-pipeline-smoke] Restauracion de sesion incompleta: ${error instanceof Error ? error.message : String(error)}`);
    try { await rm(backupPath, { force: true }); } catch { /* ignore */ }
    try { await rm(sessionPath, { force: true }); } catch { /* ignore */ }
  }
}

async function writeFixtureSession() {
  const payload = {
    runtimeSessionId: 'qa-smoke-session',
    projectId: 'frontend-team',
    model: 'gpt-5.4',
    prompt: 'Smoke test fixture for Miron and Ricky',
    beadPath: 'docs/specs/projects/qa-pipeline-smoke/bead-1-smoke-fixture.md',
    workItemKey: 'qa-smoke-fixture',
    beadSpecHash: 'qa-smoke-fixture',
    beadSpecVersion: 'qa-smoke-fix',
    qaConfig,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(sessionPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function runQa(commandArgs: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync('npx', commandArgs, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });

    const raw = `${stdout}${stderr}`.trim();
    const lines = raw.split('\n').filter(Boolean);
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : '{}';
    try {
      return JSON.parse(lastLine) as Record<string, unknown>;
    } catch {
      return { status: 'warn', reason: `JSON no parseable del subproceso`, raw: lastLine.slice(0, 200) };
    }
  } catch (error) {
    const exitCode = (error as NodeJS.ErrnoException & { exitCode?: number }).exitCode;
    return {
      status: 'warn',
      reason: `Subproceso QA crasheo con exitCode=${exitCode ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function readFinalSession() {
  return JSON.parse(await readFile(sessionPath, 'utf8')) as Record<string, unknown>;
}

async function main() {
  await backupExistingSession();

  let server: DevServerHandle | null = null;

  try {
    server = await startDevServer({
      command: 'npx tsx scripts/qa-fixture-server.ts',
      cwd: repoRoot,
      mirrorOutput: true,
    });

    await waitForReady({
      url: qaConfig.healthcheckUrl!,
      server,
      timeoutMs: 30_000,
    });

    await writeFixtureSession();

    const visual = await runQa(['tsx', 'scripts/visual-qa.ts', '--repo-root', repoRoot, '--shadow', '--no-server']);
    const e2e = await runQa(['tsx', 'scripts/e2e-qa.ts', '--repo-root', repoRoot, '--shadow', '--no-server']);
    const finalSession = await readFinalSession();

    console.log(JSON.stringify({
      status: 'ok',
      visual,
      e2e,
      visualQa: finalSession['visualQa'] || null,
      e2eQa: finalSession['e2eQa'] || null,
    }, null, 2));
  } finally {
    await stopDevServer(server);
    await restoreExistingSession();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
