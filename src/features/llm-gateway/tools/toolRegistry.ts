import { writeEvidenceTool } from './telegram-demo/index.js';

export interface Tool {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  content: string;
  metadata?: Record<string, unknown>;
  ok: boolean;
}

const tools: Tool[] = [
  {
    name: 'writeEvidence',
    description: 'Write evidence content to a timestamped file in docs/automation/evidence/',
    execute: async (params: Record<string, unknown>) => {
      const content = params.content as string;
      return writeEvidenceTool(content);
    },
  },
];

export function getTools(): Tool[] {
  return tools;
}

export function getToolByName(name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}

export async function executeToolCall(toolCall: ToolCall): Promise<ToolCallResult> {
  const tool = getToolByName(toolCall.name);

  if (!tool) {
    return {
      content: `Tool not found: ${toolCall.name}`,
      ok: false,
    };
  }

  try {
    const result = await tool.execute(toolCall.arguments);
    const metadata = isRecord(result) ? result : undefined;

    return {
      content: typeof result === 'string' ? result : JSON.stringify(result),
      ...(metadata ? { metadata } : {}),
      ok: true,
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : 'Unknown tool execution failure',
      ok: false,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
