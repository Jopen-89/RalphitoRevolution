import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getRalphitoRepositories } from '../../persistence/db/index.js';
import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../interfaces/gateway.types.js';

const REPO_ROOT = '/home/pepu/IAproject/RalphitoRevolution';
const SPECS_PREFIX = path.join(REPO_ROOT, 'docs', 'specs');

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Parameter '${name}' must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function sanitizePath(base: string, userPath: string): string {
  const resolved = path.resolve(base, userPath);
  if (!resolved.startsWith(base)) {
    throw new Error(`Path traversal detected: ${userPath}`);
  }
  return resolved;
}

export const DOCUMENT_TOOL_NAMES = ['write_spec_document', 'read_workspace_file', 'write_bead_document'] as const;

export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

export function isDocumentToolName(name: string): name is DocumentToolName {
  return DOCUMENT_TOOL_NAMES.includes(name as DocumentToolName);
}

export function createDocumentTools(): Tool[] {
  return [
    {
      name: 'write_spec_document',
      description:
        'Guarda un documento (PRD, idea, spec) en /docs/specs/. Solo rutas dentro de /docs/specs/ están permitidas por seguridad.',
      execute: async (params: Record<string, unknown>) => {
        const relativePath = requireString(params.path, 'path');
        const content = requireString(params.content, 'content');

        const fullPath = sanitizePath(SPECS_PREFIX, relativePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');

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

        const fullPath = sanitizePath(REPO_ROOT, filePath);

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

        const fullPath = sanitizePath(SPECS_PREFIX, beadPath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');

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
  ];
}

export function createDocumentToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'write_spec_document',
      description: 'Guarda documento en /docs/specs/.',
      parameters: {
        path: { type: 'string', description: 'Ruta relativa dentro de /docs/specs/' },
        content: { type: 'string', description: 'Contenido del documento' },
      },
    },
    {
      name: 'read_workspace_file',
      description: 'Lee archivo del workspace.',
      parameters: {
        filePath: { type: 'string', description: 'Ruta relativa al repo root' },
      },
    },
    {
      name: 'write_bead_document',
      description: 'Guarda bead + registra Task en SQLite.',
      parameters: {
        beadPath: { type: 'string', description: 'Ruta relativa del .md del bead' },
        projectKey: { type: 'string', description: 'Project key (ej: test-opencode-spawn-fix)' },
        title: { type: 'string', description: 'Título de la task' },
        content: { type: 'string', description: 'Contenido markdown del bead' },
      },
    },
  ];
}
