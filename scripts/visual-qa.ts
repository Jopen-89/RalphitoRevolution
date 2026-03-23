#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import type { QAConfig } from '../src/features/engine/qaConfig.js';
import { ProviderFactory } from '../src/features/llm-gateway/providers/provider.factory.js';
import { startDevServer, stopDevServer, waitForReady, type DevServerHandle } from './lib/dev-server.js';

interface SessionState {
  runtimeSessionId: string;
  projectId: string;
  model?: string;
  prompt?: string;
  beadPath?: string | null;
  workItemKey?: string;
  beadSpecHash?: string | null;
  beadSpecVersion?: string | null;
  qaConfig?: QAConfig | null;
  visualQa?: {
    status: VisualQAReport['status'];
    shadowMode: boolean;
    reason?: string;
    evidenceDir?: string;
    reportPath?: string;
    generatedAt: string;
    routeCount: number;
  } | null;
  updatedAt?: string;
}

interface RouteEvidence {
  route: string;
  url: string;
  screenshotPath: string;
  verdict: 'pass' | 'fail' | 'warn' | 'skipped';
  summary: string;
  issues: string[];
  rawModelOutput?: string;
}

type VisualVerdict = RouteEvidence['verdict'];

interface VisualQAReport {
  sessionId: string;
  project: string;
  shadowMode: boolean;
  status: 'passed' | 'failed' | 'warn' | 'skipped';
  reason?: string;
  evidenceDir?: string;
  startedServer: boolean;
  routes: RouteEvidence[];
  generatedAt: string;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 1100 };
const DEFAULT_TIMEOUT_MS = 60_000;

function parseArgs() {
  const args = process.argv.slice(2);
  let repoRoot = process.cwd();
  let shadow = false;
  let noServer = false;

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--repo-root' && args[i + 1]) {
      repoRoot = path.resolve(args[i + 1]);
      i += 1;
      continue;
    }
    if (value === '--shadow') {
      shadow = true;
    }
    if (value === '--no-server') {
      noServer = true;
    }
  }

  return { repoRoot, shadow, noServer };
}

function expandHomeDir(inputPath: string) {
  if (!inputPath.startsWith('~/')) return inputPath;
  return path.join(os.homedir(), inputPath.slice(2));
}

async function loadSessionState(repoRoot: string): Promise<SessionState | null> {
  const sessionPath = path.join(repoRoot, '.ralphito-session.json');
  if (!fs.existsSync(sessionPath)) return null;

  const raw = await readFile(sessionPath, 'utf8');
  return JSON.parse(raw) as SessionState;
}

async function updateSessionVisualQa(repoRoot: string, visualQa: NonNullable<SessionState['visualQa']>) {
  const sessionPath = path.join(repoRoot, '.ralphito-session.json');
  if (!fs.existsSync(sessionPath)) return;

  const raw = await readFile(sessionPath, 'utf8');
  const session = JSON.parse(raw) as SessionState;
  session.visualQa = visualQa;
  session.updatedAt = new Date().toISOString();
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

function shouldRunVisualQa(session: SessionState) {
  const qaConfig = session.qaConfig;
  if (qaConfig?.enableVisualQa) return true;
  return session.projectId === 'frontend-team';
}

function buildEvidenceDir(session: SessionState, qaConfig: QAConfig | null | undefined) {
  const root = expandHomeDir(qaConfig?.evidencePath || '~/.ralphito/qa/visual');
  const sessionId = session.runtimeSessionId || 'unknown-session';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(root, sessionId, timestamp);
}

function normalizeRoute(route: string) {
  if (!route) return '/';
  return route.startsWith('/') ? route : `/${route}`;
}

async function loadRubric(designRuleset: string | undefined, repoRoot: string) {
  if (!designRuleset) return 'No se proporciono rubrica visual explicita.';
  const rulesetPath = path.resolve(repoRoot, designRuleset);
  if (fs.existsSync(rulesetPath)) {
    return await readFile(rulesetPath, 'utf8');
  }
  return 'No se proporciono rubrica visual explicita.';
}

interface VisionChainEntry {
  provider: string;
  model: string;
}

async function evaluateScreenshotWithVision(input: {
  screenshotPath: string;
  route: string;
  designRuleset?: string;
  repoRoot: string;
  baseUrl: string;
  qaConfig: QAConfig;
}) {
  const { screenshotPath, route, designRuleset, repoRoot, baseUrl, qaConfig } = input;

  const rubricText = await loadRubric(designRuleset, repoRoot);
  const imageBase64 = (await readFile(screenshotPath)).toString('base64');

  const primary: VisionChainEntry | undefined = qaConfig.visualProvider;
  const fallbacks: VisionChainEntry[] = qaConfig.visualProviderFallbacks ?? [];

  const chain: VisionChainEntry[] = primary
    ? [primary, ...fallbacks]
    : fallbacks.length > 0
      ? fallbacks
      : [{ provider: 'gemini', model: 'gemini-2.0-flash' }];

  const auth = {
    openAiKey: process.env.OPENAI_API_KEY,
    minimaxKey: process.env.MINIMAX_API_KEY,
  };

  let lastError = '';

  for (const entry of chain) {
    const vp = await ProviderFactory.createVisionProvider(
      entry.provider as 'gemini' | 'openai' | 'opencode' | 'codex',
      entry.model,
      auth,
    );

    if (!vp) {
      lastError = `${entry.provider} no disponible (falta credentials o no soportado)`;
      continue;
    }

    try {
      const result = await vp.evaluateVisual(imageBase64, route, rubricText);

      if (result.status === 'pass' || result.status === 'fail' || result.status === 'warn') {
        return {
          verdict: result.status,
          summary: result.summary,
          issues: result.issues,
          rawModelOutput: result.rawModelOutput,
          providerUsed: vp.name,
          modelUsed: vp.model,
        };
      }
    } catch (err) {
      lastError = `${vp.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    verdict: 'skipped' as const,
    summary: `Ningun provider visual disponible. Ultimo error: ${lastError}`,
    issues: [lastError],
  };
}

async function captureRouteEvidence(input: {
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  route: string;
  baseUrl: string;
  qaConfig: QAConfig;
  evidenceDir: string;
  repoRoot: string;
}) {
  const { browser, route, baseUrl, qaConfig, evidenceDir, repoRoot } = input;
  const url = new URL(normalizeRoute(route), baseUrl).toString();
  const page = await browser.newPage({ viewport: qaConfig.viewport || DEFAULT_VIEWPORT });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });

    if (qaConfig.waitForSelector) {
      await page.waitForSelector(qaConfig.waitForSelector, { timeout: 10_000 });
    }

    if (qaConfig.waitForMs && qaConfig.waitForMs > 0) {
      await page.waitForTimeout(qaConfig.waitForMs);
    } else {
      await page.waitForTimeout(1200);
    }

    const fileSafeRoute = normalizeRoute(route).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';
    const screenshotPath = path.join(evidenceDir, `${fileSafeRoute}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const vision = await evaluateScreenshotWithVision({
      screenshotPath,
      route,
      designRuleset: qaConfig.designRuleset,
      repoRoot,
      baseUrl,
      qaConfig,
    });

    return {
      route,
      url,
      screenshotPath,
      verdict: vision.verdict as VisualVerdict,
      summary: vision.summary,
      issues: vision.issues,
      ...(vision.rawModelOutput ? { rawModelOutput: vision.rawModelOutput } : {}),
    } satisfies RouteEvidence;
  } finally {
    await page.close();
  }
}

function summarizeStatus(routes: RouteEvidence[]) {
  if (routes.length === 0) return 'skipped' as const;
  if (routes.some((entry) => entry.verdict === 'fail')) return 'failed' as const;
  if (routes.some((entry) => entry.verdict === 'warn')) return 'warn' as const;
  if (routes.every((entry) => entry.verdict === 'skipped')) return 'skipped' as const;
  return 'passed' as const;
}

async function writeReport(report: VisualQAReport, evidenceDir?: string) {
  if (!evidenceDir) return;
  const reportPath = path.join(evidenceDir, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const { repoRoot, shadow, noServer } = parseArgs();
  const session = await loadSessionState(repoRoot);

  if (!session) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing_session_state' }));
    return;
  }

  if (!shouldRunVisualQa(session)) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'not_frontend_session', sessionId: session.runtimeSessionId }));
    return;
  }

  const qaConfig = session.qaConfig || {};
  const effectiveShadowMode = shadow || qaConfig.shadowMode === true;

  if (!qaConfig.baseUrl || !Array.isArray(qaConfig.visualRoutes) || qaConfig.visualRoutes.length === 0) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: 'missing_qa_metadata',
      sessionId: session.runtimeSessionId,
      details: 'Faltan qaConfig.baseUrl o qaConfig.visualRoutes.',
    }));
    return;
  }

  const evidenceDir = buildEvidenceDir(session, qaConfig);
  await mkdir(evidenceDir, { recursive: true });

  let server: DevServerHandle | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let startedServer = false;
  let exitCode = 0;

  try {
    if (qaConfig.devServerCommand && !noServer) {
      server = await startDevServer({
        command: qaConfig.devServerCommand,
        cwd: repoRoot,
        logPath: path.join(evidenceDir, 'server.log'),
      });
      startedServer = true;
    }

    await waitForReady({
      url: qaConfig.healthcheckUrl || qaConfig.baseUrl,
      server,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    browser = await chromium.launch({ headless: true });

    const routes: RouteEvidence[] = [];
    for (const route of qaConfig.visualRoutes) {
      try {
        routes.push(await captureRouteEvidence({
          browser,
          route,
          baseUrl: qaConfig.baseUrl,
          qaConfig,
          evidenceDir,
          repoRoot,
        }));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const fileSafeRoute = normalizeRoute(route).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';
        const screenshotPath = path.join(evidenceDir, `${fileSafeRoute}.png`);
        const screenshotExists = fs.existsSync(screenshotPath);
        routes.push({
          route,
          url: new URL(normalizeRoute(route), qaConfig.baseUrl).toString(),
          screenshotPath,
          verdict: 'warn' as const,
          summary: `Vision evaluaton failed for this route: ${reason}`,
          issues: [reason],
          ...(screenshotExists ? {} : { screenshotPath: '' }),
        });
      }
    }

    const status = summarizeStatus(routes);
    const report: VisualQAReport = {
      sessionId: session.runtimeSessionId,
      project: session.projectId,
      shadowMode: effectiveShadowMode,
      status,
      evidenceDir,
      startedServer,
      routes,
      generatedAt: new Date().toISOString(),
    };

    await writeReport(report, evidenceDir);
    await updateSessionVisualQa(repoRoot, {
      status: report.status,
      shadowMode: effectiveShadowMode,
      evidenceDir,
      reportPath: path.join(evidenceDir, 'report.json'),
      generatedAt: report.generatedAt,
      routeCount: report.routes.length,
    });
    console.log(JSON.stringify(report));

    if (!effectiveShadowMode && status === 'failed') {
      exitCode = 1;
    }
  } catch (error) {
    const report: VisualQAReport = {
      sessionId: session.runtimeSessionId,
      project: session.projectId,
      shadowMode: effectiveShadowMode,
      status: 'warn',
      reason: error instanceof Error ? error.message : String(error),
      evidenceDir,
      startedServer,
      routes: [],
      generatedAt: new Date().toISOString(),
    };

    await writeReport(report, evidenceDir);
    await updateSessionVisualQa(repoRoot, {
      status: report.status,
      shadowMode: effectiveShadowMode,
      ...(report.reason ? { reason: report.reason } : {}),
      evidenceDir,
      reportPath: path.join(evidenceDir, 'report.json'),
      generatedAt: report.generatedAt,
      routeCount: 0,
    });
    console.log(JSON.stringify(report));

    if (!effectiveShadowMode) {
      exitCode = 1;
    }
  } finally {
    await browser?.close();
    await stopDevServer(server);
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
