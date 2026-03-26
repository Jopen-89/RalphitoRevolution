import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCriticalProviderSmokeTargets, decideProviderSmokeTarget } from './providerSmoke.js';

test('buildCriticalProviderSmokeTargets covers critical providers and capabilities', () => {
  const targets = buildCriticalProviderSmokeTargets();

  assert.deepEqual(targets, [
    { provider: 'gemini', model: 'gemini-3.1-pro-preview', capability: 'chat' },
    { provider: 'gemini', model: 'gemini-3.1-pro-preview', capability: 'tool-calling' },
    { provider: 'openai', model: 'gpt-5.4', capability: 'chat' },
    { provider: 'openai', model: 'gpt-5.4', capability: 'tool-calling' },
    { provider: 'opencode', model: 'minimax-m2.7', capability: 'chat' },
    { provider: 'opencode', model: 'minimax-m2.7', capability: 'tool-calling' },
    { provider: 'codex', model: 'gpt-5.4', capability: 'chat' },
  ]);
});

test('decideProviderSmokeTarget skips unavailable providers with reason', () => {
  const decision = decideProviderSmokeTarget(
    { provider: 'gemini', model: 'gemini-3.1-pro-preview', capability: 'tool-calling' },
    {
      provider: 'gemini',
      officialModels: ['gemini-3.1-pro-preview'],
      readiness: { available: false, checks: ['google_auth_client:missing'] },
      chat: true,
      toolCalling: true,
      vision: true,
    },
  );

  assert.deepEqual(decision, { run: false, reason: 'google_auth_client:missing' });
});

test('decideProviderSmokeTarget runs when capability is available', () => {
  const decision = decideProviderSmokeTarget(
    { provider: 'openai', model: 'gpt-5.4', capability: 'tool-calling' },
    {
      provider: 'openai',
      officialModels: ['gpt-5.4'],
      readiness: { available: true, checks: ['OPENAI_API_KEY:set'] },
      chat: true,
      toolCalling: true,
      vision: true,
    },
  );

  assert.deepEqual(decision, { run: true });
});
