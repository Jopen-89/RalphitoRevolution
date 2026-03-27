import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeLaunchCommand, buildRuntimeEnvironment } from './runtimeLaunch.js';

test('buildRuntimeLaunchCommand for opencode uses agent-loop', () => {
  const cmd = buildRuntimeLaunchCommand('opencode', null);
  
  assert.ok(cmd.includes('agent-loop'));
  assert.ok(cmd.includes('cli.ts'));
});

test('buildRuntimeLaunchCommand for codex is unchanged', () => {
  const cmd = buildRuntimeLaunchCommand('codex', null);
  
  assert.ok(cmd.includes('codex'));
  assert.ok(cmd.includes('--full-auto'));
});

test('buildRuntimeEnvironment does not include OPENAI vars', () => {
  const result = buildRuntimeEnvironment({
    runtimeSessionId: 'test-session',
    worktreePath: '/tmp/worktree',
    projectId: 'backend-team',
    systemPrompt: 'test system prompt',
    instruction: 'test instruction',
    provider: 'gemini',
    model: 'gemini-2.5-pro',
  }, {});
  
  assert.ok(!('OPENAI_API_BASE' in result));
  assert.ok(!('OPENAI_BASE_URL' in result));
  assert.ok(!('OPENAI_API_KEY' in result));
});

test('buildRuntimeEnvironment includes Ralphito vars', () => {
  const result = buildRuntimeEnvironment({
    runtimeSessionId: 'test-session',
    worktreePath: '/tmp/worktree',
    projectId: 'backend-team',
    systemPrompt: 'test system prompt',
    instruction: 'test instruction',
    provider: 'opencode',
    model: 'minimax-m2.7',
  }, {});
  
  assert.equal(result.RALPHITO_RUNTIME_SESSION_ID, 'test-session');
  assert.equal(result.RALPHITO_WORKTREE_PATH, '/tmp/worktree');
  assert.equal(result.RALPHITO_INSTRUCTION, 'test instruction');
  assert.equal(result.RALPHITO_PROJECT_ID, 'backend-team');
  assert.equal(result.RALPHITO_ENGINE_MANAGED, '1');
  assert.equal(result.RALPHITO_LLM_PROVIDER, 'opencode');
  assert.equal(result.RALPHITO_LLM_MODEL, 'minimax-m2.7');
  assert.equal(result.CI, '1');
});

test('buildRuntimeEnvironment includes provider profile when configured', () => {
  const result = buildRuntimeEnvironment({
    runtimeSessionId: 'test-session',
    worktreePath: '/tmp/worktree',
    projectId: 'backend-team',
    executionHarness: 'opencode',
    systemPrompt: 'test system prompt',
    instruction: 'test instruction',
    provider: 'codex',
    model: 'gpt-5.4',
    providerProfile: 'jopen',
  }, {});

  assert.equal(result.RALPHITO_LLM_PROVIDER_PROFILE, 'jopen');
});

test('buildRuntimeEnvironment injects codex execution profile env for codex harness', () => {
  const result = buildRuntimeEnvironment({
    runtimeSessionId: 'test-session',
    worktreePath: '/tmp/worktree',
    projectId: 'backend-team',
    executionHarness: 'codex',
    executionProfile: 'jopen',
    systemPrompt: 'test system prompt',
    instruction: 'test instruction',
    provider: 'openai',
    model: 'gpt-5.4',
  }, {
    CODEX_PROFILE_JOPEN_HOME: '/tmp/codex-home',
    CODEX_PROFILE_JOPEN_XDG_CONFIG_HOME: '/tmp/codex-config',
  });

  assert.equal(result.RALPHITO_EXECUTION_HARNESS, 'codex');
  assert.equal(result.RALPHITO_EXECUTION_PROFILE, 'jopen');
  assert.equal(result.HOME, '/tmp/codex-home');
  assert.equal(result.XDG_CONFIG_HOME, '/tmp/codex-config');
  assert.equal(result.RALPHITO_LLM_PROVIDER, 'openai');
});
