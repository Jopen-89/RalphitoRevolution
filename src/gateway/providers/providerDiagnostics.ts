import type { Provider } from '../../core/domain/gateway.types.js';

export type ProviderAttemptDiagnostic = {
  provider: Provider;
  model: string;
  capability: 'chat' | 'tool-calling';
  success: boolean;
  reason?: string;
};

export function toDiagnosticErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createAttemptDiagnostic(
  provider: Provider,
  model: string,
  capability: 'chat' | 'tool-calling',
  error: unknown,
): ProviderAttemptDiagnostic {
  return {
    provider,
    model,
    capability,
    success: false,
    reason: toDiagnosticErrorMessage(error),
  };
}

export function formatAttemptSummary(attempts: ProviderAttemptDiagnostic[]) {
  if (attempts.length === 0) {
    return 'No hubo intentos de provider.';
  }

  return attempts
    .map((attempt) => `${attempt.provider}/${attempt.model} [${attempt.capability}]: ${attempt.reason || (attempt.success ? 'ok' : 'failed')}`)
    .join(' | ');
}
