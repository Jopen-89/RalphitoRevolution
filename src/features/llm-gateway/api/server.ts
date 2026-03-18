import express from 'express';

import { MockProviderFactory } from '../interfaces/provider.mock.js';
import type { ChatRequest, ChatResponse } from '../interfaces/gateway.types.js';

const PORT = 3000;
const DEFAULT_MODEL = 'mock-model';

const app = express();

app.use(express.json());

app.post('/v1/chat', async (req, res) => {
  const { messages, model, provider, sessionId } = req.body as ChatRequest;

  if (!provider) {
    res.status(400).json({ error: 'Missing provider in request body' });
    return;
  }

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing messages array in request body' });
    return;
  }

  try {
    const llmProvider = MockProviderFactory.getProvider(provider);
    const response = await llmProvider.generateResponse(messages);

    const payload: ChatResponse = {
      response,
      providerUsed: provider,
      modelUsed: model ?? DEFAULT_MODEL,
      ...(sessionId ? { sessionId } : {}),
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate response',
    });
  }
});

app.listen(PORT, () => {
  console.log(`LLM Gateway listening on http://localhost:${PORT}`);
});
