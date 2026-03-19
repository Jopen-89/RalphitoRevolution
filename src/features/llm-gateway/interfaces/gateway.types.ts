export type Provider = 'gemini' | 'openai' | 'opencode' | 'codex';

export interface Message {
  role: string;
  content: string;
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
  tools?: {
    allowed?: string[];
    blocked?: string[];
  };
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

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  enum?: string[];
  items?: ToolParameter;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result: unknown;
  error?: string;
}

export interface ToolCallMessage {
  role: 'user' | 'assistant';
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

export interface ILLMToolProvider {
  name: Provider;
  generateResponseWithTools(
    messages: (Message | ToolCallMessage)[],
    tools: ToolDefinition[]
  ): Promise<{ message: Message | ToolCallMessage; toolCalls?: ToolCall[] }>;
  getQuotaStatus?(): Promise<QuotaInfo>;
}

export interface ILLMProvider {
  name: Provider;
  generateResponse(messages: Message[]): Promise<string>;
  getQuotaStatus?(): Promise<QuotaInfo>;
}
