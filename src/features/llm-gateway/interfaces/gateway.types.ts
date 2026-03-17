export type Provider = 'gemini' | 'codex' | 'opencode';

export interface ChatRequest {
  provider: Provider;
  prompt: string;
}

export interface ChatResponse {
  response: string;
  providerUsed: Provider;
}

export interface ILLMProvider {
  name: Provider;
  generateResponse(prompt: string): Promise<string>;
}
