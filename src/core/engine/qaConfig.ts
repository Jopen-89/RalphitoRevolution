export type VisualProviderType = 'gemini' | 'openai' | 'opencode' | 'codex';

export interface QAViewportConfig {
  width: number;
  height: number;
}

export interface QASelectorSet {
  user?: string;
  password?: string;
  submit?: string;
}

export interface QAConfig {
  enableVisualQa?: boolean;
  shadowMode?: boolean;
  enableE2eQa?: boolean;
  e2eShadowMode?: boolean;
  devServerCommand?: string;
  baseUrl?: string;
  healthcheckUrl?: string;
  visualRoutes?: string[];
  e2eRoutes?: string[];
  formRoutes?: string[];
  e2eProfile?: string;
  designRuleset?: string;
  evidencePath?: string;
  waitForSelector?: string;
  waitForMs?: number;
  viewport?: QAViewportConfig;
  requiredSelectors?: string[];
  loginRoute?: string;
  loginSelectors?: QASelectorSet;
  visualProvider?: {
    provider: VisualProviderType;
    model: string;
  };
  visualProviderFallbacks?: {
    provider: VisualProviderType;
    model: string;
  }[];
}
