import OpenAI from 'openai';
import type { ILLMProvider, Provider, Message, QuotaInfo } from '../interfaces/gateway.types.js';

export class OpenAIProvider implements ILLMProvider {
  name: Provider = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-5.4') {
    this.client = new OpenAI({
      apiKey: apiKey,
    });
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[OpenAIProvider] Enrutando petición a ${this.model}...`);
    
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map(msg => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
        })),
      });

      const content = response.choices[0]?.message?.content;
      return content || 'Sin respuesta de OpenAI';
    } catch (error) {
      console.error('[OpenAIProvider] Fallo al conectar con OpenAI:', error);
      throw error;
    }
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 50, // Estimación
      totalLimit: 100,
      percentage: 50,
    };
  }
}
