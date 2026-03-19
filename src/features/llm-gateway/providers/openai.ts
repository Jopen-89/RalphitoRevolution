import OpenAI from 'openai';
import type { IVisionProvider, Provider, Message, QuotaInfo, VisionResult, ToolDefinition, ToolCall, ToolCallMessage, ILLMToolProvider } from '../interfaces/gateway.types.js';

const VISION_MODELS = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-vision-preview', 'gpt-4o-search']);

export class OpenAIProvider implements IVisionProvider, ILLMToolProvider {
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

  async generateResponseWithTools(
    messages: (Message | ToolCallMessage)[],
    tools: ToolDefinition[]
  ): Promise<{ message: Message | ToolCallMessage; toolCalls?: ToolCall[] }> {
    console.log(`[OpenAIProvider] Enrutando petición con tools a ${this.model}...`);

    try {
      const openaiTools = tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      for (const msg of messages) {
        if ('tool_calls' in msg && msg.tool_calls) {
          const toolCallsArray = msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
          (formattedMessages as OpenAI.Chat.ChatCompletionAssistantMessageParam[]).push({
            role: 'assistant',
            content: (msg as Message).content || '',
            tool_calls: toolCallsArray,
          });
          if (msg.tool_results) {
            for (const tr of msg.tool_results) {
              formattedMessages.push({
                role: 'tool' as const,
                tool_call_id: tr.id,
                content: tr.error ?? (tr.result !== null ? JSON.stringify(tr.result) : ''),
              });
            }
          }
        } else {
          const plainMsg = msg as Message;
          formattedMessages.push({
            role: plainMsg.role as 'user' | 'assistant' | 'system',
            content: plainMsg.content,
          });
        }
      }

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: formattedMessages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: openaiTools as unknown as OpenAI.Chat.ChatCompletionTool[],
        tool_choice: 'auto',
      });

      const responseMessage = response.choices[0]?.message;
      if (!responseMessage) {
        return { message: { role: 'assistant', content: 'Sin respuesta de OpenAI' } };
      }

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = responseMessage.tool_calls.map((tc) => {
          const fn = (tc as unknown as { function: { name: string; arguments: string } }).function;
          return {
            id: tc.id,
            name: fn.name,
            arguments: JSON.parse(fn.arguments),
          };
        });
        return {
          message: { role: 'assistant', content: responseMessage.content || '' },
          toolCalls,
        };
      }

      return {
        message: { role: 'assistant', content: responseMessage.content || '' },
      };
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
