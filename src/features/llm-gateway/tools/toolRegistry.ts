import type { ToolDefinition, ToolCall, ToolResult } from '../interfaces/gateway.types.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts', 'tools');

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'write_project_file',
    description: 'Write content to a file in the project directory. Use for creating or updating project documents like PRD, specs, or beads.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from project root (e.g., docs/specs/projects/my-project/feature.md)',
          required: true,
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
          required: true,
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_project_file',
    description: 'Read the content of a file from the project directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from repository root',
          required: true,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_project_files',
    description: 'List files in a project directory matching a pattern.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project key (e.g., telegram-live-final)',
          required: true,
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., bead-*.md)',
          required: false,
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'google_web_search',
    description: 'Perform a web search using Google.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
          required: true,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'spawn_executors_from_beads',
    description: 'Spawn Ralphito executor sessions from bead specifications.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project key (e.g., backend-team)',
          required: true,
        },
        beads: {
          type: 'array',
          description: 'Array of bead paths to execute',
          items: { type: 'string', description: 'Bead path', required: true },
          required: false,
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'check_executor_status',
    description: 'Check the status of Ralphito executor sessions.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

const ALLOWED_ROOTS = [
  'docs/specs/projects',
  'docs/specs/meta',
  'src/features',
];

function isPathAllowed(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return ALLOWED_ROOTS.some((root) => normalized.startsWith(root));
}

function execScript(scriptPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { id, name, arguments: args } = call;

  try {
    switch (name) {
      case 'write_project_file': {
        const filePath = args.path as string;
        if (!isPathAllowed(filePath)) {
          return { id, result: null, error: `Path "${filePath}" is not allowed. Must be under: ${ALLOWED_ROOTS.join(', ')}` };
        }
        const fullPath = path.join(REPO_ROOT, filePath);
        const dir = path.dirname(fullPath);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(fullPath, args.content as string, 'utf8');
        return { id, result: { success: true, path: filePath } };
      }

      case 'read_project_file': {
        const filePath = args.path as string;
        if (!isPathAllowed(filePath) && !filePath.includes('scripts/tools')) {
          return { id, result: null, error: `Path "${filePath}" is not allowed` };
        }
        const fullPath = path.join(REPO_ROOT, filePath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        return { id, result: { content } };
      }

      case 'list_project_files': {
        const project = args.project as string;
        const pattern = (args.pattern as string) || '*.md';
        const searchPath = path.join(REPO_ROOT, 'docs', 'specs', 'projects', project);
        const files: string[] = [];

        async function walkDir(dir: string) {
          try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                await walkDir(fullPath);
              } else if (entry.name.match(pattern.replace('*', '.*'))) {
                files.push(fullPath.replace(REPO_ROOT + '/', ''));
              }
            }
          } catch {
            // ignore permission errors
          }
        }

        await walkDir(searchPath);
        return { id, result: { files, count: files.length } };
      }

      case 'google_web_search': {
        const query = encodeURIComponent(args.query as string);
        return { id, result: { query: args.query, url: `https://www.google.com/search?q=${query}` } };
      }

      case 'spawn_executors_from_beads': {
        const project = args.project as string;
        const beads = (args.beads as string[]) || [];
        if (beads.length === 0) {
          return { id, result: null, error: 'No beads specified to spawn' };
        }
        const results: { bead: string; status: string }[] = [];
        for (const bead of beads) {
          try {
            await execScript(path.join(SCRIPTS_DIR, 'tool_spawn_executor.sh'), [project, bead]);
            results.push({ bead, status: 'spawned' });
          } catch (err) {
            results.push({ bead, status: `error: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        return { id, result: { spawned: results } };
      }

      case 'check_executor_status': {
        const output = await execScript(path.join(SCRIPTS_DIR, 'tool_check_status.sh'), []);
        return { id, result: { status: output } };
      }

      default:
        return { id, result: null, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { id, result: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getToolsByName(names: string[]): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((t) => names.includes(t.name));
}

export function filterAllowedTools(allowed?: string[], blocked?: string[]): ToolDefinition[] {
  let tools = [...TOOL_DEFINITIONS];
  if (allowed && allowed.length > 0) {
    tools = tools.filter((t) => allowed.includes(t.name));
  }
  if (blocked && blocked.length > 0) {
    tools = tools.filter((t) => !blocked.includes(t.name));
  }
  return tools;
}