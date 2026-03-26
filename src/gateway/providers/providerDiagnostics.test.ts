import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttemptDiagnostic, formatAttemptSummary, toDiagnosticErrorMessage } from './providerDiagnostics.js';

test('toDiagnosticErrorMessage extracts message from Error', () => {
  assert.equal(toDiagnosticErrorMessage(new Error('boom')), 'boom');
});

test('createAttemptDiagnostic captures provider, model and capability', () => {
  assert.deepEqual(
    createAttemptDiagnostic('openai', 'gpt-5.4', 'chat', new Error('missing key')),
    {
      provider: 'openai',
      model: 'gpt-5.4',
      capability: 'chat',
      success: false,
      reason: 'missing key',
    },
  );
});

test('formatAttemptSummary composes compact fallback trace', () => {
  assert.equal(
    formatAttemptSummary([
      createAttemptDiagnostic('codex', 'gpt-5.4', 'tool-calling', new Error('tool-calling unsupported')),
      createAttemptDiagnostic('openai', 'gpt-5.4', 'tool-calling', new Error('missing OPENAI_API_KEY')),
    ]),
    'codex/gpt-5.4 [tool-calling]: tool-calling unsupported | openai/gpt-5.4 [tool-calling]: missing OPENAI_API_KEY',
  );
});
