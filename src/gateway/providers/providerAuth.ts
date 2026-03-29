import type { Provider } from '../../core/domain/gateway.types.js';
import { authenticateGoogle } from '../auth/google-oauth.js';

let googleAuthClientPromise: Promise<any> | null = null;

function readEnvValue(name: string) {
  const value = process.env[name];
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}

async function getGoogleAuthClient() {
  if (!googleAuthClientPromise) {
    googleAuthClientPromise = authenticateGoogle().catch((error: unknown) => {
      googleAuthClientPromise = null;
      throw error;
    });
  }

  return googleAuthClientPromise;
}

export async function buildProviderAuth(provider?: Provider) {
  return {
    ...(provider === 'gemini' ? { googleAuthClient: await getGoogleAuthClient() } : {}),
    ...(readEnvValue('OPENAI_API_KEY') ? { openAiKey: readEnvValue('OPENAI_API_KEY')! } : {}),
    ...(readEnvValue('MINIMAX_API_KEY') ? { minimaxKey: readEnvValue('MINIMAX_API_KEY')! } : {}),
  };
}
