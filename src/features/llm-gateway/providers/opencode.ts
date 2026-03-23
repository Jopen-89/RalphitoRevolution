import type { IVisionProvider, Provider, Message, QuotaInfo, VisionResult, IToolCallingProvider, ToolDefinition, ToolCallResult } from '../interfaces/gateway.types.js';

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string }>;
};

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
};

type AnthropicResponse = {
  error?: { type?: string; message?: string };
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  stop_reason?: string;
};

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io/anthropic';
const DEFAULT_MAX_TOKENS = 4096;

export class OpencodeProvider implements IVisionProvider, IToolCallingProvider {
  name: Provider = 'opencode';
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, model: string = 'minimax-m2.7') {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = (process.env.MINIMAX_BASE_URL || DEFAULT_MINIMAX_BASE_URL).replace(/\/$/, '');
  }

  async generateResponse(messages: Message[]): Promise<string> {
    const result = await this.generateResponseWithTools(messages, []);
    return result.text;
  }

  async generateResponseWithTools(messages: Message[], tools: ToolDefinition[]): Promise<ToolCallResult> {
    console.log(`[OpencodeProvider] Enrutando petición a ${this.model} con ${tools.length} tools...`);

    const { systemPrompt, conversation } = this.toAnthropicPayload(messages);
    const anthropicTools = this.toAnthropicTools(tools);

    try {
      const payload: any = {
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: conversation,
      };

      if (systemPrompt) payload.system = systemPrompt;
      if (anthropicTools.length > 0) payload.tools = anthropicTools;

      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
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

      let text = '';
      const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];

      for (const item of (data.content || [])) {
        if (item.type === 'text' && typeof item.text === 'string') {
          text += item.text + '\n';
        } else if (item.type === 'tool_use' && item.id && item.name && item.input) {
          toolCalls.push({
            id: item.id,
            name: item.name,
            arguments: item.input
          });
        }
      }

      return {
        text: text.trim(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };

    } catch (error) {
      console.error('[OpencodeProvider] Fallo al conectar con MiniMax:', error);
      throw error;
    }
  }

  private toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || [],
      },
    }));
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 100,
      totalLimit: 100,
      percentage: 100,
    };
  }

  async evaluateVisual(_screenshotBase64: string, route: string, _rubric: string): Promise<VisionResult> {
    return {
      status: 'warn',
      summary: `Provider ${this.name} (${this.model}) no soporta Vision evaluation.`,
      issues: [`provider_no_vision:${this.name}:${this.model}`],
    };
  }

  private toAnthropicPayload(messages: Message[]) {
    const systemParts: string[] = [];
    const conversation: AnthropicMessage[] = [];

    for (const message of messages) {
      const content = message.content.trim();

      if (message.role === 'system') {
        if (content) systemParts.push(content);
        continue;
      }

      if (message.role === 'tool') {
        conversation.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: message.toolCallId!, content: message.content }],
        });
        continue;
      }

      if (message.role === 'assistant') {
        const assistantContent: AnthropicMessage['content'] = [];
        if (content) assistantContent.push({ type: 'text', text: content });
        
        if (message.toolCalls) {
          for (const call of message.toolCalls) {
            assistantContent.push({ type: 'tool_use', id: call.id!, name: call.name, input: call.arguments as Record<string, unknown> });
          }
        }
        
        if (assistantContent.length > 0) {
          conversation.push({ role: 'assistant', content: assistantContent });
        }
        continue;
      }

      if (content) {
        conversation.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
        });
      }
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
