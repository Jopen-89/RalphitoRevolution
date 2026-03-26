#!/usr/bin/env node

import chalk from 'chalk';
import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import { getProviderCatalogStatus } from '../gateway/providers/providerCatalog.js';
import { listConfiguredCodexProfiles } from '../gateway/providers/providerProfiles.js';
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
    const providerProfile = agent.provider_profile || '(default)';
    const toolMode = agent.tool_mode || 'none';
    const allowedTools = agent.allowed_tools_json ? JSON.parse(agent.allowed_tools_json) as string[] : [];
    const toolsLabel = toolMode === 'allowed' ? allowedTools.join(', ') || '(sin tools)' : '(tool calling desactivado)';

    console.log(`${chalk.cyan(agent.agent_id)} -> ${chalk.yellow(provider)} (${model})`);
    console.log(`  provider_profile: ${providerProfile}`);
    console.log(`  rules: ${agent.role_file_path || 'sin role file'}`);
    console.log(`  tool_mode: ${toolMode}`);
    console.log(`  tools: ${toolsLabel}`);
  }
}

function printProviderStatus() {
  const providers = getProviderCatalogStatus({});
  const codexProfiles = listConfiguredCodexProfiles(process.env);

  console.log(`\n${chalk.bold.cyan('Provider readiness')}`);
  for (const provider of providers) {
    const ready = provider.readiness.available
      ? chalk.green('ready')
      : provider.readiness.bootstrappable
        ? chalk.yellow('bootstrappable')
        : chalk.yellow('degraded');
    console.log(`${chalk.cyan(provider.provider)} -> ${ready} | auth=${provider.authMode} | models=${provider.officialModels.join(', ')}`);
    console.log(`  capabilities: chat=${provider.chat} tools=${provider.toolCalling} vision=${provider.vision}`);
    console.log(`  checks: ${provider.readiness.checks.join(', ')}`);
  }

  console.log(`\n${chalk.bold.cyan('Codex profiles')}`);
  console.log(codexProfiles.length > 0 ? `  ${codexProfiles.join(', ')}` : '  (sin perfiles configurados)');
}

function main() {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();
  printAgentList();
  printProviderStatus();
}

main();
