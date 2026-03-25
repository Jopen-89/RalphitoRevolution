import { authenticateGoogle } from '../auth/google-oauth.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { OpencodeProvider } from './opencode.js';
import { CodexProvider } from './codex.js';
import type { Provider, ILLMProvider, IVisionProvider } from '../../core/domain/gateway.types.js';

export class ProviderFactory {
  static create(
    provider: Provider,
    model: string,
    auth: { googleAuthClient?: any; openAiKey?: string; minimaxKey?: string }
  ): ILLMProvider {
    switch (provider) {
      case 'gemini':
        if (!auth.googleAuthClient) throw new Error('Google OAuth no está autenticado.');
        return new GeminiProvider(auth.googleAuthClient, model);
      case 'openai':
        if (!auth.openAiKey) throw new Error('Falta OPENAI_API_KEY en el entorno.');
        return new OpenAIProvider(auth.openAiKey, model);
      case 'opencode':
        if (!auth.minimaxKey) throw new Error('Falta MINIMAX_API_KEY en el entorno.');
        return new OpencodeProvider(auth.minimaxKey, model);
      case 'codex':
        return new CodexProvider(model);
      default:
        throw new Error(`Proveedor ${provider} no soportado por la factoría.`);
    }
  }

  static async createVisionProvider(
    provider: Provider,
    model: string,
    auth: { googleAuthClient?: any; openAiKey?: string; minimaxKey?: string }
  ): Promise<IVisionProvider | null> {
    switch (provider) {
      case 'gemini': {
        const oauthClient = auth.googleAuthClient ?? await authenticateGoogle().catch(() => null);
        if (!oauthClient) return null;
        return new GeminiProvider(oauthClient, model);
      }
      case 'openai':
        if (!auth.openAiKey) return null;
        return new OpenAIProvider(auth.openAiKey, model);
      case 'opencode':
        if (!auth.minimaxKey) return null;
        return new OpencodeProvider(auth.minimaxKey, model);
      case 'codex':
        return new CodexProvider(model);
      default:
        return null;
    }
  }
}
