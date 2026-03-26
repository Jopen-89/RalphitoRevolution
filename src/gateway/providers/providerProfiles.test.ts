import assert from 'node:assert/strict';
import test from 'node:test';
import { listConfiguredCodexProfiles, resolveCodexProfileConfig } from './providerProfiles.js';
import { ProviderFactory } from './provider.factory.js';

test('resolveCodexProfileConfig builds env from profile-specific variables', () => {
  const config = resolveCodexProfileConfig('jopen', {
    CODEX_PROFILE_JOPEN_HOME: '/tmp/codex-jopen-home',
    CODEX_PROFILE_JOPEN_OPENCODE_HOME: '/tmp/codex-jopen-opencode',
    CODEX_PROFILE_JOPEN_ENV_JSON: JSON.stringify({ CUSTOM_TOKEN: 'abc123' }),
  });

  assert.deepEqual(config, {
    profile: 'jopen',
    env: {
      OPENCODE_PROFILE: 'jopen',
      HOME: '/tmp/codex-jopen-home',
      OPENCODE_HOME: '/tmp/codex-jopen-opencode',
      CUSTOM_TOKEN: 'abc123',
    },
  });
});

test('ProviderFactory wires codex provider profile into CodexProvider', () => {
  const provider = ProviderFactory.create('codex', 'gpt-5.4', {}, 'martapa');

  assert.equal(provider.name, 'codex');
  assert.equal((provider as { providerProfile?: string }).providerProfile, 'martapa');
});

test('listConfiguredCodexProfiles discovers configured profile prefixes', () => {
  const profiles = listConfiguredCodexProfiles({
    CODEX_PROFILE_JOPEN_HOME: '/tmp/jopen',
    CODEX_PROFILE_MARTAPA_ENV_JSON: '{"CUSTOM_TOKEN":"1"}',
    UNRELATED: 'value',
  });

  assert.deepEqual(profiles, ['jopen', 'martapa']);
});
