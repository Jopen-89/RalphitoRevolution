import type { AgentConfig, ToolDefinition } from '../interfaces/gateway.types.js';
import { createDocumentToolDefinitions, createDocumentTools } from './documentTools.js';
import { createRaymonToolDefinitions, createRaymonTools } from './raymonTools.js';
import { createSystemToolDefinitions, createSystemTools } from './systemTools.js';
import { createResearchToolDefinitions, createResearchTools } from './researchTools.js';
import type { Tool } from './toolRegistry.js';

interface ToolCatalogContext {
  originThreadId?: number;
  notificationChatId?: string;
  worktreePath?: string;
}

export function createAllToolDefinitions(): ToolDefinition[] {
  return [
    ...createRaymonToolDefinitions(),
    ...createDocumentToolDefinitions(),
    ...createSystemToolDefinitions(),
    ...createResearchToolDefinitions(),
  ];
}

export function createAllToolImplementations(context: ToolCatalogContext = {}): Tool[] {
  return [
    ...createRaymonTools(context),
    ...createDocumentTools(context.worktreePath),
    ...createSystemTools(context.worktreePath),
    ...createResearchTools(),
  ];
}

export function resolveAllowedToolDefinitions(agentConfig: AgentConfig | undefined): {
  allowed: ToolDefinition[];
  unknownNames: string[];
} {
  if (!agentConfig || agentConfig.toolMode !== 'allowed') {
    return { allowed: [], unknownNames: [] };
  }

  const definitionsByName = new Map(createAllToolDefinitions().map((definition) => [definition.name, definition]));
  const allowed: ToolDefinition[] = [];
  const unknownNames: string[] = [];

  for (const name of agentConfig.allowedTools || []) {
    const definition = definitionsByName.get(name);
    if (!definition) {
      unknownNames.push(name);
      continue;
    }
    allowed.push(definition);
  }

  return { allowed, unknownNames };
}
