import type { OAuth2Client } from 'google-auth-library';
import type { ILLMProvider, Provider, Message, QuotaInfo } from '../interfaces/gateway.types.js';

export class GeminiProvider implements ILLMProvider {
  name: Provider = 'gemini';
  private oAuth2Client: OAuth2Client;
  private model: string;
  // Usamos el endpoint de la API de Vertex AI para Gemini (que soporta OAuth)
  // Nota: Para cuentas personales con suscripción, a veces se requiere el endpoint de generativelanguage, 
  // pero el auth header es el mismo. Usaremos generativelanguage por defecto para cuentas de usuario.
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(oAuth2Client: OAuth2Client, model: string = 'gemini-2.5-pro') {
    this.oAuth2Client = oAuth2Client;
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[GeminiProvider] Enrutando petición a ${this.model} usando Google OAuth...`);
    
    try {
      // 1. Obtener el token de acceso fresco
      const { token } = await this.oAuth2Client.getAccessToken();
      
      if (!token) {
        throw new Error('No se pudo obtener un token de acceso válido de Google.');
      }

      // 2. Mapear los mensajes de Telegram/Gateway al formato de Gemini
      const geminiContents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user', // Gemini usa 'model' en lugar de 'assistant'
        parts: [{ text: msg.content }]
      }));

      // 3. Hacer la petición a la API de Gemini usando el token OAuth en la cabecera
      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // Aquí está la magia: enviamos tu token personal
        },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Error de Gemini API: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      
      // Extraer la respuesta del formato de Gemini
      if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
      }
      
      throw new Error('Respuesta de Gemini vacía o en formato inesperado.');

    } catch (error) {
      console.error('[GeminiProvider] Fallo al conectar con Gemini:', error);
      throw error;
    }
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 999, // Con OAuth el límite depende de tu suscripción personal
      totalLimit: 999,
      percentage: 100,
    };
  }
}
