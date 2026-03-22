import { randomUUID } from 'crypto';
import type { Message, ToolDefinition, ToolCall, ToolResult } from '../interfaces/gateway.types.js';
import type { IToolCallingProvider } from '../interfaces/gateway.types.js';
import type { Tool } from './toolRegistry.js';

export interface ToolCallingLoopResult {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export async function executeToolCallLoop(
  messages: Message[],
  toolDefinitions: ToolDefinition[],
  toolImplementations: Tool[],
  provider: IToolCallingProvider,
  maxIterations = 5,
): Promise<ToolCallingLoopResult> {
  const toolMap = new Map(toolImplementations.map((t) => [t.name, t]));
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const { text, toolCalls: calls } = await provider.generateResponseWithTools(messages, toolDefinitions);

    if (!calls || calls.length === 0) {
      return { text, toolCalls: allToolCalls, toolResults: allToolResults };
    }

    for (const call of calls) {
      const toolId = call.id || randomUUID();
      const tool = toolMap.get(call.name);

      let result: ToolResult;
      if (!tool) {
        result = { toolCallId: toolId, content: `Tool not found: ${call.name}`, ok: false };
      } else {
        try {
          const execResult = await tool.execute(call.arguments);
          const content = typeof execResult === 'string' ? execResult : JSON.stringify(execResult);
          result = { toolCallId: toolId, content, ok: true };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result = { toolCallId: toolId, content: `Error: ${errorMessage}`, ok: false };
        }
      }

      messages.push({
        role: 'tool',
        toolCallId: toolId,
        content: result.content,
      } as Message);

      allToolResults.push(result);
    }

    allToolCalls.push(...calls);
  }

  throw new Error(
    `Límite de ${maxIterations} iteraciones de tool-calling alcanzado. ` +
      `Última llamada: ${JSON.stringify(allToolCalls[allToolCalls.length - 1])}.`,
  );
}
