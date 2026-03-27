import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDashboardPage } from './dashboardPage.js';

test('renderDashboardPage includes agents operational panel', () => {
  const html = renderDashboardPage();

  assert.match(html, /Agentes/);
  assert.match(html, /id="agent-list"/);
  assert.match(html, /fetch\('\/api\/agents'\)/);
  assert.match(html, /providerProfile/);
  assert.match(html, /executionHarness/);
  assert.match(html, /executionProfile/);
  assert.match(html, /fallbacks:/);
  assert.match(html, /data-agent-action="save"/);
  assert.match(html, /fetch\('\/api\/agents\/' \+ encodeURIComponent\(agentId\)/);
  assert.match(html, /Allowed Tools/);
  assert.match(html, /sesiones nuevas/i);
});
