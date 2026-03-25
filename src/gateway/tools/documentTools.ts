import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getRalphitoRepositories } from '../../infrastructure/persistence/db/index.js';
import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../../core/domain/gateway.types.js';
import { GitService } from './git/gitService.js';
import { requireString, resolvePathInsideRoot } from './filesystem/pathSafety.js';

const REPO_ROOT = '/home/pepu/IAproject/RalphitoRevolution';
const SPECS_PREFIX = path.join(REPO_ROOT, 'docs', 'specs');

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function sanitizePath(base: string, userPath: string): string {
  return resolvePathInsideRoot(base, userPath.replace(/^\/+/, ''));
}

export const DOCUMENT_TOOL_NAMES = ['write_spec_document', 'read_workspace_file', 'write_bead_document', 'inspect_workspace_path'] as const;

export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

export function isDocumentToolName(name: string): name is DocumentToolName {
  return DOCUMENT_TOOL_NAMES.includes(name as DocumentToolName);
}

export function createDocumentTools(worktreePath?: string): Tool[] {
  const activeRoot = worktreePath || REPO_ROOT;
  const activeSpecsPrefix = path.join(activeRoot, 'docs', 'specs');
  const git = new GitService(activeRoot);

  return [
    {
      name: 'write_spec_document',
      description:
        'Guarda un documento (PRD, idea, spec) en /docs/specs/. Solo rutas dentro de /docs/specs/ están permitidas por seguridad.',
      execute: async (params: Record<string, unknown>) => {
        const relativePath = requireString(params.path, 'path');
        const content = requireString(params.content, 'content');

        const fullPath = sanitizePath(activeSpecsPrefix, relativePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');

        // Automatically stage the file so high-level agents don't need execute_bash
        try {
          await git.add([path.relative(activeRoot, fullPath)]);
        } catch (error) {
          console.warn(`Failed to git add ${fullPath}`, error);
        }

        return {
          filePath: fullPath,
          bytesWritten: Buffer.byteLength(content),
          success: true,
        };
      },
    },
    {
      name: 'read_workspace_file',
      description:
        'Lee el contenido de cualquier archivo del workspace. Útil para que agentes lean specs o PRDs de otros agentes.',
      execute: async (params: Record<string, unknown>) => {
        const filePath = requireString(params.filePath, 'filePath');

        const fullPath = sanitizePath(activeRoot, filePath);

        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');

        return {
          filePath: fullPath,
          content,
          bytesRead: Buffer.byteLength(content),
        };
      },
    },
    {
      name: 'write_bead_document',
      description:
        'Guarda un archivo .md de Bead en docs/specs/projects/<project>/ y registra la Task directamente en SQLite usando TaskRepository.',
      execute: async (params: Record<string, unknown>) => {
        const beadPath = requireString(params.beadPath, 'beadPath');
        const projectKey = requireString(params.projectKey, 'projectKey');
        const title = requireString(params.title, 'title');
        const content = optionalString(params.content) || '';

        const fullPath = sanitizePath(activeSpecsPrefix, beadPath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');

        try {
          await git.add([path.relative(activeRoot, fullPath)]);
        } catch (error) {
          console.warn(`Failed to git add ${fullPath}`, error);
        }

        const repos = getRalphitoRepositories();
        const taskId = randomUUID();
        repos.tasks.create({
          id: taskId,
          projectKey,
          title,
          sourceSpecPath: fullPath,
          status: 'pending',
        });

        return {
          filePath: fullPath,
          taskId,
          success: true,
        };
      },
    },
    {
      name: 'inspect_workspace_path',
      description:
        'Verifica si una ruta del workspace existe realmente en disco y devuelve su tipo y ruta resuelta.',
      execute: async (params: Record<string, unknown>) => {
        const requestedPath = requireString(params.path, 'path');
        const fullPath = sanitizePath(activeRoot, requestedPath);
        const exists = fs.existsSync(fullPath);
        const resolvedPath = exists ? fs.realpathSync.native(fullPath) : fullPath;
        const kind = exists ? (fs.statSync(fullPath).isDirectory() ? 'directory' : 'file') : 'missing';

        return {
          requestedPath,
          resolvedPath,
          exists,
          kind,
        };
      },
    },
  ];
}

export function createDocumentToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'write_spec_document',
      description: 'Guarda documento en /docs/specs/.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa dentro de /docs/specs/' },
          content: { type: 'string', description: 'Contenido del documento' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'read_workspace_file',
      description: 'Lee archivo del workspace.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Ruta relativa al repo root' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'write_bead_document',
      description: 'Guarda bead + registra Task en SQLite.',
      parameters: {
        type: 'object',
        properties: {
          beadPath: { type: 'string', description: 'Ruta relativa del .md del bead' },
          projectKey: { type: 'string', description: 'Project key (ej: qa-pipeline-smoke)' },
          title: { type: 'string', description: 'Título de la task' },
          content: { type: 'string', description: 'Contenido markdown del bead' },
        },
        required: ['beadPath', 'projectKey', 'title', 'content'],
      },
    },
    {
      name: 'inspect_workspace_path',
      description: 'Comprueba si una ruta existe en disco dentro del workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa al repo root' },
        },
        required: ['path'],
      },
    },
  ];
}
