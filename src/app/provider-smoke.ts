#!/usr/bin/env node

import dotenv from 'dotenv';
import { buildCriticalProviderSmokeTargets, decideProviderSmokeTarget, type ProviderStatusSnapshot } from '../gateway/providers/providerSmoke.js';
import { resolveGatewayChatUrl } from '../core/config/gatewayUrl.js';

dotenv.config();

type ProviderStatusResponse = {
  providers: ProviderStatusSnapshot[];
};

type SmokeRunResult = {
  provider: string;
  model: string;
  capability: string;
  status: 'passed' | 'skipped' | 'failed';
  detail: string;
};

function getGatewayBaseUrl() {
  const chatUrl = new URL(resolveGatewayChatUrl(process.env));
  return chatUrl.origin;
}

async function fetchProviderStatus(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/providers/status`);
  if (!response.ok) {
    throw new Error(`No pude leer /api/providers/status (${response.status})`);
  }

  return await response.json() as ProviderStatusResponse;
}

async function runSmoke(baseUrl: string, target: { provider: string; model: string; capability: string }) {
  const response = await fetch(`${baseUrl}/api/providers/smoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: target.provider,
      model: target.model,
      toolCalling: target.capability === 'tool-calling',
    }),
  });

  const raw = await response.text();
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      detail: String(parsed?.details || parsed?.message || parsed?.error || raw || `HTTP ${response.status}`),
    };
  }

  return {
    ok: true,
    detail: String(parsed?.responsePreview || 'OK'),
  };
}

async function main() {
  const baseUrl = getGatewayBaseUrl();
  const { providers } = await fetchProviderStatus(baseUrl);
  const byProvider = new Map(providers.map((provider) => [provider.provider, provider]));
  const targets = buildCriticalProviderSmokeTargets();
  const results: SmokeRunResult[] = [];

  for (const target of targets) {
    const decision = decideProviderSmokeTarget(target, byProvider.get(target.provider));

    if (!decision.run) {
      results.push({
        provider: target.provider,
        model: target.model,
        capability: target.capability,
        status: 'skipped',
        detail: decision.reason || 'skipped',
      });
      continue;
    }

    const smoke = await runSmoke(baseUrl, target);
    results.push({
      provider: target.provider,
      model: target.model,
      capability: target.capability,
      status: smoke.ok ? 'passed' : 'failed',
      detail: smoke.detail,
    });
  }

  for (const result of results) {
    console.log(`[${result.status}] ${result.provider}/${result.model} [${result.capability}] - ${result.detail}`);
  }

  const failed = results.filter((result) => result.status === 'failed');
  const passed = results.filter((result) => result.status === 'passed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;

  console.log(`\nprovider smoke summary: passed=${passed} skipped=${skipped} failed=${failed.length}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(`[provider-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
