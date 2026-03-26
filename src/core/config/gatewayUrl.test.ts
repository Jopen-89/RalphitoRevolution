import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGatewayChatUrl, resolveGatewayHealthUrl, validateGatewayRuntimeConfig } from './gatewayUrl.js';

test('resolveGatewayChatUrl derives chat URL from PORT by default', () => {
  assert.equal(resolveGatewayChatUrl({ PORT: '4010' }), 'http://127.0.0.1:4010/v1/chat');
});

test('resolveGatewayHealthUrl derives health URL from chat URL', () => {
  assert.equal(
    resolveGatewayHealthUrl({ RALPHITO_GATEWAY_URL: 'http://127.0.0.1:4010/v1/chat' }),
    'http://127.0.0.1:4010/health',
  );
});

test('validateGatewayRuntimeConfig rejects mismatched port and gateway URL', () => {
  assert.throws(
    () => validateGatewayRuntimeConfig({ PORT: '3007', RALPHITO_GATEWAY_URL: 'http://127.0.0.1:3006/v1/chat' }),
    /PORT=3007 no coincide/,
  );
});

test('validateGatewayRuntimeConfig rejects mismatched chat and health origins', () => {
  assert.throws(
    () => validateGatewayRuntimeConfig({
      RALPHITO_GATEWAY_URL: 'http://127.0.0.1:3006/v1/chat',
      RALPHITO_GATEWAY_HEALTH_URL: 'http://127.0.0.1:3007/health',
    }),
    /deben compartir origen/,
  );
});

test('validateGatewayRuntimeConfig accepts aligned runtime config', () => {
  assert.doesNotThrow(() => validateGatewayRuntimeConfig({
    PORT: '3006',
    RALPHITO_GATEWAY_URL: 'http://127.0.0.1:3006/v1/chat',
    RALPHITO_GATEWAY_HEALTH_URL: 'http://127.0.0.1:3006/health',
  }));
});
