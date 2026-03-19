import { execFile } from 'child_process';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import type { OAuth2Client } from 'google-auth-library';
import { runSpawnExecutor } from '../../ao/spawnExecutorClient.js';
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from '../interfaces/gateway.types.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../../');
const ALLOWED_WRITE_ROOTS = [
  path.join(REPO_ROOT, 'docs', 'specs', 'projects'),
  path.join(REPO_ROOT, 'docs', 'specs', 'meta', 'research'),
];
const ALLOWED_LIST_ROOT = path.join(REPO_ROOT, 'docs', 'specs');
const DEFAULT_EXECUTOR_PROJECT = 'backend-team';
const MAX_TOOL_ITERATIONS = 6;

export const TOOL_POLICIES: Record<string, string[]> = {
  moncho: ['write_project_file', 'read_project_file'],
  poncho: ['write_project_file', 'read_project_file', 'list_project_files'],
  martapepis: ['write_project_file', 'read_project_file', 'google_web_search'],
  lola: ['write_project_file', 'read_project_file'],
  raymon: ['read_project_file', 'list_project_files', 'spawn_executors_from_beads', 'check_executor_status'],
};

type ToolHandler = (input: Record<string, unknown>, context: ToolContext) => Promise<ToolExecutionResult>;

type ToolRecord = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

type SearchGroundingChunk = {
  web?: {
    uri?: string;
    title?: string;
  };
};

type SearchGroundingMetadata = {
  groundingChunks?: SearchGroundingChunk[];
};

type GeminiSearchResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    groundingMetadata?: SearchGroundingMetadata;
  }>;
};

export class ToolRegistry {
  private readonly tools: Map<string, ToolRecord>;
  private readonly googleAuthClient: OAuth2Client | null;

  constructor(googleAuthClient: OAuth2Client | null) {
    this.googleAuthClient = googleAuthClient;
    this.tools = new Map([
      [
        'write_project_file',
        {
          definition: {
            name: 'write_project_file',
            description: 'Write a UTF-8 project file inside docs/specs/projects or docs/specs/meta/research.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Workspace-relative file path to write.' },
                content: { type: 'string', description: 'Full UTF-8 file contents to persist.' },
              },
              required: ['path', 'content'],
            },
          },
          handler: async (input) => this.writeProjectFile(input),
        },
      ],
      [
        'read_project_file',
        {
          definition: {
            name: 'read_project_file',
            description: 'Read a UTF-8 project file from docs/specs or related project outputs.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Workspace-relative file path to read.' },
              },
              required: ['path'],
            },
          },
          handler: async (input) => this.readProjectFile(input),
        },
      ],
      [
        'list_project_files',
        {
          definition: {
            name: 'list_project_files',
            description: 'List files below docs/specs so agents can discover real PRDs, specs, and beads.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Optional workspace-relative directory to inspect.' },
              },
            },
          },
          handler: async (input) => this.listProjectFiles(input),
        },
      ],
      [
        'google_web_search',
        {
          definition: {
            name: 'google_web_search',
            description: 'Run a grounded Google web search via Gemini Search and return cited findings.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query in natural language.' },
              },
              required: ['query'],
            },
          },
          handler: async (input) => this.googleWebSearch(input),
        },
      ],
      [
        'spawn_executors_from_beads',
        {
          definition: {
            name: 'spawn_executors_from_beads',
            description: 'Launch Ralphito executors for one or more bead specs that already exist on disk.',
            inputSchema: {
              type: 'object',
              properties: {
                beadPaths: {
                  type: 'array',
                  description: 'Workspace-relative bead spec paths to execute.',
                  items: { type: 'string', description: 'A bead spec path.' },
                },
                project: { type: 'string', description: 'Optional AO project id. Defaults to backend-team.' },
              },
              required: ['beadPaths'],
            },
          },
          handler: async (input) => this.spawnExecutorsFromBeads(input),
        },
      ],
      [
        'check_executor_status',
        {
          definition: {
            name: 'check_executor_status',
            description: 'Inspect current Ralphito executor status from the local orchestrator scripts.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          handler: async (_input, context) => this.checkExecutorStatus(context),
        },
      ],
    ]);
  }

  getMaxIterations() {
    return MAX_TOOL_ITERATIONS;
  }

  getDefinitionsForAgent(agentId: string) {
    const toolNames = TOOL_POLICIES[agentId] || [];
    return toolNames
      .map((toolName) => this.tools.get(toolName)?.definition)
      .filter((definition): definition is ToolDefinition => Boolean(definition));
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext) {
    const allowedTools = new Set(TOOL_POLICIES[context.agentId] || []);
    if (!allowedTools.has(name)) {
      throw new Error(`Tool '${name}' no permitida para el agente '${context.agentId}'.`);
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' no existe.`);
    }

    return tool.handler(input, context);
  }

  private async writeProjectFile(input: Record<string, unknown>) {
    const relativeFilePath = getRequiredString(input, 'path');
    const content = getRequiredString(input, 'content');
    const targetPath = resolveAllowedPath(relativeFilePath, ALLOWED_WRITE_ROOTS);

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');

    return {
      ok: true,
      content: JSON.stringify({ path: relativeFilePath, bytesWritten: Buffer.byteLength(content, 'utf8') }),
    };
  }

  private async readProjectFile(input: Record<string, unknown>) {
    const relativeFilePath = getRequiredString(input, 'path');
    const targetPath = resolveAllowedPath(relativeFilePath, [ALLOWED_LIST_ROOT]);
    const content = await readFile(targetPath, 'utf8');

    return {
      ok: true,
      content: JSON.stringify({ path: relativeFilePath, content }),
    };
  }

  private async listProjectFiles(input: Record<string, unknown>) {
    const requestedPath = typeof input.path === 'string' && input.path.trim() ? input.path.trim() : 'docs/specs';
    const targetPath = resolveAllowedPath(requestedPath, [ALLOWED_LIST_ROOT]);
    const entries = await listFilesRecursive(targetPath);
    const relativeEntries = entries.map((entry) => path.relative(REPO_ROOT, entry).split(path.sep).join('/')).sort();

    return {
      ok: true,
      content: JSON.stringify({ path: requestedPath, files: relativeEntries }),
    };
  }

  private async googleWebSearch(input: Record<string, unknown>) {
    const query = getRequiredString(input, 'query');

    if (!this.googleAuthClient) {
      throw new Error('Google OAuth no esta disponible para google_web_search.');
    }

    const { token } = await this.googleAuthClient.getAccessToken();
    if (!token) {
      throw new Error('No se pudo obtener un token valido para Gemini Search.');
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'Busca en la web y responde con un resumen factual y breve en espanol.',
                  'Incluye solo hechos que puedas respaldar con las fuentes encontradas.',
                  `Consulta: ${query}`,
                ].join('\n'),
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
      }),
    });

    if (!response.ok) {
      const rawError = await response.text();
      throw new Error(`Gemini Search fallo con ${response.status}: ${rawError}`);
    }

    const data = await response.json() as GeminiSearchResponse;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text || '').join('\n').trim() || '';
    const sources = (candidate?.groundingMetadata?.groundingChunks || [])
      .map((chunk) => chunk.web)
      .filter((web): web is NonNullable<SearchGroundingChunk['web']> => Boolean(web?.uri))
      .map((web) => ({ title: web.title || web.uri || 'Fuente', url: web.uri || '' }));

    return {
      ok: true,
      content: JSON.stringify({ query, summary: text, sources }),
    };
  }

  private async spawnExecutorsFromBeads(input: Record<string, unknown>) {
    const beadPaths = getRequiredStringArray(input, 'beadPaths');
    const project = typeof input.project === 'string' && input.project.trim() ? input.project.trim() : DEFAULT_EXECUTOR_PROJECT;

    const results = [];

    for (const beadPath of beadPaths) {
      resolveAllowedPath(beadPath, [path.join(REPO_ROOT, 'docs', 'specs', 'projects')]);
      const spawnResult = await runSpawnExecutor({
        project,
        beadPath,
        prompt: `Implementa ${beadPath}`,
      });

      results.push({
        beadPath,
        status: spawnResult.status || 'unknown',
        sessionId: spawnResult.session_id || null,
        message: spawnResult.message || null,
        details: spawnResult.details || null,
      });
    }

    return {
      ok: true,
      content: JSON.stringify({ project, results }),
    };
  }

  private async checkExecutorStatus(context: ToolContext) {
    const { stdout, stderr } = await execFileAsync('./scripts/tools/tool_check_status.sh', [], {
      cwd: REPO_ROOT,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      ok: true,
      content: JSON.stringify({
        agentId: context.agentId,
        output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
      }),
    };
  }
}

function getRequiredString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Campo '${key}' invalido.`);
  }

  return value.trim();
}

function getRequiredStringArray(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Campo '${key}' debe ser un array no vacio.`);
  }

  const values = value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`Campo '${key}' contiene valores invalidos.`);
    }

    return entry.trim();
  });

  return values;
}

function resolveAllowedPath(relativePath: string, allowedRoots: string[]) {
  const normalized = relativePath.replace(/^\.\//, '');
  const absolutePath = path.resolve(REPO_ROOT, normalized);

  if (!allowedRoots.some((root) => isInsideRoot(absolutePath, root))) {
    throw new Error(`Ruta fuera de las roots permitidas: ${relativePath}`);
  }

  return absolutePath;
}

function isInsideRoot(targetPath: string, root: string) {
  const relative = path.relative(root, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}
