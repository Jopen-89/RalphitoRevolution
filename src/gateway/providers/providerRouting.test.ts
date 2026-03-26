import assert from 'node:assert/strict';
import test from 'node:test';
import { buildToolCallingUnsupportedMessage, splitToolCallingAttempts } from './providerRouting.js';

test('splitToolCallingAttempts keeps compatible fallbacks for tool-calling', () => {
  const result = splitToolCallingAttempts([
    { provider: 'codex', model: 'gpt-5.4' },
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  ]);

  assert.deepEqual(result.supported, [
    { provider: 'openai', model: 'gpt-5.4' },
    { provider: 'gemini', model: 'gemini-3.1-pro-preview' },
  ]);
  assert.deepEqual(result.unsupported, [
    { provider: 'codex', model: 'gpt-5.4' },
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
