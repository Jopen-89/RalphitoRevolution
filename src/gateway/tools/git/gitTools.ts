import type { ToolDefinition } from '../../../core/domain/gateway.types.js';
import { requireString, requireStringArray } from '../filesystem/pathSafety.js';
import type { Tool } from '../toolRegistry.js';
import { GitService } from './gitService.js';

export function createGitTools(worktreePath?: string): Tool[] {
  const git = worktreePath ? new GitService(worktreePath) : null;

  function requireGitService() {
    if (!git) {
      throw new Error('worktreePath is required for git tools');
    }

    return git;
  }

  return [
    {
      name: 'git_status',
      description: 'Returns staged, unstaged, untracked, and branch git status for the current worktree.',
      execute: async () => requireGitService().status(),
    },
    {
      name: 'git_diff',
      description: 'Returns git diff output for the current worktree. Use cached=true for staged diff.',
      execute: async (params: Record<string, unknown>) => {
        const cached = params.cached === true;
        return {
          diff: await requireGitService().diff({ cached }),
          cached,
        };
      },
    },
    {
      name: 'git_add',
      description: 'Stages one or more worktree-relative file paths with native git handling.',
      execute: async (params: Record<string, unknown>) => {
        const paths = requireStringArray(params.paths, 'paths');
        return requireGitService().add(paths);
      },
    },
    {
      name: 'git_commit',
      description: 'Creates a git commit from already staged changes using the provided message.',
      execute: async (params: Record<string, unknown>) => {
        const message = requireString(params.message, 'message');
        return requireGitService().commit(message);
      },
    },
  ];
}

export function createGitToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'git_status',
      description: 'Inspect branch state plus staged, unstaged, and untracked files in the worktree.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'git_diff',
      description: 'Read the git diff for the worktree.',
      parameters: {
        type: 'object',
        properties: {
          cached: {
            type: 'boolean',
            description: 'When true, returns the staged diff instead of unstaged diff.',
          },
        },
      },
    },
    {
      name: 'git_add',
      description: 'Stage files inside the current worktree.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            description: 'Relative worktree paths to stage.',
            items: {
              type: 'string',
              description: 'Relative path inside the current worktree.',
            },
          },
        },
        required: ['paths'],
      },
    },
    {
      name: 'git_commit',
      description: 'Create a commit from staged changes.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Commit message to use for the staged changes.',
          },
        },
        required: ['message'],
      },
    },
  ];
}
