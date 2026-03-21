import { readFileSync } from 'fs';
import path from 'path';
import type { EngineProjectConfig } from './config.js';

const BASE_ENGINE_PROMPT = `You are an AI coding agent managed by Ralphito Engine.

## Session Contract
- You run inside a dedicated git worktree and session.
- Use the current branch created for this runtime session.
- Use \`bd sync\` as the only landing command.
- If guardrails fail, you will receive a structured resume prompt. Fix the issue and continue from the same worktree.
- Stay scoped to the assigned task.`;

function readProjectRules(project: EngineProjectConfig) {
  if (!project.agentRulesFile) return null;

  try {
    const rulesPath = path.resolve(project.path, project.agentRulesFile);
    const content = readFileSync(rulesPath, 'utf8').trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

export function buildEnginePrompt(project: EngineProjectConfig, userPrompt: string, branchName: string) {
  const rules = readProjectRules(project);
  const sections = [
    BASE_ENGINE_PROMPT,
    [
      '## Runtime Context',
      `- Project: ${project.name}`,
      `- Repository path: ${project.path}`,
      `- Base branch: ${project.defaultBranch}`,
      `- Working branch: ${branchName}`,
    ].join('\n'),
  ];

  if (rules) {
    sections.push(`## Project Rules\n${rules}`);
  }

  sections.push(`## Task\n${userPrompt}`);
  return sections.join('\n\n');
}
