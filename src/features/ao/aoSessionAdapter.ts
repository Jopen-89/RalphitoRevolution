import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import * as yaml from 'yaml';

const execFileAsync = promisify(execFile);
const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 15_000;
const TERMINAL_STATUSES = new Set(['killed', 'done', 'terminated', 'merged', 'cleanup']);
const TERMINAL_ACTIVITIES = new Set(['exited']);
const WORKTREE_ROOT = path.join(process.env.HOME || '', '.worktrees');

interface DashboardApiSession {
  id: string;
  projectId: string;
  status: string;
  activity: string | null;
  branch: string | null;
  issueTitle: string | null;
  issueLabel: string | null;
  summary: string | null;
  createdAt: string;
  lastActivityAt: string;
  pr: {
    url: string;
  } | null;
}

interface DashboardApiResponse {
  sessions: DashboardApiSession[];
}

interface AoCliStatusSession {
  name: string;
  role: 'worker' | 'orchestrator';
  branch: string | null;
  status: string | null;
  summary: string | null;
  claudeSummary: string | null;
  pr: string | null;
  issue: string | null;
  lastActivity: string;
  project: string | null;
  activity: string | null;
}

export interface AoStructuredSession {
  id: string;
  projectId: string | null;
  role: 'worker' | 'orchestrator';
  status: string | null;
  activity: string | null;
  branch: string | null;
  summary: string | null;
  issue: string | null;
  prUrl: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  lastActivityLabel: string | null;
  source: 'dashboard_api' | 'ao_status_json' | 'tmux_fallback';
}

function getDashboardBaseUrl() {
  if (process.env.AO_DASHBOARD_URL) return process.env.AO_DASHBOARD_URL;

  const configPath = path.join(process.cwd(), 'ops', 'agent-orchestrator.yaml');
  try {
    const config = yaml.parse(fs.readFileSync(configPath, 'utf8')) as { port?: number };
    const port = config.port || 3000;
    return `http://127.0.0.1:${port}`;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchDashboardSessions(projectId?: string): Promise<AoStructuredSession[] | null> {
  const baseUrl = getDashboardBaseUrl();
  const url = new URL('/api/sessions', baseUrl);
  if (projectId) {
    url.searchParams.set('project', projectId);
  }

  try {
    const response = await fetchWithTimeout(url.toString(), DEFAULT_TIMEOUT_MS);
    if (!response.ok) return null;

    const body = (await response.json()) as DashboardApiResponse;

    return body.sessions.map((session) => ({
      id: session.id,
      projectId: session.projectId,
      role: 'worker',
      status: session.status,
      activity: session.activity,
      branch: session.branch,
      summary: session.summary,
      issue: session.issueLabel || session.issueTitle,
      prUrl: session.pr?.url || null,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      lastActivityLabel: session.lastActivityAt,
      source: 'dashboard_api',
    }));
  } catch {
    return null;
  }
}

function extractJsonArray(stdout: string) {
  const firstBracketLine = stdout
    .split('\n')
    .findIndex((line) => {
      const trimmed = line.trim();
      return trimmed === '[' || trimmed.startsWith('[{');
    });

  if (firstBracketLine === -1) {
    throw new Error('AO no devolvio JSON estructurado');
  }

  return stdout.split('\n').slice(firstBracketLine).join('\n');
}

async function fetchAoStatusSessions(projectId?: string): Promise<AoStructuredSession[]> {
  const args = ['status', '--json'];
  if (projectId) {
    args.push('--project', projectId);
  }

  const { stdout } = await execFileAsync('ao', args, { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(extractJsonArray(stdout)) as AoCliStatusSession[];

  return parsed.map((session) => ({
    id: session.name,
    projectId: session.project,
    role: session.role,
    status: session.status,
    activity: session.activity,
    branch: session.branch,
    summary: session.claudeSummary || session.summary,
    issue: session.issue,
    prUrl: session.pr,
    createdAt: null,
    lastActivityAt: null,
    lastActivityLabel: session.lastActivity,
    source: 'ao_status_json',
  }));
}

function readProjectFromWorktree(sessionId: string) {
  if (!WORKTREE_ROOT || !fs.existsSync(WORKTREE_ROOT)) return null;

  try {
    for (const projectId of fs.readdirSync(WORKTREE_ROOT)) {
      const candidate = path.join(WORKTREE_ROOT, projectId, sessionId);
      if (fs.existsSync(candidate)) return projectId;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchTmuxFallbackSessions(projectId?: string): Promise<AoStructuredSession[]> {
  const format = ['#{session_name}', '#{session_created}', '#{session_activity}', '#{session_attached}'].join('\t');
  const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', format], {
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sessionName, createdAt, lastActivityAt, attached] = line.split('\t') as [string, string, string, string];
      const inferredProjectId = readProjectFromWorktree(sessionName) || null;

      return {
        id: sessionName,
        projectId: inferredProjectId,
        role: 'worker' as const,
        status: attached === '1' ? 'running' : 'idle',
        activity: 'tmux',
        branch: inferredProjectId ? `session/${sessionName}` : null,
        summary: 'Fallback desde tmux; revisar dashboard/AO si falta metadata.',
        issue: null,
        prUrl: null,
        createdAt: createdAt ? new Date(Number(createdAt) * 1000).toISOString() : null,
        lastActivityAt: lastActivityAt ? new Date(Number(lastActivityAt) * 1000).toISOString() : null,
        lastActivityLabel: 'tmux fallback',
        source: 'tmux_fallback' as const,
      } satisfies AoStructuredSession;
    })
    .filter((session) => !projectId || session.projectId === projectId);
}

export async function getAoStructuredSessions(projectId?: string) {
  const dashboardSessions = await fetchDashboardSessions(projectId);
  if (dashboardSessions) return dashboardSessions;

  try {
    return await fetchAoStatusSessions(projectId);
  } catch {
    try {
      return await fetchTmuxFallbackSessions(projectId);
    } catch {
      return [];
    }
  }
}

export function isActiveAoSession(session: AoStructuredSession) {
  if (!session.status) return true;
  if (TERMINAL_STATUSES.has(session.status)) return false;
  if (session.activity && TERMINAL_ACTIVITIES.has(session.activity)) return false;
  return true;
}
