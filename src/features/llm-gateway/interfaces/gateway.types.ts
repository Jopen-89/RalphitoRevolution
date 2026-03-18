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

export interface ILLMProvider {
  name: Provider;
  generateResponse(messages: Message[]): Promise<string>;
  getQuotaStatus?(): Promise<QuotaInfo>;
}
