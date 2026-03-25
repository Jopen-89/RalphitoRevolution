import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDER_MATRIX, getProviderCatalogStatus } from './providerCatalog.js';

test('provider catalog defines official support matrix', () => {
  assert.deepEqual(PROVIDER_MATRIX.gemini.officialModels, ['gemini-3.1-pro-preview', 'gemini-3']);
  assert.deepEqual(PROVIDER_MATRIX.openai.officialModels, ['gpt-5.4']);
  assert.deepEqual(PROVIDER_MATRIX.opencode.officialModels, ['minimax-m2.7']);
  assert.deepEqual(PROVIDER_MATRIX.codex.officialModels, ['gpt-5.4']);
  assert.equal(PROVIDER_MATRIX.codex.toolCalling, false);
  assert.equal(PROVIDER_MATRIX.openai.toolCalling, true);
});

test('provider catalog status exposes readiness and routing metadata', () => {
  const providers = getProviderCatalogStatus({
    googleAuthClient: {},
    openAiKey: 'test-openai',
    minimaxKey: 'test-minimax',
  });

  const byId = Object.fromEntries(providers.map((provider) => [provider.provider, provider]));
  assert.ok(byId.gemini);
  assert.ok(byId.openai);
  assert.ok(byId.opencode);
  assert.ok(byId.codex);
  assert.equal(byId.gemini.readiness.authenticated, true);
  assert.equal(byId.openai.readiness.available, true);
  assert.equal(byId.opencode.readiness.available, true);
  assert.equal(typeof byId.codex.routingRecommendation, 'string');
});
