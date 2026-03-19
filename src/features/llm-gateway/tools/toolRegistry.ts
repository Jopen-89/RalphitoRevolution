import { writeEvidenceTool } from './telegram-demo';

export interface Tool {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

const tools: Tool[] = [
  {
    name: 'writeEvidence',
    description: 'Write evidence content to a timestamped file in docs/automation/evidence/',
    execute: async (params: Record<string, unknown>) => {
      const content = params.content as string;
      return writeEvidenceTool(content);
    },
  },
];

export function getTools(): Tool[] {
  return tools;
}

export function getToolByName(name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}