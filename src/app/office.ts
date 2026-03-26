#!/usr/bin/env node

import dotenv from 'dotenv';
import { spawn, type ChildProcess } from 'child_process';
import { waitForReady } from './dev-server.js';
import { resolveGatewayChatUrl, resolveGatewayHealthUrl, validateGatewayRuntimeConfig } from '../core/config/gatewayUrl.js';

dotenv.config();

type OfficeService = {
  name: string;
  command: string;
  args: string[];
  child?: ChildProcess;
};

validateGatewayRuntimeConfig(process.env);

const gatewayChatUrl = resolveGatewayChatUrl(process.env);
const gatewayHealthUrl = resolveGatewayHealthUrl(process.env);

const services: OfficeService[] = [
  {
    name: 'gateway',
    command: 'node',
    args: ['--import', 'tsx', 'src/app/server.ts'],
  },
  {
    name: 'telegram',
    command: 'node',
    args: ['--import', 'tsx', 'src/interfaces/telegram/bot.ts'],
  },
];

let shuttingDown = false;

function pipeOutput(service: OfficeService, child: ChildProcess) {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${service.name}] ${chunk}`);
  });

  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${service.name}] ${chunk}`);
  });
}

function startService(service: OfficeService) {
  const child = spawn(service.command, service.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      RALPHITO_GATEWAY_URL: gatewayChatUrl,
      RALPHITO_GATEWAY_HEALTH_URL: gatewayHealthUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  service.child = child;
  pipeOutput(service, child);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    console.error(`[office] Service ${service.name} exited unexpectedly (${reason}).`);
    void shutdown(1);
  });

  return child;
}

async function stopService(service: OfficeService) {
  const child = service.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('\n[office] Shutting down Ralphito Virtual Office...');
  await Promise.allSettled([...services].reverse().map((service) => stopService(service)));
  process.exit(exitCode);
}

async function main() {
  console.log('[office] Starting Ralphito Virtual Office...');

  startService(services[0]!);
  await waitForReady({ url: gatewayHealthUrl, timeoutMs: 60000, intervalMs: 1000 });
  console.log(`[office] Gateway ready at ${gatewayHealthUrl}`);
  console.log(`[office] Gateway chat endpoint ${gatewayChatUrl}`);

  startService(services[1]!);
  console.log('[office] Telegram bot started.');
  console.log('[office] Virtual Office is up. Press Ctrl+C to stop all services.');
}

process.once('SIGINT', () => {
  void shutdown(0);
});

process.once('SIGTERM', () => {
  void shutdown(0);
});

void main().catch((error) => {
  console.error('[office] Failed to start services:', error instanceof Error ? error.message : String(error));
  void shutdown(1);
});
