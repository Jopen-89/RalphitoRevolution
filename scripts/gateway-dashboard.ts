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
const ENGINE_CONFIG_PATH = path.join(__dirname, '..', 'ops', 'agent-orchestrator.yaml');

// Mapeos entre providers del Gateway y agentes del engine.
const GATEWAY_TO_ENGINE_AGENT: Record<Provider, string> = {
  openai: 'codex',
  gemini: 'opencode',
  opencode: 'opencode',
  codex: 'codex'
};

const ENGINE_AGENT_TO_GATEWAY: Record<string, Provider> = {
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

// Cargar configuración del engine.
const loadEngineConfig = () => {
  try {
    const data = fs.readFileSync(ENGINE_CONFIG_PATH, 'utf8');
    return yaml.parse(data) || {};
  } catch (error) {
    console.error(chalk.red('❌ Error al cargar la config del engine:'), error);
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

// Guardar configuración del engine.
const saveEngineConfig = (engineConfig: any) => {
  try {
    const yamlStr = yaml.stringify(engineConfig);
    fs.writeFileSync(ENGINE_CONFIG_PATH, yamlStr);
    console.log(chalk.green('\n✅ Configuración del engine guardada correctamente.'));
  } catch (error) {
    console.error(chalk.red('❌ Error al guardar la config del engine:'), error);
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
  console.log(chalk.bold.magenta('🤖 Ralphito Gateway & Engine - TUI Dashboard'));
  console.log(chalk.gray('================================================\n'));

  const config = loadConfig();
  const engineConfig = loadEngineConfig();

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
      listAgents(config, engineConfig);
      break;
    case 'edit':
      await editAgentOrCoder(config, engineConfig);
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

function listAgents(config: GatewayConfig, engineConfig: any) {
  console.log(chalk.cyan('\n📋 Agentes del Bot (Telegram):'));
  config.agents.forEach(agent => {
    console.log(`  ${chalk.bold(agent.agentId)}: ${chalk.yellow(agent.primaryProvider)} (${agent.model})`);
    if (agent.fallbacks && agent.fallbacks.length > 0) {
      console.log(chalk.dim(`    └─ Fallbacks: ${agent.fallbacks.map(f => `${f.provider}(${f.model})`).join(' -> ')}`));
    }
  });

  console.log(chalk.magenta('\n👷 Ralphitos / Coders (Engine):'));
  if (engineConfig.projects) {
    for (const [projectId, projectData] of Object.entries<any>(engineConfig.projects)) {
      const engineAgent = projectData.agent || engineConfig.defaults?.agent || 'unknown';
      const provider = projectData.agentConfig?.provider || engineConfig.defaults?.agentConfig?.provider || 'default';
      const model = projectData.agentConfig?.model || engineConfig.defaults?.agentConfig?.model || 'default';
      console.log(`  ${chalk.bold(projectId)}: Motor ${chalk.yellow(engineAgent)} -> ${chalk.yellow(provider)} (${model})`);
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

async function editAgentOrCoder(config: GatewayConfig, engineConfig: any) {
  const choices = [];
  
  // Añadir agentes del Gateway
  config.agents.forEach(a => {
    choices.push({ title: `[Telegram] ${a.agentId}`, value: `gw:${a.agentId}` });
  });

  // Añadir proyectos del engine
  if (engineConfig.projects) {
    for (const projectId of Object.keys(engineConfig.projects)) {
      choices.push({ title: `[Ralphito] ${projectId}`, value: `engine:${projectId}` });
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

  } else if (type === 'engine') {
    // Editar Ralphito (Coder) en la config del engine
    const projectData = engineConfig.projects[id];
    const currentEngineAgent = projectData.agent || engineConfig.defaults?.agent || 'opencode';
    const currentGatewayProvider =
      projectData.agentConfig?.provider ||
      engineConfig.defaults?.agentConfig?.provider ||
      ENGINE_AGENT_TO_GATEWAY[currentEngineAgent] ||
      'gemini';

    console.log(chalk.cyan(`\nConfigurando el Ralphito (Fábrica): ${chalk.bold(id)}`));
    console.log(chalk.gray('Nota: Los Ralphitos no soportan fallbacks, usan un único modelo robusto.\n'));

    const { primaryProvider } = await prompts({
      type: 'select',
      name: 'primaryProvider',
      message: 'Ecosistema del Motor:',
      choices: PROVIDERS.map(p => ({ title: p, value: p })),
      initial: PROVIDERS.indexOf(currentGatewayProvider) !== -1 ? PROVIDERS.indexOf(currentGatewayProvider) : 0
    });

    const currentModel = projectData.agentConfig?.model || engineConfig.defaults?.agentConfig?.model || '';
    const { model } = await prompts({
      type: 'select',
      name: 'model',
      message: 'Modelo específico:',
      choices: MODELS[primaryProvider as Provider].map(m => ({ title: m, value: m })),
      initial: MODELS[primaryProvider as Provider].indexOf(currentModel) !== -1 ? MODELS[primaryProvider as Provider].indexOf(currentModel) : 0
    });

    // Mapear la elección del usuario al agente del engine.
    const engineAgentTarget = GATEWAY_TO_ENGINE_AGENT[primaryProvider as Provider] || 'opencode';

    // Actualizar el objeto YAML en memoria
    if (!engineConfig.projects[id].agentConfig) {
      engineConfig.projects[id].agentConfig = {};
    }
    engineConfig.projects[id].agent = engineAgentTarget;
    engineConfig.projects[id].agentConfig.provider = primaryProvider;
    engineConfig.projects[id].agentConfig.model = model;

    saveEngineConfig(engineConfig);
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
