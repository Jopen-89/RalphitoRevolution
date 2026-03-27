#!/usr/bin/env node

import chalk from 'chalk';
import dotenv from 'dotenv';
import { AgentRegistryService } from '../core/services/AgentRegistry.js';
import { authenticateGoogle } from '../gateway/auth/google-oauth.js';
import { getProviderCatalogStatus } from '../gateway/providers/providerCatalog.js';
import { listConfiguredCodexProfiles } from '../gateway/providers/providerProfiles.js';
import { initializeRalphitoDatabase } from '../infrastructure/persistence/db/index.js';

dotenv.config();

function readEnvValue(name: string) {
  const value = process.env[name];
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim() || null;
  }

  return trimmed;
}

async function buildProviderAuth() {
  let googleAuthClient: unknown;

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    try {
      googleAuthClient = await authenticateGoogle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(chalk.yellow(`⚠️ No pude validar Google OAuth para el dashboard: ${message}`));
    }
  }

  return {
    ...(googleAuthClient ? { googleAuthClient } : {}),
    ...(readEnvValue('OPENAI_API_KEY') ? { openAiKey: readEnvValue('OPENAI_API_KEY')! } : {}),
    ...(readEnvValue('MINIMAX_API_KEY') ? { minimaxKey: readEnvValue('MINIMAX_API_KEY')! } : {}),
  };
}

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
    const executionHarness = agent.execution_harness || 'opencode';
    const toolMode = agent.tool_calling_mode || agent.tool_mode || 'none';
    const allowedTools = agent.allowed_tools_json ? JSON.parse(agent.allowed_tools_json) as string[] : [];
    const toolsLabel = toolMode === 'allowed' ? allowedTools.join(', ') || '(sin tools)' : '(tool calling desactivado)';

    console.log(`${chalk.cyan(agent.agent_id)} -> ${chalk.yellow(provider)} (${model})`);
    console.log(`  execution_harness: ${executionHarness}`);
    console.log(`  provider_profile: ${providerProfile}`);
    console.log(`  rules: ${agent.role_file_path || 'sin role file'}`);
    console.log(`  tool_calling_mode: ${toolMode}`);
    console.log(`  tools: ${toolsLabel}`);
  }
}

function printProviderStatus(auth: Awaited<ReturnType<typeof buildProviderAuth>>) {
  const providers = getProviderCatalogStatus(auth);
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

async function main() {
  initializeRalphitoDatabase();
  AgentRegistryService.sync();
  const auth = await buildProviderAuth();
  printAgentList();
  printProviderStatus(auth);
}

void main();
