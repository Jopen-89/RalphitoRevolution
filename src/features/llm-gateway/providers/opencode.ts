import type { ILLMProvider, Provider, Message, QuotaInfo } from '../interfaces/gateway.types.js';

export class OpencodeProvider implements ILLMProvider {
  name: Provider = 'opencode';
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.minimax.chat/v1/text/chatcompletion_v2';

  constructor(apiKey: string, model: string = 'minimax-m2.5') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[OpencodeProvider] Enrutando petición a ${this.model} (MiniMax)...`);
    
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
          }))
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Error de MiniMax API: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content;
      }
      
      throw new Error('Respuesta de MiniMax vacía o en formato inesperado.');

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
}
