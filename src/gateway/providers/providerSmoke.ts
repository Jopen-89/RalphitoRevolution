import type { Provider } from '../../core/domain/gateway.types.js';
import { PROVIDER_MATRIX } from './providerCatalog.js';

export type SmokeCapability = 'chat' | 'tool-calling';

export type ProviderStatusSnapshot = {
  provider: Provider;
  officialModels: string[];
  readiness: {
    available: boolean;
    checks: string[];
  };
  chat: boolean;
  toolCalling: boolean;
  vision: boolean;
};

export type ProviderSmokeTarget = {
  provider: Provider;
  model: string;
  capability: SmokeCapability;
};

export type ProviderSmokeDecision = {
  run: boolean;
  reason?: string;
};

export function buildCriticalProviderSmokeTargets(): ProviderSmokeTarget[] {
  return Object.values(PROVIDER_MATRIX).flatMap((entry) => {
    const model = entry.officialModels[0]!;
    const targets: ProviderSmokeTarget[] = [{ provider: entry.provider, model, capability: 'chat' }];

    if (entry.toolCalling) {
      targets.push({ provider: entry.provider, model, capability: 'tool-calling' });
    }

    return targets;
  });
}

export function decideProviderSmokeTarget(
  target: ProviderSmokeTarget,
  providerStatus: ProviderStatusSnapshot | undefined,
): ProviderSmokeDecision {
  if (!providerStatus) {
    return { run: false, reason: 'provider_missing_from_status' };
  }

  const capabilitySupported = target.capability === 'tool-calling' ? providerStatus.toolCalling : providerStatus.chat;
  if (!capabilitySupported) {
    return { run: false, reason: `capability_unsupported:${target.capability}` };
  }

  if (!providerStatus.readiness.available) {
    return {
      run: false,
      reason: providerStatus.readiness.checks.join(', ') || 'provider_unavailable',
    };
  }

  return { run: true };
}
