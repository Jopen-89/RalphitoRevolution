import type { Provider } from '../../core/domain/gateway.types.js';
import { PROVIDER_MATRIX } from './providerCatalog.js';

export type ProviderAttempt = {
  provider: Provider;
  model: string;
  providerProfile?: string;
};

export interface ToolCallingReroute {
  from: ProviderAttempt;
  to: ProviderAttempt;
  reason: 'codex_requires_openai_tool_calling';
}

function buildAttemptKey(attempt: ProviderAttempt) {
  return [attempt.provider, attempt.model, attempt.providerProfile || ''].join('::');
}

function resolveToolCallingAttempt(attempt: ProviderAttempt): ProviderAttempt | null {
  if (PROVIDER_MATRIX[attempt.provider].toolCalling) {
    return attempt;
  }

  if (attempt.provider === 'codex') {
    return {
      provider: 'openai',
      model: PROVIDER_MATRIX.openai.officialModels[0] || 'gpt-5.4',
    };
  }

  return null;
}

export function splitToolCallingAttempts(attempts: ProviderAttempt[]) {
  const supported: ProviderAttempt[] = [];
  const unsupported: ProviderAttempt[] = [];
  const rerouted: ToolCallingReroute[] = [];
  const seen = new Set<string>();

  for (const attempt of attempts) {
    const resolvedAttempt = resolveToolCallingAttempt(attempt);
    if (!resolvedAttempt) {
      unsupported.push(attempt);
      continue;
    }

    const key = buildAttemptKey(resolvedAttempt);
    if (!seen.has(key)) {
      seen.add(key);
      supported.push(resolvedAttempt);
    }

    if (
      resolvedAttempt.provider !== attempt.provider
      || resolvedAttempt.model !== attempt.model
      || resolvedAttempt.providerProfile !== attempt.providerProfile
    ) {
      rerouted.push({
        from: attempt,
        to: resolvedAttempt,
        reason: 'codex_requires_openai_tool_calling',
      });
    }
  }

  return { supported, unsupported, rerouted };
}

export function buildToolCallingUnsupportedMessage(attempts: ProviderAttempt[]) {
  const unsupportedProviders = Array.from(new Set(attempts.map((attempt) => attempt.provider)));

  if (unsupportedProviders.length === 0) {
    return 'No hay providers configurados con soporte de tool-calling.';
  }

  if (unsupportedProviders.length === 1) {
    return `Provider ${unsupportedProviders[0]} no soporta tool-calling. Usa OpenAI, Gemini o Opencode.`;
  }

  return `Los providers configurados (${unsupportedProviders.join(', ')}) no soportan tool-calling. Usa OpenAI, Gemini o Opencode.`;
}
