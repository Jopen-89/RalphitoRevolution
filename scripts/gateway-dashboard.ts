#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prompts from 'prompts';
import chalk from 'chalk';
import * as yaml from 'yaml';
import type { GatewayConfig, AgentConfig, Provider } from '../src/features/llm-gateway/interfaces/gateway.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'features', 'llm-gateway', 'gateway.config.json');
const AO_YAML_PATH = path.join(__dirname, '..', 'ops', 'agent-orchestrator.yaml');

// Mapeos entre el mundo del Gateway (Providers) y el mundo de AO (Agents)
const GATEWAY_TO_AO: Record<Provider, string> = {
  openai: 'codex',
  gemini: 'opencode',
  opencode: 'opencode',
  codex: 'codex'
};

const AO_TO_GATEWAY: Record<string, Provider> = {
  codex: 'openai',
  opencode: 'gemini',
  'claude-code': 'openai' // Fallback visual
};

// Cargar configuración de Gateway
const loadConfig = (): GatewayConfig => {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red('❌ Error al cargar configuración Gateway:'), error);
    return { agents: [] };
  }
};

// Cargar configuración de AO (Ralphitos/Coders)
const loadAOConfig = () => {
  try {
    const data = fs.readFileSync(AO_YAML_PATH, 'utf8');
    return yaml.parse(data) || {};
  } catch (error) {
    console.error(chalk.red('❌ Error al cargar agent-orchestrator.yaml:'), error);
    return { projects: {} };
  }
};

// Guardar configuración Gateway
const saveConfig = (config: GatewayConfig) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(chalk.green('\n✅ Configuración del Gateway guardada correctamente.'));
  } catch (error) {
    console.error(chalk.red('❌ Error al guardar configuración Gateway:'), error);
  }
};

// Guardar configuración AO
const saveAOConfig = (aoConfig: any) => {
  try {
    const yamlStr = yaml.stringify(aoConfig);
    fs.writeFileSync(AO_YAML_PATH, yamlStr);
    console.log(chalk.green('\n✅ Configuración de los Ralphitos (AO) guardada correctamente.'));
  } catch (error) {
    console.error(chalk.red('❌ Error al guardar agent-orchestrator.yaml:'), error);
  }
};

const PROVIDERS: Provider[] = ['gemini', 'openai', 'opencode', 'codex'];
const MODELS: Record<Provider, string[]> = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-pro', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  openai: ['chatgpt-5.4', 'gpt-5.4', 'gpt-5.3', 'codex', 'gpt-5.2', 'gpt-4o'],
  opencode: ['minimax-m2.7', 'minimax-m2.5', 'minimax-text-01'],
  codex: ['codex-latest']
};

async function mainMenu() {
  console.clear();
  console.log(chalk.bold.magenta('🤖 Ralphito Gateway & Factory - TUI Dashboard'));
  console.log(chalk.gray('================================================\n'));

  const config = loadConfig();
  const aoConfig = loadAOConfig();

  const response = await prompts({
    type: 'select',
    name: 'action',
    message: '¿Qué quieres hacer?',
    choices: [
      { title: 'Listar Agentes y Ralphitos (Coders)', value: 'list' },
      { title: 'Editar Agente o Ralphito', value: 'edit' },
      { title: 'Añadir Agente (Telegram)', value: 'add' },
      { title: 'Eliminar Agente (Telegram)', value: 'delete' },
      { title: 'Salir', value: 'exit' }
    ]
  });

  switch (response.action) {
    case 'list':
      listAgents(config, aoConfig);
      break;
    case 'edit':
      await editAgentOrCoder(config, aoConfig);
      break;
    case 'add':
      await addAgent(config);
      break;
    case 'delete':
      await deleteAgent(config);
      break;
    case 'exit':
      process.exit(0);
  }
}

function listAgents(config: GatewayConfig, aoConfig: any) {
  console.log(chalk.cyan('\n📋 Agentes del Bot (Telegram):'));
  config.agents.forEach(agent => {
    console.log(`  ${chalk.bold(agent.agentId)}: ${chalk.yellow(agent.primaryProvider)} (${agent.model})`);
    if (agent.fallbacks && agent.fallbacks.length > 0) {
      console.log(chalk.dim(`    └─ Fallbacks: ${agent.fallbacks.map(f => `${f.provider}(${f.model})`).join(' -> ')}`));
    }
  });

  console.log(chalk.magenta('\n👷 Ralphitos / Coders (Fábrica AO):'));
  if (aoConfig.projects) {
    for (const [projectId, projectData] of Object.entries<any>(aoConfig.projects)) {
      const aoAgent = projectData.agent || aoConfig.defaults?.agent || 'unknown';
      const model = projectData.agentConfig?.model || aoConfig.defaults?.agentConfig?.model || 'default';
      console.log(`  ${chalk.bold(projectId)}: Motor ${chalk.yellow(aoAgent)} (${model})`);
    }
  } else {
    console.log(chalk.gray('  No hay proyectos definidos en el YAML.'));
  }

  console.log('\nPresiona cualquier tecla para volver...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once('data', () => {
    process.stdin.setRawMode(false);
    mainMenu();
  });
}

async function editAgentOrCoder(config: GatewayConfig, aoConfig: any) {
  const choices = [];
  
  // Añadir agentes del Gateway
  config.agents.forEach(a => {
    choices.push({ title: `[Telegram] ${a.agentId}`, value: `gw:${a.agentId}` });
  });

  // Añadir proyectos (Ralphitos) de AO
  if (aoConfig.projects) {
    for (const projectId of Object.keys(aoConfig.projects)) {
      choices.push({ title: `[Ralphito] ${projectId}`, value: `ao:${projectId}` });
    }
  }

  if (choices.length === 0) {
    console.log(chalk.red('\nNo hay agentes ni Ralphitos para editar.'));
    return setTimeout(mainMenu, 2000);
  }

  const { selection } = await prompts({
    type: 'select',
    name: 'selection',
    message: 'Selecciona la identidad a configurar:',
    choices
  });

  if (!selection) return mainMenu();

  const [type, id] = selection.split(':');

  if (type === 'gw') {
    // Editar agente de Telegram (Lógica original)
    const agentIndex = config.agents.findIndex(a => a.agentId === id);
    const agent = config.agents[agentIndex];

    const { primaryProvider } = await prompts({
      type: 'select',
      name: 'primaryProvider',
      message: 'Proveedor Primario:',
      choices: PROVIDERS.map(p => ({ title: p, value: p })),
      initial: PROVIDERS.indexOf(agent.primaryProvider) !== -1 ? PROVIDERS.indexOf(agent.primaryProvider) : 0
    });

    const { model } = await prompts({
      type: 'select',
      name: 'model',
      message: 'Modelo:',
      choices: MODELS[primaryProvider as Provider].map(m => ({ title: m, value: m })),
      initial: MODELS[primaryProvider as Provider].indexOf(agent.model) !== -1 ? MODELS[primaryProvider as Provider].indexOf(agent.model) : 0
    });

    const { manageFallbacks } = await prompts({
      type: 'confirm',
      name: 'manageFallbacks',
      message: '¿Quieres gestionar los fallbacks?',
      initial: false
    });

    let fallbacks = agent.fallbacks || [];
    if (manageFallbacks) {
      fallbacks = [];
      let addMore = true;
      while (addMore) {
        const { provider } = await prompts({
          type: 'select',
          name: 'provider',
          message: `Añadir fallback ${fallbacks.length + 1}:`,
          choices: PROVIDERS.map(p => ({ title: p, value: p }))
        });
        
        const { fbModel } = await prompts({
          type: 'select',
          name: 'fbModel',
          message: 'Modelo fallback:',
          choices: MODELS[provider as Provider].map(m => ({ title: m, value: m }))
        });

        fallbacks.push({ provider, model: fbModel });

        const { more } = await prompts({
          type: 'confirm',
          name: 'more',
          message: '¿Añadir otro fallback?',
          initial: false
        });
        addMore = more;
      }
    }

    config.agents[agentIndex] = { agentId: id, primaryProvider, model, fallbacks };
    saveConfig(config);

  } else if (type === 'ao') {
    // Editar Ralphito (Coder) en agent-orchestrator.yaml
    const projectData = aoConfig.projects[id];
    const currentAoAgent = projectData.agent || aoConfig.defaults?.agent || 'opencode';
    const currentGatewayProvider = AO_TO_GATEWAY[currentAoAgent] || 'gemini';

    console.log(chalk.cyan(`\nConfigurando el Ralphito (Fábrica): ${chalk.bold(id)}`));
    console.log(chalk.gray('Nota: Los Ralphitos no soportan fallbacks, usan un único modelo robusto.\n'));

    const { primaryProvider } = await prompts({
      type: 'select',
      name: 'primaryProvider',
      message: 'Ecosistema del Motor:',
      choices: PROVIDERS.map(p => ({ title: p, value: p })),
      initial: PROVIDERS.indexOf(currentGatewayProvider) !== -1 ? PROVIDERS.indexOf(currentGatewayProvider) : 0
    });

    const currentModel = projectData.agentConfig?.model || aoConfig.defaults?.agentConfig?.model || '';
    const { model } = await prompts({
      type: 'select',
      name: 'model',
      message: 'Modelo específico:',
      choices: MODELS[primaryProvider as Provider].map(m => ({ title: m, value: m })),
      initial: MODELS[primaryProvider as Provider].indexOf(currentModel) !== -1 ? MODELS[primaryProvider as Provider].indexOf(currentModel) : 0
    });

    // Mapear la elección del usuario de vuelta a la terminología de AO
    const aoAgentTarget = GATEWAY_TO_AO[primaryProvider as Provider] || 'opencode';

    // Actualizar el objeto YAML en memoria
    if (!aoConfig.projects[id].agentConfig) {
      aoConfig.projects[id].agentConfig = {};
    }
    aoConfig.projects[id].agent = aoAgentTarget;
    aoConfig.projects[id].agentConfig.model = model;

    saveAOConfig(aoConfig);
  }

  setTimeout(mainMenu, 1500);
}

// ... Las funciones addAgent y deleteAgent se mantienen igual para los agentes del Gateway ...
async function addAgent(config: GatewayConfig) {
  const { agentId } = await prompts({
    type: 'text',
    name: 'agentId',
    message: 'ID del nuevo Agente (Telegram):'
  });

  if (!agentId) return mainMenu();

  const { primaryProvider } = await prompts({
    type: 'select',
    name: 'primaryProvider',
    message: 'Proveedor Primario:',
    choices: PROVIDERS.map(p => ({ title: p, value: p }))
  });

  const { model } = await prompts({
    type: 'select',
    name: 'model',
    message: 'Modelo:',
    choices: MODELS[primaryProvider as Provider].map(m => ({ title: m, value: m }))
  });

  const { manageFallbacks } = await prompts({
    type: 'confirm',
    name: 'manageFallbacks',
    message: '¿Quieres configurar fallbacks ahora?',
    initial: false
  });

  let fallbacks: {provider: Provider, model: string}[] = [];
  if (manageFallbacks) {
    let addMore = true;
    while (addMore) {
      const { provider } = await prompts({
        type: 'select',
        name: 'provider',
        message: `Añadir fallback ${fallbacks.length + 1}:`,
        choices: PROVIDERS.map(p => ({ title: p, value: p }))
      });
      
      const { fbModel } = await prompts({
        type: 'select',
        name: 'fbModel',
        message: 'Modelo fallback:',
        choices: MODELS[provider as Provider].map(m => ({ title: m, value: m }))
      });

      fallbacks.push({ provider, model: fbModel });

      const { more } = await prompts({
        type: 'confirm',
        name: 'more',
        message: '¿Añadir otro fallback?',
        initial: false
      });
      addMore = more;
    }
  }

  config.agents.push({ agentId, primaryProvider, model, fallbacks });
  saveConfig(config);
  setTimeout(mainMenu, 1500);
}

async function deleteAgent(config: GatewayConfig) {
  const { agentId } = await prompts({
    type: 'select',
    name: 'agentId',
    message: 'Eliminar agente (solo Telegram):',
    choices: config.agents.map(a => ({ title: a.agentId, value: a.agentId }))
  });

  if (agentId) {
    config.agents = config.agents.filter(a => a.agentId !== agentId);
    saveConfig(config);
  }
  setTimeout(mainMenu, 1500);
}

mainMenu();
