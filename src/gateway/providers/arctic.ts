import type { ILLMProvider, Provider, QuotaInfo, Message } from '../../core/domain/gateway.types.js';

export class ArcticProvider implements ILLMProvider {
  name: Provider;
  private model: string;

  constructor(provider: Provider, model: string = '5.4') {
    this.name = provider;
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[ArcticProvider] Enrutando petición a ${this.name} (Modelo: ${this.model}) a través de Arctic...`);
    
    try {
      const response = await fetch('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer arctic-local'
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages
        })
      });

      if (!response.ok) {
        throw new Error(`Error de Arctic: ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('[ArcticProvider] Fallo al conectar con Arctic:', error);
      throw error;
    }
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    // En una implementación real, aquí leeríamos el archivo SQLite o JSON 
    // en ~/.config/arctic para extraer el uso real de la suscripción.
    
    // Para esta fase, simulamos la lectura de los límites de ChatGPT Plus (80 mensajes/3h)
    const totalLimit = this.name === 'gemini' ? 999 : 80; // Gemini Advanced tiene límites más altos
    const remainingMessages = this.name === 'gemini' ? 999 : Math.floor(Math.random() * 40) + 20; // Simula 20-60 restantes
    const percentage = Math.round((remainingMessages / totalLimit) * 100);
    
    // Simulamos que el límite se reinicia en 3 horas
    const resetTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      provider: this.name,
      remainingMessages,
      totalLimit,
      percentage,
      resetTime
    };
  }
}
