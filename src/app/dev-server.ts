// @ts-nocheck
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { once } from 'events';
import * as fs from 'fs';

const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_READY_INTERVAL_MS = 1_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export interface StartDevServerOptions {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  logPath?: string;
  mirrorOutput?: boolean;
}

export interface WaitForReadyOptions {
  url: string;
  server?: DevServerHandle | null;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface StopDevServerOptions {
  graceTimeoutMs?: number;
  forceTimeoutMs?: number;
}

export interface DevServerHandle {
  child: ChildProcessWithoutNullStreams;
  logPath?: string;
  logStream?: fs.WriteStream;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChildClose(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return true;

  try {
    await Promise.race([
      once(child, 'close'),
      delay(timeoutMs).then(() => {
        throw new Error('timeout');
      }),
    ]);
    return true;
  } catch {
    return child.exitCode !== null || child.signalCode !== null;
  }
}

function describeChildExit(child: ChildProcessWithoutNullStreams) {
  return `exitCode=${child.exitCode ?? 'null'} signal=${child.signalCode ?? 'null'}`;
}

function sendSignalToServerTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return;
    child.kill(signal);
  }
}

async function closeLogStream(logStream?: fs.WriteStream) {
  if (!logStream || logStream.closed) return;

  await new Promise<void>((resolve, reject) => {
    logStream.once('error', reject);
    logStream.once('close', () => resolve());
    logStream.end();
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_DESTROYED') {
      throw error;
    }
  });
}

export async function startDevServer(options: StartDevServerOptions): Promise<DevServerHandle> {
  const { command, cwd, env, logPath, mirrorOutput = false } = options;
  const logStream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : undefined;

  const child = spawn(command, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
      CI: env?.CI ?? process.env.CI ?? '1',
    },
  });

  if (logStream) {
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
  }

  if (mirrorOutput) {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  }

  return {
    child,
    ...(logPath ? { logPath } : {}),
    ...(logStream ? { logStream } : {}),
  };
}

export async function waitForReady(options: WaitForReadyOptions) {
  const {
    url,
    server,
    timeoutMs = DEFAULT_READY_TIMEOUT_MS,
    intervalMs = DEFAULT_READY_INTERVAL_MS,
  } = options;
  const startedAt = Date.now();
  let lastError = '';

  while (Date.now() - startedAt < timeoutMs) {
    if (server?.child && (server.child.exitCode !== null || server.child.signalCode !== null)) {
      throw new Error(`Dev server salio antes del readiness: ${describeChildExit(server.child)}`);
    }

    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return;
      lastError = `readiness devolvio ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(intervalMs);
  }

  throw new Error(`Timeout esperando readiness en ${url}${lastError ? ` (${lastError})` : ''}`);
}

export async function stopDevServer(server: DevServerHandle | null, options: StopDevServerOptions = {}) {
  if (!server) return;

  const { child, logStream } = server;
  const graceTimeoutMs = options.graceTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  const forceTimeoutMs = options.forceTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  try {
    if (child.exitCode === null && child.signalCode === null) {
      sendSignalToServerTree(child, 'SIGTERM');
      const exitedGracefully = await waitForChildClose(child, graceTimeoutMs);

      if (!exitedGracefully && child.exitCode === null && child.signalCode === null) {
        sendSignalToServerTree(child, 'SIGKILL');
        const exitedForcefully = await waitForChildClose(child, forceTimeoutMs);
        if (!exitedForcefully) {
          throw new Error(`No pude parar el dev server pid=${child.pid ?? 'unknown'}`);
        }
      }
    }
  } finally {
    child.stdout.unpipe();
    child.stderr.unpipe();
    child.stdout.destroy();
    child.stderr.destroy();
    await closeLogStream(logStream);
  }
}
