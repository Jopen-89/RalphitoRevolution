import { existsSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Provider } from '../../core/domain/gateway.types.js';

export interface ProviderMatrixEntry {
  provider: Provider;
  authMode: 'google-oauth' | 'env' | 'opencode-cli';
  chat: boolean;
  toolCalling: boolean;
  vision: boolean;
  officialModels: string[];
  notes: string;
  routingRecommendation: string;
}

export interface ProviderReadiness {
  configured: boolean;
  authenticated: boolean;
  available: boolean;
  bootstrappable: boolean;
  checks: string[];
}

export interface ProviderCapabilityHealth {
  chat: {
    ok: boolean;
    availableProviders: Provider[];
    degradedProviders: Provider[];
  };
  toolCalling: {
    ok: boolean;
    availableProviders: Provider[];
    degradedProviders: Provider[];
  };
  vision: {
    ok: boolean;
    availableProviders: Provider[];
    degradedProviders: Provider[];
  };
}

export interface ProviderAuthSnapshot {
  googleAuthClient?: unknown;
  openAiKey?: string;
  minimaxKey?: string;
}

export const PROVIDER_MATRIX: Record<Provider, ProviderMatrixEntry> = {
  gemini: {
    provider: 'gemini',
    authMode: 'google-oauth',
    chat: true,
    toolCalling: true,
    vision: true,
    officialModels: ['gemini-3.1-pro-preview'],
    notes: 'Usa Google OAuth con token persistido en .tokens/google.json.',
    routingRecommendation: 'Usa gemini para chat, tool-calling y vision cuando Google OAuth este autenticado.',
  },
  openai: {
    provider: 'openai',
    authMode: 'env',
    chat: true,
    toolCalling: true,
    vision: true,
    officialModels: ['gpt-5.4'],
    notes: 'Usa la API directa de OpenAI desde OPENAI_API_KEY.',
    routingRecommendation: 'Usa openai cuando quieras API directa y tool-calling de primera clase.',
  },
  opencode: {
    provider: 'opencode',
    authMode: 'env',
    chat: true,
    toolCalling: true,
    vision: false,
    officialModels: ['minimax-m2.7'],
    notes: 'Provider MiniMax sobre endpoint compatible Anthropic usando MINIMAX_API_KEY.',
    routingRecommendation: 'Usa opencode para MiniMax y workloads con tool-calling sobre minimax-m2.7.',
  },
  codex: {
    provider: 'codex',
    authMode: 'opencode-cli',
    chat: true,
    toolCalling: false,
    vision: false,
    officialModels: ['gpt-5.4'],
    notes: 'Bridge por opencode CLI con suscripcion activa; hoy es chat-only.',
    routingRecommendation: 'Usa codex si quieres la ruta por suscripcion CLI. Para tool-calling con gpt-5.4 usa openai.',
  },
};

function hasOpencodeCli() {
  const result = spawnSync('opencode', ['--version'], { encoding: 'utf8', timeout: 3000 });
  return result.status === 0;
}

function hasGoogleToken() {
  return existsSync(path.join(process.cwd(), '.tokens', 'google.json'));
}

export function buildProviderReadiness(auth: ProviderAuthSnapshot) {
  const opencodeReady = hasOpencodeCli();
  const googleTokenReady = hasGoogleToken();
  const googleCredentialsConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const geminiRuntimeReady = Boolean(auth.googleAuthClient);
  const geminiBootstrappable = googleCredentialsConfigured && googleTokenReady;

  const readiness: Record<Provider, ProviderReadiness> = {
    gemini: {
      configured: googleCredentialsConfigured,
      authenticated: geminiRuntimeReady,
      available: geminiRuntimeReady,
      bootstrappable: geminiBootstrappable,
      checks: [
        process.env.GOOGLE_CLIENT_ID ? 'GOOGLE_CLIENT_ID:set' : 'GOOGLE_CLIENT_ID:missing',
        process.env.GOOGLE_CLIENT_SECRET ? 'GOOGLE_CLIENT_SECRET:set' : 'GOOGLE_CLIENT_SECRET:missing',
        googleTokenReady ? 'google_token:present' : 'google_token:missing',
        geminiRuntimeReady ? 'google_auth_client:ready' : 'google_auth_client:missing',
      ],
    },
    openai: {
      configured: Boolean(auth.openAiKey),
      authenticated: Boolean(auth.openAiKey),
      available: Boolean(auth.openAiKey),
      bootstrappable: Boolean(auth.openAiKey),
      checks: [auth.openAiKey ? 'OPENAI_API_KEY:set' : 'OPENAI_API_KEY:missing'],
    },
    opencode: {
      configured: Boolean(auth.minimaxKey),
      authenticated: Boolean(auth.minimaxKey),
      available: Boolean(auth.minimaxKey),
      bootstrappable: Boolean(auth.minimaxKey),
      checks: [auth.minimaxKey ? 'MINIMAX_API_KEY:set' : 'MINIMAX_API_KEY:missing'],
    },
    codex: {
      configured: opencodeReady,
      authenticated: opencodeReady,
      available: opencodeReady,
      bootstrappable: opencodeReady,
      checks: [opencodeReady ? 'opencode_cli:present' : 'opencode_cli:missing'],
    },
  };

  return readiness;
}

export function getProviderCatalogStatus(auth: ProviderAuthSnapshot) {
  const readiness = buildProviderReadiness(auth);

  return Object.values(PROVIDER_MATRIX).map((entry) => ({
    ...entry,
    readiness: readiness[entry.provider],
  }));
}

export function buildProviderCapabilityHealth(auth: ProviderAuthSnapshot): ProviderCapabilityHealth {
  const providers = getProviderCatalogStatus(auth);

  const collect = (capability: 'chat' | 'toolCalling' | 'vision') => {
    const availableProviders = providers
      .filter((provider) => provider[capability] && provider.readiness.available)
      .map((provider) => provider.provider);
    const degradedProviders = providers
      .filter((provider) => provider[capability] && !provider.readiness.available)
      .map((provider) => provider.provider);

    return {
      ok: availableProviders.length > 0,
      availableProviders,
      degradedProviders,
    };
  };

  return {
    chat: collect('chat'),
    toolCalling: collect('toolCalling'),
    vision: collect('vision'),
  };
}
