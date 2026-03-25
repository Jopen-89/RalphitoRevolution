#!/usr/bin/env node

import chalk from 'chalk';
import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';

function printAgentList() {
  const agents = AgentRegistryService.getAllActive().sort((a, b) => a.agent_id.localeCompare(b.agent_id));

  if (agents.length === 0) {
    console.log(chalk.yellow('No hay agentes activos en agent_registry.'));
    return;
  }

  console.log(chalk.bold.magenta('Ralphito Gateway Dashboard (DB-first)'));
  console.log(chalk.gray('Configuracion resuelta desde SQLite\n'));

  for (const agent of agents) {
    const provider = agent.primary_provider || agent.provider || 'gemini';
    const model = agent.model || 'gemini-3.1-pro-preview';
    const toolMode = agent.tool_mode || 'none';
    const allowedTools = agent.allowed_tools_json ? JSON.parse(agent.allowed_tools_json) as string[] : [];
    const toolsLabel = toolMode === 'allowed' ? allowedTools.join(', ') || '(sin tools)' : '(tool calling desactivado)';

    console.log(`${chalk.cyan(agent.agent_id)} -> ${chalk.yellow(provider)} (${model})`);
    console.log(`  rules: ${agent.role_file_path || 'sin role file'}`);
    console.log(`  tool_mode: ${toolMode}`);
    console.log(`  tools: ${toolsLabel}`);
  }
}

function main() {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();
  printAgentList();
}

main();
