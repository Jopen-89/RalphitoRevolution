import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve, sep } from 'path';
import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../interfaces/gateway.types.js';

const execAsync = promisify(exec);

function validatePathTraversal(path: string, worktreePath: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  const resolved = resolve(worktreePath, normalized);
  return resolved.startsWith(resolve(worktreePath) + sep);
}

function validateCommand(command: string): void {
  const normalized = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();
  if (lower.includes('cd ') && !lower.match(/^\s*cd\s+$/)) {
    throw new Error('Path traversal detected: cd command not allowed');
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Parameter '${name}' must be a non-empty string.`);
  }
  return value;
}

function requireWorktreePath(worktreePath: string | undefined): string {
  if (!worktreePath || typeof worktreePath !== 'string' || !worktreePath.trim()) {
    throw new Error(`worktreePath is required for system tools.`);
  }
  return worktreePath;
}

export async function executeBash(
  command: string,
  worktreePath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = requireWorktreePath(worktreePath);
  validateCommand(command);
  const { stdout, stderr } = await execAsync(command, { cwd, timeout: 600000 });
  return { stdout, stderr, exitCode: 0 };
}

export async function readFileRaw(
  filePath: string,
  worktreePath: string,
): Promise<{ content: string; bytesRead: number }> {
  const cwd = requireWorktreePath(worktreePath);
  if (!validatePathTraversal(filePath, cwd)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  const fullPath = join(cwd, filePath);
  const content = await readFile(fullPath, 'utf-8');
  return { content, bytesRead: Buffer.byteLength(content, 'utf-8') };
}

export async function writeFileRaw(
  filePath: string,
  content: string,
  worktreePath: string,
): Promise<{ bytesWritten: number; path: string }> {
  const cwd = requireWorktreePath(worktreePath);
  if (!validatePathTraversal(filePath, cwd)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  const fullPath = join(cwd, filePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf(sep));
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
  return { bytesWritten: Buffer.byteLength(content, 'utf-8'), path: fullPath };
}

export async function finishTask(worktreePath: string): Promise<{
  success: boolean;
  message: string;
  commitHash?: string;
}> {
  const cwd = requireWorktreePath(worktreePath);

  try {
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd });

    if (!statusOutput.trim()) {
      return { success: true, message: 'No changes to commit. Worktree is clean.' };
    }

    await execAsync('git add .', { cwd });
    const { stdout: commitOutput } = await execAsync(
      'git commit -m "feat: task completion"',
      { cwd },
    );

    const commitHash = commitOutput.match(/\[([a-f0-9]+)\]/)?.[1];

    const result: { success: boolean; message: string; commitHash?: string } = {
      success: true,
      message: `Changes committed successfully.`,
    };
    if (commitHash) result.commitHash = commitHash;

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during finish_task';
    return { success: false, message: `finish_task failed: ${message}` };
  }
}

export function createSystemTools(worktreePath?: string): Tool[] {
  const effectiveWorktree = worktreePath;

  return [
    {
      name: 'execute_bash',
      description:
        'Executes a bash command in the worktree directory. Use this to run npm, git, or other shell commands.',
      execute: async (params: Record<string, unknown>) => {
        const command = requireString(params.command, 'command');
        if (!effectiveWorktree) {
          throw new Error('worktreePath is required for execute_bash');
        }
        return executeBash(command, effectiveWorktree);
      },
    },
    {
      name: 'read_file_raw',
      description: 'Reads a file from the worktree. Rejects path traversal attempts.',
      execute: async (params: Record<string, unknown>) => {
        const filePath = requireString(params.path, 'path');
        if (!effectiveWorktree) {
          throw new Error('worktreePath is required for read_file_raw');
        }
        return readFileRaw(filePath, effectiveWorktree);
      },
    },
    {
      name: 'write_file_raw',
      description: 'Writes content to a file in the worktree. Creates directories if needed. Rejects path traversal.',
      execute: async (params: Record<string, unknown>) => {
        const filePath = requireString(params.path, 'path');
        const content = requireString(params.content, 'content');
        if (!effectiveWorktree) {
          throw new Error('worktreePath is required for write_file_raw');
        }
        return writeFileRaw(filePath, content, effectiveWorktree);
      },
    },
    {
      name: 'finish_task',
      description:
        'Marks the task as complete. Commits any uncommitted changes to git. Use when the implementation is verified and done.',
      execute: async () => {
        if (!effectiveWorktree) {
          throw new Error('worktreePath is required for finish_task');
        }
        return finishTask(effectiveWorktree);
      },
    },
  ];
}

export function createSystemToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'execute_bash',
      description:
        'Executes a bash command in the worktree directory. Use this to run npm, git, or other shell commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_file_raw',
      description: 'Reads a file from the worktree. Rejects path traversal attempts.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file within the worktree',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file_raw',
      description:
        'Writes content to a file in the worktree. Creates directories if needed. Rejects path traversal.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the file within the worktree',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'finish_task',
      description:
        'Marks the task as complete. Commits any uncommitted changes to git. Use when the implementation is verified and done.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ];
}
