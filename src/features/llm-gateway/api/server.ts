import express from 'express';

import type { ChatRequest, ChatResponse, Message, Provider } from '../interfaces/gateway.types.js';
import { MockProviderFactory } from '../interfaces/provider.mock.js';

type ChatRequestBody = ChatRequest & {
  prompt?: string;
};

const PORT = 3000;
const app = express();
const supportedProviders: Provider[] = ['gemini', 'openai', 'opencode', 'codex'];

app.use(express.json());

app.post('/v1/chat', async (req, res) => {
  const { provider, prompt, messages } = req.body as ChatRequestBody;

  if (!provider) {
    res.status(400).json({ error: 'Missing provider in request body' });
    return;
  }

  if (!supportedProviders.includes(provider)) {
    res.status(400).json({ error: `Unsupported provider: ${provider}` });
    return;
  }

  const normalizedMessages: Message[] = typeof prompt === 'string' && prompt.trim().length > 0
    ? [{ role: 'user', content: prompt.trim() }]
    : Array.isArray(messages)
      ? messages
      : [];

  if (normalizedMessages.length === 0) {
    res.status(400).json({ error: 'Missing prompt or messages in request body' });
    return;
  }

  try {
    const providerClient = MockProviderFactory.getProvider(provider);
    const response = await providerClient.generateResponse(normalizedMessages);

    const payload: ChatResponse = {
      response,
      providerUsed: provider,
      modelUsed: 'mock',
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected gateway error' });
  }
});

app.listen(PORT, () => {
  console.log(`LLM Gateway listening on http://localhost:${PORT}`);
});
