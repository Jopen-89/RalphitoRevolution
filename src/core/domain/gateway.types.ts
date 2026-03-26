export type Provider = 'gemini' | 'openai' | 'opencode' | 'codex';

export interface ToolResultPayload {
  output?: unknown;
  error?: unknown;
}

export interface Message {
  role: string;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  toolResult?: ToolResultPayload;
}

export interface ToolSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  properties?: Record<string, ToolSchemaProperty>;
  items?: ToolSchemaProperty;
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolSchemaProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
  metadata?: unknown;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  ok: boolean;
  payload?: ToolResultPayload;
}

export interface ToolMessage {
  role: 'tool';
  toolCallId: string;
  content: string;
}

export interface ChatRequest {
  agentId?: string;
  provider?: Provider;
  model?: string;
  providerProfile?: string;
  sessionId?: string;
  originChatId?: string;
  originThreadId?: number;
  messages: Message[];
}

export interface ChatResponse {
  response: string;
  providerUsed: Provider;
  modelUsed: string;
  sessionId?: string;
  handoffAgentId?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export type ToolMode = 'none' | 'allowed';

export interface AgentFallbackRoute {
  provider: Provider;
  model: string;
  providerProfile?: string;
}

export interface AgentConfig {
  agentId: string;
  primaryProvider: Provider;
  model: string;
  providerProfile?: string;
  fallbacks: AgentFallbackRoute[];
  toolMode?: ToolMode;
  allowedTools?: string[];
}

export interface ModelConfig {
  provider: Provider;
  max_tokens?: number;
  temperature?: number;
}

export interface GatewayConfig {
  agents: AgentConfig[];
  models?: Record<string, ModelConfig>;
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
  getQuotaStatus?(): Promise<QuotaInfo>;
}

export interface IToolCallingProvider extends ILLMProvider {
  generateResponseWithTools(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
}
