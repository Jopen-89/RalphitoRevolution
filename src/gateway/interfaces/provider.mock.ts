import type { ILLMProvider, Provider, Message } from './gateway.types.js';

export class MockProvider implements ILLMProvider {
  constructor(public name: Provider) {}

  async generateResponse(messages: Message[]): Promise<string> {
    const lastMessage = messages[messages.length - 1]?.content || '';
    return Promise.resolve(`[MOCK ${this.name}] Respond to: ${lastMessage}`);
  }
}

export class MockProviderFactory {
  static getProvider(name: Provider): ILLMProvider {
    return new MockProvider(name);
  }
}
