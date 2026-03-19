import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { OpencodeProvider } from './opencode.js';
import { CodexProvider } from './codex.js';
import type { Provider, ILLMProvider } from '../interfaces/gateway.types.js';

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
}
