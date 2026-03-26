import type { Provider } from '../../core/domain/gateway.types.js';
import { PROVIDER_MATRIX } from './providerCatalog.js';

export type ProviderAttempt = {
  provider: Provider;
  model: string;
  providerProfile?: string;
};

export function splitToolCallingAttempts(attempts: ProviderAttempt[]) {
  const supported: ProviderAttempt[] = [];
  const unsupported: ProviderAttempt[] = [];

  for (const attempt of attempts) {
    if (PROVIDER_MATRIX[attempt.provider].toolCalling) {
      supported.push(attempt);
    } else {
      unsupported.push(attempt);
    }
  }

  return { supported, unsupported };
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
