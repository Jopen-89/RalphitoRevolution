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
  getQuotaStatus?(): Promise<QuotaInfo>;
}
