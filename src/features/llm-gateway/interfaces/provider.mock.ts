import type { ILLMProvider, Provider } from './gateway.types.js';

export class MockProvider implements ILLMProvider {
  constructor(public name: Provider) {}

  async generateResponse(prompt: string): Promise<string> {
    return Promise.resolve(`[MOCK ${this.name}] Respond to: ${prompt}`);
  }
}

export class MockProviderFactory {
  static getProvider(name: Provider): ILLMProvider {
    return new MockProvider(name);
  }
}
