import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDashboardPage } from './dashboardPage.js';

test('renderDashboardPage includes agents operational panel', () => {
  const html = renderDashboardPage();

  assert.match(html, /Agentes/);
  assert.match(html, /id="agent-list"/);
  assert.match(html, /fetch\('\/api\/agents'\)/);
  assert.match(html, /providerProfile/);
  assert.match(html, /fallbacks:/);
});
