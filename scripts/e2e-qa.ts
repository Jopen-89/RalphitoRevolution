#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'fs/promises';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import type { QAConfig } from '../src/features/engine/qaConfig.js';
import { startDevServer, stopDevServer, waitForReady, type DevServerHandle } from './lib/dev-server.js';

interface E2EReportRoute {
  route: string;
  url: string;
  status: 'passed' | 'failed' | 'warn';
  checks: string[];
  issues: string[];
}

interface E2EReport {
  sessionId: string;
  project: string;
  shadowMode: boolean;
  status: 'passed' | 'failed' | 'warn' | 'skipped';
  profile: string;
  reason?: string;
  evidenceDir?: string;
  reportPath?: string;
  startedServer: boolean;
  routes: E2EReportRoute[];
  generatedAt: string;
}

interface SessionState {
  runtimeSessionId: string;
  projectId: string;
  qaConfig?: QAConfig | null;
  e2eQa?: {
    status: E2EReport['status'];
    shadowMode: boolean;
    profile: string;
    reason?: string;
    evidenceDir?: string;
    reportPath?: string;
    generatedAt: string;
    routeCount: number;
  } | null;
  updatedAt?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_VIEWPORT = { width: 1440, height: 1100 };

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
  return JSON.parse(await readFile(sessionPath, 'utf8')) as SessionState;
}

async function updateSessionE2E(repoRoot: string, e2eQa: NonNullable<SessionState['e2eQa']>) {
  const sessionPath = path.join(repoRoot, '.ralphito-session.json');
  if (!fs.existsSync(sessionPath)) return;
  const session = JSON.parse(await readFile(sessionPath, 'utf8')) as SessionState;
  session.e2eQa = e2eQa;
  session.updatedAt = new Date().toISOString();
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

function shouldRunE2E(session: SessionState) {
  if (session.qaConfig?.enableE2eQa) return true;
  return session.projectId === 'qa-team';
}

function buildEvidenceDir(session: SessionState, qaConfig: QAConfig | null | undefined) {
  const root = expandHomeDir(qaConfig?.evidencePath || '~/.ralphito/qa/e2e');
  return path.join(root, session.runtimeSessionId || 'unknown-session', new Date().toISOString().replace(/[:.]/g, '-'));
}

function normalizeRoute(route: string) {
  if (!route) return '/';
  return route.startsWith('/') ? route : `/${route}`;
}

async function maybeRunLogin(page: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>, baseUrl: string, qaConfig: QAConfig, routeChecks: string[], routeIssues: string[]) {
  if (!qaConfig.loginRoute || !qaConfig.loginSelectors?.submit) return;

  const loginUrl = new URL(normalizeRoute(qaConfig.loginRoute), baseUrl).toString();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
  if (qaConfig.loginSelectors.user) {
    await page.locator(qaConfig.loginSelectors.user).fill(process.env.RICKY_TEST_USER || 'qa@example.com');
  }
  if (qaConfig.loginSelectors.password) {
    await page.locator(qaConfig.loginSelectors.password).fill(process.env.RICKY_TEST_PASSWORD || 'invalid-password');
  }
  await page.locator(qaConfig.loginSelectors.submit).click();
  await page.waitForTimeout(1200);
  routeChecks.push('Intento de login ejecutado');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (!bodyText || bodyText.length < 3) {
    routeIssues.push('El login no devolvio contenido interpretable tras el submit.');
  }
}

async function inspectRoute(input: {
  browser: Awaited<ReturnType<typeof chromium.launch>>;
  route: string;
  baseUrl: string;
  qaConfig: QAConfig;
}) {
  const { browser, route, baseUrl, qaConfig } = input;
  const url = new URL(normalizeRoute(route), baseUrl).toString();
  const page = await browser.newPage({ viewport: qaConfig.viewport || DEFAULT_VIEWPORT });
  const checks: string[] = [];
  const issues: string[] = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });

    if (qaConfig.waitForSelector) {
      await page.waitForSelector(qaConfig.waitForSelector, { timeout: 10_000 });
      checks.push(`Selector listo: ${qaConfig.waitForSelector}`);
    }

    if (qaConfig.waitForMs && qaConfig.waitForMs > 0) {
      await page.waitForTimeout(qaConfig.waitForMs);
    } else {
      await page.waitForTimeout(1200);
    }

    if (qaConfig.requiredSelectors?.length) {
      for (const selector of qaConfig.requiredSelectors) {
        const count = await page.locator(selector).count();
        if (count > 0) {
          checks.push(`Selector encontrado: ${selector}`);
        } else {
          issues.push(`Selector requerido no encontrado: ${selector}`);
        }
      }
    }

    const forms = await page.locator('form').count();
    if (forms > 0) {
      checks.push(`Formularios detectados: ${forms}`);
      const submitButton = page.locator('form button[type="submit"]').first();
      if (await submitButton.count()) {
        await submitButton.click().catch(() => undefined);
        await page.waitForTimeout(800);
        checks.push('Submit basico de formulario ejecutado');
      }
    }

    if (qaConfig.loginRoute && normalizeRoute(route) === normalizeRoute(qaConfig.loginRoute)) {
      await maybeRunLogin(page, baseUrl, qaConfig, checks, issues);
    }

    const status = issues.length > 0 ? 'failed' : checks.length > 0 ? 'passed' : 'warn';
    if (status === 'warn') {
      issues.push('No se ejecutaron checks suficientes para declarar una pasada fuerte.');
    }

    return { route, url, status, checks, issues } satisfies E2EReportRoute;
  } finally {
    await page.close();
  }
}

function summarizeStatus(routes: E2EReportRoute[]) {
  if (routes.length === 0) return 'skipped' as const;
  if (routes.some((route) => route.status === 'failed')) return 'failed' as const;
  if (routes.some((route) => route.status === 'warn')) return 'warn' as const;
  return 'passed' as const;
}

async function writeReport(report: E2EReport, evidenceDir?: string) {
  if (!evidenceDir) return;
  await writeFile(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const { repoRoot, shadow, noServer } = parseArgs();
  const session = await loadSessionState(repoRoot);
  if (!session) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'missing_session_state' }));
    return;
  }

  if (!shouldRunE2E(session)) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'not_e2e_session', sessionId: session.runtimeSessionId }));
    return;
  }

  const qaConfig = session.qaConfig || {};
  const effectiveShadowMode = shadow || qaConfig.e2eShadowMode === true;
  const routes = qaConfig.e2eRoutes && qaConfig.e2eRoutes.length > 0 ? qaConfig.e2eRoutes : qaConfig.visualRoutes || [];

  if (!qaConfig.baseUrl || routes.length === 0) {
    console.log(JSON.stringify({
      status: 'skipped',
      reason: 'missing_e2e_metadata',
      sessionId: session.runtimeSessionId,
      details: 'Faltan qaConfig.baseUrl o qaConfig.e2eRoutes.',
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
    const routeReports: E2EReportRoute[] = [];
    for (const route of routes) {
      routeReports.push(await inspectRoute({ browser, route, baseUrl: qaConfig.baseUrl, qaConfig }));
    }

    const status = summarizeStatus(routeReports);
    const generatedAt = new Date().toISOString();
    const report: E2EReport = {
      sessionId: session.runtimeSessionId,
      project: session.projectId,
      shadowMode: effectiveShadowMode,
      status,
      profile: qaConfig.e2eProfile || 'generic-smoke',
      evidenceDir,
      reportPath: path.join(evidenceDir, 'report.json'),
      startedServer,
      routes: routeReports,
      generatedAt,
    };

    await writeReport(report, evidenceDir);
    await updateSessionE2E(repoRoot, {
      status,
      shadowMode: effectiveShadowMode,
      profile: report.profile,
      evidenceDir,
      reportPath: report.reportPath,
      generatedAt,
      routeCount: routeReports.length,
    });
    console.log(JSON.stringify(report));
    if (!effectiveShadowMode && status === 'failed') exitCode = 1;
  } catch (error) {
    const generatedAt = new Date().toISOString();
    const reason = error instanceof Error ? error.message : String(error);
    const report: E2EReport = {
      sessionId: session.runtimeSessionId,
      project: session.projectId,
      shadowMode: effectiveShadowMode,
      status: 'warn',
      profile: qaConfig.e2eProfile || 'generic-smoke',
      reason,
      evidenceDir,
      reportPath: path.join(evidenceDir, 'report.json'),
      startedServer,
      routes: [],
      generatedAt,
    };

    await writeReport(report, evidenceDir);
    await updateSessionE2E(repoRoot, {
      status: 'warn',
      shadowMode: effectiveShadowMode,
      profile: report.profile,
      reason,
      evidenceDir,
      reportPath: report.reportPath,
      generatedAt,
      routeCount: 0,
    });
    console.log(JSON.stringify(report));
    if (!effectiveShadowMode) exitCode = 1;
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
