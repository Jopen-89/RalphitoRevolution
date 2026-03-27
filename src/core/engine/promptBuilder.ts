import { readFileSync } from 'fs';
import path from 'path';
import type { EngineProjectConfig } from './config.js';

const BASE_ENGINE_PROMPT = `You are an AI agent managed by Ralphito Engine.

## Session Contract
- You run inside a dedicated git worktree and session.
- Use the current branch created for this runtime session.
- Use the \`finish_task\` tool as the only landing action.
- \`finish_task\` requests landing; the session only closes after the session loop verifies the landed git state.
- If guardrails fail, you will receive a structured resume prompt. Fix the issue and continue from the same worktree.
- You operate in a headless runtime. Never launch servers, watchers, \`tail -f\`, interactive prompts, or commands that do not terminate.
- Stay scoped to the assigned task.

## Core Tool Rules
- Use the provided tools for all system interaction.
- Do NOT output shell commands, tool names, or markdown code blocks instead of invoking a tool.
- NEVER leave the worktree directory.
- NEVER use cd to navigate outside the worktree.
- All file operations are sandboxed to the worktree.
- Always run commands in the worktree directory (already set as CWD).
- Verify git status before finalizing.
- If a command fails, diagnose the issue and try alternative approaches.

## Validation Playbook
- If the task is a short validation or proof task, create the smallest deterministic artifact that satisfies the acceptance criteria.
- Do not stop at terminal output or "report success"; leave a verifiable artifact inside the allowed write scope.
- If the task validates engine/runtime behavior rather than product behavior, prefer touching non-product files only.
- For short validation or proof tasks, use this landing sequence exactly:
  1. edit or create the artifact
  2. use \`git_add\` with the touched files
  3. use \`git_commit\` with a concise message
  4. use the \`finish_task\` tool`;

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

export function buildEnginePrompt(
  project: EngineProjectConfig,
  userPrompt: string,
  branchName: string,
  beadContent?: string,
) {
  const rules = readProjectRules(project);
  const systemSections = [];

  if (beadContent) {
    systemSections.push(
      [
        '## BEAD IMPLEMENTATION TASK',
        beadContent,
        '---',
        "Tu misión es implementar estrictamente la Bead adjunta. Solo puedes editar los archivos listados en TARGET_FILES. Cuando termines y el código sea estable, DEBES llamar a la herramienta `submit_for_review` para cerrar la tarea.",
      ].join('\n\n'),
    );
  }

  if (rules) {
    systemSections.push(rules);
  } else {
    systemSections.push("You are Ralphito, a senior software engineer agent. You work inside a secure sandbox (worktree) and must complete tasks by implementing them directly.");
  }

  systemSections.push(BASE_ENGINE_PROMPT);
  systemSections.push(
    [
      '## Runtime Context',
      `- Project: ${project.name}`,
      `- Repository path: ${project.path}`,
      `- Default branch: ${project.defaultBranch}`,
      `- Working branch: ${branchName}`,
    ].join('\n')
  );

  return {
    systemPrompt: systemSections.join('\n\n'),
    userTask: userPrompt,
  };
}
