import OpenAI from 'openai';
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

const VISION_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4o-search']);

export class OpenAIProvider implements IVisionProvider, IToolCallingProvider {
  name: Provider = 'openai';
  model: string;
  private client: OpenAI;

  constructor(apiKey: string, model: string = 'gpt-4o') {
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
        messages: messages.map((msg) => ({
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

  async generateResponseWithTools(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    console.log(`[OpenAIProvider] generateResponseWithTools a ${this.model} con ${tools.length} tools...`);

    const openaiTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              { type: param.type, description: param.description },
            ]),
          ),
          required: Object.entries(tool.parameters)
            .filter(([, param]) => param.required === true)
            .map(([key]) => key),
        },
      },
    }));

    const mappedMessages = messages.map((msg) => {
      if (msg.role === 'tool') {
        const tm = msg as unknown as { toolCallId: string; content: string };
        return {
          role: 'tool' as const,
          content: tm.content,
          tool_call_id: tm.toolCallId,
        };
      }
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      };
    });

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: mappedMessages as OpenAI.Chat.ChatCompletionMessageParam[],
    };

    if (openaiTools.length > 0) {
      requestParams.tools = openaiTools;
      requestParams.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(requestParams);

    const choice = response.choices[0]?.message;

    if (!choice) {
      return { text: 'Sin respuesta de OpenAI', toolCalls: [] };
    }

    const text = choice.content || '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCalls: ToolCall[] = (choice.tool_calls as any[])?.map((tc) => ({
      id: tc.id || '',
      name: tc.function?.name || tc.name || '',
      arguments: JSON.parse(tc.function?.arguments || tc.arguments || '{}'),
    })) || [];

    return { text, toolCalls };
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 50,
      totalLimit: 100,
      percentage: 50,
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
}
