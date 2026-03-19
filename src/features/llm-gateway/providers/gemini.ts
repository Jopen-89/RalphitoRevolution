import type { OAuth2Client } from 'google-auth-library';
import type {
  IVisionProvider,
  Provider,
  Message,
  QuotaInfo,
  VisionResult,
  ToolCapabilityOptions,
  LLMResponse,
} from '../interfaces/gateway.types.js';

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name?: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
};

export class GeminiProvider implements IVisionProvider {
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
      const data = await this.generateContent(messages);
      
      // Extraer la respuesta del formato de Gemini
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n').trim();
      if (text) {
        return text;
      }
      
      throw new Error('Respuesta de Gemini vacía o en formato inesperado.');

    } catch (error) {
      console.error('[GeminiProvider] Fallo al conectar con Gemini:', error);
      throw error;
    }
  }

  async generateResponseWithTools(messages: Message[], options: ToolCapabilityOptions): Promise<LLMResponse> {
    console.log(`[GeminiProvider] Enrutando petición con tools a ${this.model}...`);

    const data = await this.generateContent(messages, options);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const toolCalls = parts.filter((part) => part.functionCall?.name);

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: toolCalls.map((part, index) => ({
          id: `gemini-call-${Date.now()}-${index}`,
          name: part.functionCall?.name || 'unknown_tool',
          input: part.functionCall?.args || {},
        })),
      };
    }

    const text = parts.map((part) => part.text || '').join('\n').trim();
    return {
      type: 'final',
      text: text || 'Sin respuesta de Gemini',
    };
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

  private async generateContent(messages: Message[], options?: ToolCapabilityOptions) {
    const { token } = await this.oAuth2Client.getAccessToken();
    if (!token) {
      throw new Error('No se pudo obtener un token de acceso válido de Google.');
    }

    const systemInstruction = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join('\n\n');

    const contents = messages
      .filter((message) => message.role !== 'system')
      .map((message) => {
        if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
          return {
            role: 'model',
            parts: message.toolCalls.map((toolCall) => ({
              functionCall: {
                name: toolCall.name,
                args: toolCall.input,
              },
            })),
          };
        }

        if (message.role === 'tool') {
          return {
            role: 'user',
            parts: [{
              functionResponse: {
                name: message.toolName || 'tool',
                response: {
                  content: safeParseJson(message.content),
                },
              },
            }],
          };
        }

        return {
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        };
      });

    const response = await fetch(`${this.baseUrl}/${this.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        contents,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
        ...(options ? {
          tools: [{
            functionDeclarations: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
          }],
        } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Error de Gemini API: ${response.status} - ${errorData}`);
    }

    return await response.json() as GeminiGenerateContentResponse;
  }
}

function safeParseJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}
