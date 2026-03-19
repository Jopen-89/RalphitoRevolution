export type Provider = 'gemini' | 'openai' | 'opencode' | 'codex';

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type ToolSchemaProperty = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  items?: ToolSchemaProperty;
};

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  content: string;
}

export interface ToolContext {
  agentId: string;
  sessionId?: string;
}

export interface ToolExecutionEntry {
  toolCallId: string;
  toolName: string;
  ok: boolean;
}

export type LLMResponse =
  | {
      type: 'final';
      text: string;
    }
  | {
      type: 'tool_calls';
      toolCalls: ToolCall[];
    };

export interface ToolCapabilityOptions {
  tools: ToolDefinition[];
}

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
}

export interface ChatRequest {
  agentId?: string;
  provider?: Provider;
  model?: string;
  sessionId?: string;
  messages: Message[];
}

export interface ChatResponse {
  response: string;
  providerUsed: Provider;
  modelUsed: string;
  sessionId?: string;
}

export interface AgentConfig {
  agentId: string;
  primaryProvider: Provider;
  model: string;
  fallbacks: {
    provider: Provider;
    model: string;
  }[];
}

export interface GatewayConfig {
  agents: AgentConfig[];
}

export interface QuotaInfo {
  provider: Provider;
  remainingMessages: number;
  totalLimit: number;
  percentage: number; // 0 to 100
  resetTime?: string;
}

export interface VisionMessagePart {
  type: 'text';
  text: string;
}

export interface VisionImagePart {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type VisionMessageContent = VisionMessagePart | VisionImagePart;

export interface VisionMessage {
  role: string;
  content: VisionMessageContent[];
}

export interface VisionResult {
  status: 'pass' | 'fail' | 'warn';
  summary: string;
  issues: string[];
  rawModelOutput?: string;
}

export interface IVisionProvider {
  name: Provider;
  model: string;
  evaluateVisual(screenshotBase64: string, route: string, rubric: string): Promise<VisionResult>;
  getQuotaStatus?(): Promise<QuotaInfo>;
}

export interface ILLMProvider {
  name: Provider;
  generateResponse(messages: Message[]): Promise<string>;
  generateResponseWithTools?(messages: Message[], options: ToolCapabilityOptions): Promise<LLMResponse>;
  getQuotaStatus?(): Promise<QuotaInfo>;
}
