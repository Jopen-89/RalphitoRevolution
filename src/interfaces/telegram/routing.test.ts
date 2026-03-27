import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentInfo } from './agentRegistry.js';
import { resolveTelegramRouting } from './routing.js';

const AGENTS: AgentInfo[] = [
  {
    id: 'raymon',
    name: 'Raymon',
    role: 'Project Planner',
    rolePath: 'roles/ProjectPlanner(Raymon).md',
    aliases: ['raymon'],
  },
  {
    id: 'poncho',
    name: 'Poncho',
    role: 'Technical Architect',
    rolePath: 'roles/TechnicalArchitect(Poncho).md',
    aliases: ['poncho'],
  },
  {
    id: 'lola',
    name: 'Lola',
    role: 'Designer',
    rolePath: 'roles/Designer(Lola).md',
    aliases: ['lola'],
  },
];

test('routea a agente de reply cuando existe', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'te respondo por aqui',
    replyAgentId: 'poncho',
    activeAgentId: 'raymon',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'poncho');
  assert.equal(decision.reason, 'reply');
});

test('routea a agente activo reciente cuando el activo es Raymon', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'seguimos con esto',
    activeAgentId: 'raymon',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'active-agent');
});

test('mencion explicita a Raymon rompe el agente activo y vuelve a Raymon', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'raymon, convoca a poncho',
    activeAgentId: 'poncho',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'explicit-raymon');
});

test('mencion explicita a Raymon funciona con nombre pelado', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'raymon',
    activeAgentId: 'poncho',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'explicit-raymon');
});

test('mencion explicita a Raymon funciona con interrogacion', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'raymon?',
    activeAgentId: 'poncho',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'explicit-raymon');
});

test('vuelve a Raymon cuando no hay reply ni agente activo', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'hola equipo',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'raymon-entry');
});

test('devuelve control a Raymon cuando el activo reciente es especialista y no hay reply', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'seguimos',
    activeAgentId: 'poncho',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'specialist-handback');
});

test('mencion libre a especialista no hace bypass y entra por Raymon', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'Poncho, ayudame con la arquitectura',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'raymon-entry');
});

test('si el agente activo expiro o no existe, vuelve a Raymon', () => {
  const decision = resolveTelegramRouting({
    agents: AGENTS,
    text: 'retomemos esto',
    activeAgentId: 'agente-inexistente',
  });

  assert.ok(decision);
  assert.equal(decision.agent.id, 'raymon');
  assert.equal(decision.reason, 'raymon-entry');
});
