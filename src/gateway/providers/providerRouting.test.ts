import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolCallingUnsupportedMessage, splitToolCallingAttempts } from './providerRouting.js';

test('splitToolCallingAttempts reroutes codex to openai and keeps compatible fallbacks', () => {
  const result = splitToolCallingAttempts([
    { provider: 'codex', model: 'gpt-5.4' },
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  ]);

  assert.deepEqual(result.supported, [
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  ]);
  assert.deepEqual(result.unsupported, []);
  assert.deepEqual(result.rerouted, [
    {
      from: { provider: 'codex', model: 'gpt-5.4' },
      to: { provider: 'openai', model: 'gpt-5.4' },
      reason: 'codex_requires_openai_tool_calling',
    },
  ]);
});

test('buildToolCallingUnsupportedMessage summarizes unsupported providers', () => {
  assert.equal(
    buildToolCallingUnsupportedMessage([
      { provider: 'codex', model: 'gpt-5.4' },
    ]),
    'Provider codex no soporta tool-calling. Usa OpenAI, Gemini o Opencode.',
  );

  assert.equal(
    buildToolCallingUnsupportedMessage([
      { provider: 'codex', model: 'gpt-5.4' },
      { provider: 'codex', model: 'gpt-5.4' },
    ]),
    'Provider codex no soporta tool-calling. Usa OpenAI, Gemini o Opencode.',
  );
});

test('buildToolCallingUnsupportedMessage handles empty provider list', () => {
  assert.equal(
    buildToolCallingUnsupportedMessage([]),
    'No hay providers configurados con soporte de tool-calling.',
  );
});
