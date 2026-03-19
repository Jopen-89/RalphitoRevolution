import OpenAI from 'openai';
import type {
  IVisionProvider,
  Provider,
  Message,
  QuotaInfo,
  VisionResult,
  ToolCapabilityOptions,
  LLMResponse,
} from '../interfaces/gateway.types.js';

const VISION_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4o-search']);

export class OpenAIProvider implements IVisionProvider {
  name: Provider = 'openai';
  model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string = 'gpt-5.4') {
    this.client = new OpenAI({
      apiKey: apiKey,
    });
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[OpenAIProvider] Enrutando petición a ${this.model}...`);
    
    try {
      const response = await this.client.chat.completions.create(this.buildRequest(messages) as any);

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
      remainingMessages: 50,
      totalLimit: 100,
      percentage: 50,
    };
  }

  async generateResponseWithTools(messages: Message[], options: ToolCapabilityOptions): Promise<LLMResponse> {
    console.log(`[OpenAIProvider] Enrutando petición con tools a ${this.model}...`);

    const response = await this.client.chat.completions.create(this.buildRequest(messages, options) as any);
    const choice = response.choices[0]?.message;
    const toolCalls = (choice?.tool_calls || []) as Array<{ id: string; function?: { name: string; arguments: string } }>;

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: toolCalls.map((toolCall) => {
          if (!toolCall.function) {
            throw new Error('OpenAI devolvio una tool call sin payload de funcion.');
          }

          return {
            id: toolCall.id,
            name: toolCall.function.name,
            input: parseToolArguments(toolCall.function.arguments),
          };
        }),
      };
    }

    return {
      type: 'final',
      text: choice?.content || 'Sin respuesta de OpenAI',
    };
  }

  async evaluateVisual(screenshotBase64: string, route: string, rubric: string): Promise<VisionResult> {
    if (!VISION_MODELS.has(this.model)) {
      return {
        status: 'warn',
        summary: `Modelo ${this.model} no soporta Vision.`,
        issues: [`model_no_vision:${this.model}`],
      };
    }

    console.log(`[OpenAIProvider] evaluateVisual route=${route} model=${this.model}`);

    try {
      const prompt = [
        `Ruta evaluada: ${route}`,
        'Rubrica visual de Lola:',
        rubric,
        'Responde JSON valido con las claves status, summary e issues. status solo puede ser pass, fail o warn.',
      ].join('\n\n');

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
          ],
        }],
        max_tokens: 1024,
        temperature: 0.3,
      });

      const raw = response.choices[0]?.message?.content || '';
      return this.parseVisionResult(raw);
    } catch (error) {
      return {
        status: 'warn',
        summary: 'Excepcion en evaluateVisual de OpenAI.',
        issues: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private parseVisionResult(raw: string): VisionResult {
    const trimmed = raw.trim();
    if (!trimmed) return { status: 'warn', summary: 'Respuesta vacia de OpenAI.', issues: [] };

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

    return { status: 'warn', summary: 'No pude parsear respuesta estructurada de OpenAI.', issues: [trimmed.slice(0, 200)], rawModelOutput: raw };
  }

  private buildRequest(messages: Message[], options?: ToolCapabilityOptions) {
    return {
      model: this.model,
      messages: messages.map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'tool' as const,
            content: message.content,
            tool_call_id: message.toolCallId || '',
          };
        }

        if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
          return {
            role: 'assistant' as const,
            content: message.content || '',
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function' as const,
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          };
        }

        return {
          role: message.role as 'user' | 'assistant' | 'system',
          content: message.content,
        };
      }),
      ...(options ? {
        tools: options.tools.map((tool) => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      } : {}),
    };
  }
}

function parseToolArguments(rawArguments: string) {
  if (!rawArguments.trim()) return {};

  try {
    return JSON.parse(rawArguments) as Record<string, unknown>;
  } catch {
    throw new Error(`OpenAI devolvio argumentos de tool invalidos: ${rawArguments}`);
  }
}
