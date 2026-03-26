import assert from 'node:assert/strict';
import test from 'node:test';
import { createRaymonTools } from './raymonTools.js';

function getSummonTool(currentAgentId?: string) {
  const tool = createRaymonTools(currentAgentId ? { currentAgentId } : {}).find(
    (entry) => entry.name === 'summon_agent_to_chat',
  );

  assert.ok(tool, 'summon_agent_to_chat tool missing');
  return tool;
}

test('summon_agent_to_chat rejects non-Raymon callers at runtime', async () => {
  const tool = getSummonTool('poncho');

  await assert.rejects(
    () => tool.execute({ agentName: 'lola' }),
    /solo puede ser usada por Raymon.*poncho/i,
  );
});

test('summon_agent_to_chat allows Raymon caller to pass runtime guard', async () => {
  const tool = getSummonTool('raymon');

  await assert.rejects(
    () => tool.execute({ agentName: 'agente-inexistente' }),
    /No conozco al agente 'agente-inexistente'/,
  );
});
