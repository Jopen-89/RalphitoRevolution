import type { ILLMProvider, Provider, Message, QuotaInfo } from '../interfaces/gateway.types.js';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
};

type AnthropicResponse = {
  error?: { type?: string; message?: string };
  content?: Array<{ type?: string; text?: string }>;
};

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic';
const DEFAULT_MAX_TOKENS = 4096;

export class OpencodeProvider implements ILLMProvider {
  name: Provider = 'opencode';
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = 'minimax-m2.7') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = (process.env.MINIMAX_BASE_URL || DEFAULT_MINIMAX_BASE_URL).replace(/\/$/, '');
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[OpencodeProvider] Enrutando petición a ${this.model} (MiniMax Anthropic-compatible)...`);

    const { systemPrompt, conversation } = this.toAnthropicPayload(messages);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: conversation,
        }),
      });

      const raw = await response.text();
      let data: AnthropicResponse;

      try {
        data = JSON.parse(raw) as AnthropicResponse;
      } catch {
        throw new Error(`MiniMax devolvió una respuesta no JSON: ${raw.slice(0, 500)}`);
      }

      if (!response.ok) {
        const message = data.error?.message || raw;
        throw new Error(`Error de MiniMax API: ${response.status} - ${message}`);
      }

      const text = (data.content || [])
        .filter((item) => item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
        .trim();

      if (!text) {
        throw new Error('Respuesta de MiniMax vacía o en formato inesperado.');
      }

      return text;
    } catch (error) {
      console.error('[OpencodeProvider] Fallo al conectar con MiniMax:', error);
      throw error;
    }
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 100,
      totalLimit: 100,
      percentage: 100,
    };
  }

  private toAnthropicPayload(messages: Message[]) {
    const systemParts: string[] = [];
    const conversation: AnthropicMessage[] = [];

    for (const message of messages) {
      const content = message.content.trim();
      if (!content) continue;

      if (message.role === 'system') {
        systemParts.push(content);
        continue;
      }

      conversation.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: content }],
      });
    }

    if (conversation.length === 0) {
      conversation.push({
        role: 'user',
        content: [{ type: 'text', text: 'Hola' }],
      });
    }

    return {
      systemPrompt: systemParts.join('\n\n').trim(),
      conversation,
    };
  }
}
