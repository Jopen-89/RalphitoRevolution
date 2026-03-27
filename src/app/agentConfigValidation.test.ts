import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentConfigApiMetadata,
  validateAllowedTools,
  validateExecutionHarness,
  validateFallbacks,
  validateProviderModel,
  validateProviderProfile,
} from './agentConfigValidation.js';

test('buildAgentConfigApiMetadata exposes provider and tool metadata', () => {
  const meta = buildAgentConfigApiMetadata();

  assert.ok(meta.providers.includes('gemini'));
  assert.ok(meta.executionHarnesses.includes('opencode'));
  assert.ok(meta.toolModes.includes('allowed'));
  assert.ok(meta.toolNames.includes('inspect_workspace_path'));
  assert.ok(Array.isArray(meta.providerModels.codex));
});

test('validateExecutionHarness rejects unknown harnesses', () => {
  const error = validateExecutionHarness('llama.cpp' as never);

  assert.equal(error?.field, 'executionHarness');
  assert.match(error?.error || '', /unknown executionHarness/i);
});

test('validateProviderModel rejects models outside provider catalog', () => {
  const error = validateProviderModel('gemini', 'gpt-5.4');

  assert.equal(error?.field, 'model');
  assert.match(error?.error || '', /not supported/i);
});

test('validateProviderProfile rejects non-codex profiles', () => {
  const error = validateProviderProfile('gemini', 'jopen');

  assert.equal(error?.field, 'providerProfile');
  assert.match(error?.error || '', /does not support/i);
});

test('validateAllowedTools rejects raymon-only tools for specialists', () => {
  const error = validateAllowedTools('poncho', ['summon_agent_to_chat']);

  assert.equal(error?.field, 'allowedTools');
  assert.match(error?.error || '', /reserved for Raymon/i);
});

test('validateFallbacks rejects invalid fallback provider profile combos', () => {
  const error = validateFallbacks([{ provider: 'openai', model: 'gpt-5.4', providerProfile: 'jopen' }]);

  assert.equal(error?.field, 'fallbacks');
  assert.match(error?.error || '', /does not support/i);
});
