import type { OAuth2Client } from 'google-auth-library';
import type {
  IVisionProvider,
  IToolCallingProvider,
  Provider,
  Message,
  QuotaInfo,
  ToolDefinition,
  ToolCall,
  VisionResult,
} from '../interfaces/gateway.types.js';

export class GeminiProvider implements IVisionProvider, IToolCallingProvider {
  name: Provider = 'gemini';
  private oAuth2Client: OAuth2Client;
  model: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(oAuth2Client: OAuth2Client, model: string = 'gemini-2.0-flash') {
    this.oAuth2Client = oAuth2Client;
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[GeminiProvider] Enrutando petición a ${this.model} usando Google OAuth...`);

    try {
      const { token } = await this.oAuth2Client.getAccessToken();

      if (!token) {
        throw new Error('No se pudo obtener un token de acceso válido de Google.');
      }

      const geminiContents = messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contents: geminiContents,
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Error de Gemini API: ${response.status} - ${errorData}`);
      }

      const data = await response.json();

      if (data.candidates && data.candidates.length > 0) {
        return data.candidates[0].content.parts[0].text;
      }

      throw new Error('Respuesta de Gemini vacía o en formato inesperado.');
    } catch (error) {
      console.error('[GeminiProvider] Fallo al conectar con Gemini:', error);
      throw error;
    }
  }

  async generateResponseWithTools(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    console.log(`[GeminiProvider] generateResponseWithTools a ${this.model} con ${tools.length} tools...`);

    const { token } = await this.oAuth2Client.getAccessToken();
    if (!token) {
      throw new Error('No se pudo obtener un token de acceso válido de Google.');
    }

    const geminiContents = messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || 'tool',
              id: msg.toolCallId,
              response: { result: msg.content }
            }
          }]
        };
      }
      
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'model',
          parts: msg.toolCalls.map((tc) => {
            const metadata = tc.metadata as { thoughtSignature?: string } | undefined;
            return {
              functionCall: {
                name: tc.name,
                args: tc.arguments,
                id: tc.id
              },
              ...(metadata?.thoughtSignature ? { thoughtSignature: metadata.thoughtSignature } : {})
            };
          })
        };
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content || ' ' }],
      };
    });

    const functionDeclarations = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
      tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
      },
    };

    const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error de Gemini API: ${response.status} - ${errorData}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await response.json() as any;

    const parts = data.candidates?.[0]?.content?.parts || [];
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        textParts.push(part.text);
      } else if (part.functionCall) {
        console.log('[GeminiProvider] Received functionCall part:', JSON.stringify(part, null, 2));
        const fc = part.functionCall;
        toolCalls.push({
          id: fc.id || `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: fc.name,
          arguments: fc.args || {},
          metadata: { thoughtSignature: part.thoughtSignature }
        });
      }
    }

    return { text: textParts.join('\n'), toolCalls };
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 999,
      totalLimit: 999,
      percentage: 100,
    };
  }

  async evaluateVisual(screenshotBase64: string, route: string, rubric: string): Promise<VisionResult> {
    console.log(`[GeminiProvider] evaluateVisual route=${route} model=${this.model}`);

    try {
      const { token } = await this.oAuth2Client.getAccessToken();
      if (!token) {
        return { status: 'warn', summary: 'No se pudo obtener token de Google OAuth.', issues: ['google_oauth_no_token'] };
      }

      const prompt = [
        `Ruta evaluada: ${route}`,
        'Rubrica visual de Lola:',
        rubric,
        'Responde JSON valido con las claves status, summary e issues. status solo puede ser pass, fail o warn.',
      ].join('\n\n');

      const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/png', data: screenshotBase64 } },
            ],
          }],
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        return { status: 'warn', summary: `Gemini API error ${response.status}`, issues: [errorData.slice(0, 300)] };
      }

      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      return this.parseVisionResult(raw);
    } catch (error) {
      return {
        status: 'warn',
        summary: 'Excepcion en evaluateVisual de Gemini.',
        issues: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private parseVisionResult(raw: string): VisionResult {
    const trimmed = raw.trim();
    if (!trimmed) return { status: 'warn', summary: 'Respuesta vacia de Gemini.', issues: [] };

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const candidate = fenced?.[1]?.trim() || trimmed;

    try {
      const parsed = JSON.parse(candidate) as { status?: string; summary?: string; issues?: unknown };
      const status = parsed?.status;
      if (status === 'pass' || status === 'fail' || status === 'warn') {
        return {
          status,
          summary: typeof parsed?.summary === 'string' ? parsed.summary : 'Sin resumen.',
          issues: Array.isArray(parsed?.issues) ? parsed.issues.map(String) : [],
          rawModelOutput: raw,
        };
      }
    } catch { /* ignore parse failure */ }

    return { status: 'warn', summary: 'No pude parsear respuesta estructurada de Gemini.', issues: [trimmed.slice(0, 200)], rawModelOutput: raw };
  }
}
