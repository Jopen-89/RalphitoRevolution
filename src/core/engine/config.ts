import { ProjectService } from '../services/ProjectService.js';

export { ProjectService, type EngineProjectConfig } from '../services/ProjectService.js';

export function resolveEngineProjectConfig(agentId: string) {
  return ProjectService.resolve(agentId);
}
