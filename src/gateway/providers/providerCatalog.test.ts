import assert from 'node:assert/strict';
import test from 'node:test';
import { PROVIDER_MATRIX, buildProviderCapabilityHealth, getProviderCatalogStatus } from './providerCatalog.js';

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
  assert.equal(byId.gemini.readiness.available, true);
  assert.equal(byId.gemini.readiness.bootstrappable, false);
  assert.equal(byId.openai.readiness.available, true);
  assert.equal(byId.opencode.readiness.available, true);
  assert.equal(typeof byId.codex.routingRecommendation, 'string');
});

test('gemini readiness only reports available with active runtime auth client', () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  process.env.GOOGLE_CLIENT_ID = 'test-google-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

  try {
    const providers = getProviderCatalogStatus({});
    const byId = Object.fromEntries(providers.map((provider) => [provider.provider, provider]));
    const gemini = byId.gemini;

    assert.ok(gemini);
    assert.equal(gemini.readiness.configured, true);
    assert.equal(gemini.readiness.authenticated, false);
    assert.equal(gemini.readiness.available, false);
    assert.equal(typeof gemini.readiness.bootstrappable, 'boolean');
    assert.match(gemini.readiness.checks.join(','), /google_auth_client:missing/);
  } finally {
    if (previousClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = previousClientId;
    }

    if (previousClientSecret === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET;
    } else {
      process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  }
});

test('provider capability health summarizes available and degraded providers', () => {
  const health = buildProviderCapabilityHealth({
    openAiKey: 'test-openai',
  });

  assert.ok(health.chat.availableProviders.includes('openai'));
  assert.deepEqual(health.toolCalling.availableProviders, ['openai']);
  assert.deepEqual(health.vision.availableProviders, ['openai']);
  assert.ok(health.chat.degradedProviders.includes('gemini'));
  assert.ok(health.chat.degradedProviders.includes('opencode'));
  assert.equal(health.toolCalling.ok, true);
});
