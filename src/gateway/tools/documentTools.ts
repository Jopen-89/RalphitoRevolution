import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  buildBeadFileName,
  normalizeBeadDesignMode,
  normalizeBeadPriority,
  type BeadPriority,
  type DesignBeadsFromSpecResult,
  type DesignedBeadResultItem,
} from '../../core/domain/bead.types.js';
import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../../core/domain/gateway.types.js';
import { GitService } from './git/gitService.js';
import { requireString, resolvePathInsideRoot } from './filesystem/pathSafety.js';
import { BeadLifecycleService } from '../../core/services/BeadLifecycleService.js';
import { getRalphitoRepositories } from '../../infrastructure/persistence/db/index.js';

function resolveDocumentRepoRoot() {
  const configured = process.env.RALPHITO_REPO_ROOT?.trim();
  return path.resolve(configured || process.cwd());
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  return undefined;
}

function sanitizePath(base: string, userPath: string): string {
  return resolvePathInsideRoot(base, userPath.replace(/^\/+/, ''));
}

export const DOCUMENT_TOOL_NAMES = [
  'write_spec_document',
  'read_workspace_file',
  'write_bead_document',
  'design_beads_from_spec',
  'inspect_workspace_path',
] as const;

export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

export function isDocumentToolName(name: string): name is DocumentToolName {
  return DOCUMENT_TOOL_NAMES.includes(name as DocumentToolName);
}

function toSentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function extractMarkdownSections(content: string) {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##+\s+(.+)$/);
    if (match) {
      const headingTitle = match[1];
      if (!headingTitle) continue;
      if (currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
      }
      currentTitle = headingTitle.trim();
      currentBody = [];
      continue;
    }

    if (currentTitle) {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
  }

  return sections.filter((section) => section.title && section.body);
}

function extractBulletLines(content: string) {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim());
}

function firstParagraph(content: string) {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  return paragraphs[0] || '';
}

function buildGoal(sectionBody: string, fallbackTitle: string) {
  const paragraph = firstParagraph(sectionBody);
  if (paragraph) return paragraph;
  return `Implement ${fallbackTitle.toLowerCase()} for the target project.`;
}

function buildScope(sectionBody: string, fallbackTitle: string) {
  const bullets = extractBulletLines(sectionBody);
  if (bullets.length > 0) return bullets.slice(0, 4);

  const paragraph = firstParagraph(sectionBody);
  if (paragraph) {
    return [paragraph];
  }

  return [`Deliver the changes required to complete ${fallbackTitle.toLowerCase()}.`];
}

function buildAcceptanceCriteria(title: string, sourceSpecPath: string) {
  return [
    `The implementation satisfies the bead goal for ${title}.`,
    `The resulting changes stay aligned with ${sourceSpecPath}.`,
  ];
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function stageableRelativePath(activeRoot: string, absolutePath: string) {
  const relativePath = path.relative(activeRoot, absolutePath);
  if (relativePath.startsWith('..')) {
    throw new Error(`Path escapes workspace root: ${absolutePath}`);
  }

  return relativePath;
}

function buildBeadMarkdown(input: {
  title: string;
  goal: string;
  scope: string[];
  acceptanceCriteria: string[];
  outOfScope?: string[];
  dependencies?: string[];
  projectId: string;
  priority: BeadPriority;
  componentPath?: string;
  sourceSpecPath: string;
}) {
  const lines = [
    `# ${input.title}`,
    '',
    '## Goal',
    input.goal,
    '',
    '## Scope',
    ...input.scope.map((item) => `- ${item}`),
    '',
    '## Out of Scope',
    ...((input.outOfScope && input.outOfScope.length > 0) ? input.outOfScope : ['None']).map((item) => `- ${item}`),
    '',
    '## Acceptance Criteria',
    ...input.acceptanceCriteria.map((item) => `- [ ] ${item}`),
    '',
    '## Dependencies',
    ...((input.dependencies && input.dependencies.length > 0) ? input.dependencies : ['none']).map((item) => `- ${item}`),
    '',
    '## Metadata',
    `- projectId: ${input.projectId}`,
    `- priority: ${input.priority}`,
    `- componentPath: ${input.componentPath || 'n/a'}`,
    `- sourceSpecPath: ${input.sourceSpecPath}`,
    '',
  ];

  return lines.join('\n');
}

export function createDocumentTools(workspaceRoot?: string): Tool[] {
  const activeRoot = path.resolve(workspaceRoot || resolveDocumentRepoRoot());
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
          workspaceRoot: activeRoot,
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
        'Guarda un archivo .md de Bead en docs/specs/projects/<project>/ y registra la Task en SQLite usando el lifecycle unificado.',
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

        const taskId = randomUUID();
        BeadLifecycleService.createTask({
          taskId,
          projectId: projectKey,
          projectKey,
          title,
          sourceSpecPath: fullPath,
          beadPath: fullPath,
        });

        return {
          filePath: fullPath,
          taskId,
          success: true,
        };
      },
    },
    {
      name: 'design_beads_from_spec',
      description:
        'Lee un spec o PRD, propone beads markdown bajo docs/specs/projects/<projectId>/ y registra sus tasks en SQLite.',
      execute: async (params: Record<string, unknown>) => {
        const projectId = requireString(params.projectId, 'projectId');
        const specPath = requireString(params.specPath, 'specPath');
        const designMode = normalizeBeadDesignMode(optionalString(params.designMode));
        const componentHint = optionalString(params.componentHint);
        const priorityDefault = normalizeBeadPriority(optionalString(params.priorityDefault));
        const rawMaxBeads = typeof params.maxBeads === 'number' ? params.maxBeads : Number(params.maxBeads);
        const maxBeads = Number.isFinite(rawMaxBeads) && rawMaxBeads > 0 ? Math.floor(rawMaxBeads) : 5;

        if (!getRalphitoRepositories().projects.getById(projectId)) {
          throw new Error(`Unknown project: ${projectId}`);
        }

        const fullSpecPath = sanitizePath(activeRoot, specPath);
        if (!fs.existsSync(fullSpecPath)) {
          throw new Error(`Spec not found: ${specPath}`);
        }

        const specContent = fs.readFileSync(fullSpecPath, 'utf8');
        const sections = extractMarkdownSections(specContent);
        const warnings: string[] = [];
        const stagedPaths: string[] = [];
        let replacedCount = 0;

        if (designMode === 'replace') {
          const existingTasks = BeadLifecycleService.listTasksBySourceSpec({
            projectId,
            sourceSpecPath: fullSpecPath,
          });
          replacedCount = existingTasks.length;

          for (const task of existingTasks) {
            if (task.beadPath && fs.existsSync(task.beadPath)) {
              fs.rmSync(task.beadPath, { force: true });
              stagedPaths.push(stageableRelativePath(activeRoot, task.beadPath));
            }

            if (task.status !== 'cancelled') {
              BeadLifecycleService.cancelTask({
                taskId: task.id,
                projectId,
                sourceSpecPath: fullSpecPath,
                failureReason: 'Superseded by design_beads_from_spec replace run.',
              });
            }
          }

          warnings.push(`Replace mode superseded ${existingTasks.length} existing beads for ${specPath}.`);
        }

        if (sections.length === 0) {
          warnings.push('The source spec has no level-2 headings. A single fallback bead was created.');
        }

        const candidates = (sections.length > 0
          ? sections.map((section) => ({ title: toSentenceCase(section.title), body: section.body }))
          : [{ title: `Implement ${projectId} spec slice`, body: specContent.trim() }]).slice(0, maxBeads);

        const createdBeads: DesignedBeadResultItem[] = [];

        for (const [index, candidate] of candidates.entries()) {
          const fileName = buildBeadFileName(index + 1, candidate.title);
          const relativeBeadPath = path.join('projects', projectId, fileName);
          const fullBeadPath = sanitizePath(activeSpecsPrefix, relativeBeadPath);

          if (fs.existsSync(fullBeadPath)) {
            throw new Error(`Bead already exists: ${relativeBeadPath}`);
          }

          const goal = buildGoal(candidate.body, candidate.title);
          const scope = buildScope(candidate.body, candidate.title);
          const acceptanceCriteria = buildAcceptanceCriteria(candidate.title, specPath);
          const content = buildBeadMarkdown({
            title: candidate.title,
            goal,
            scope,
            acceptanceCriteria,
            projectId,
            priority: priorityDefault,
            ...(componentHint ? { componentPath: componentHint } : {}),
            sourceSpecPath: specPath,
          });

          fs.mkdirSync(path.dirname(fullBeadPath), { recursive: true });
          fs.writeFileSync(fullBeadPath, content, 'utf8');
          stagedPaths.push(stageableRelativePath(activeRoot, fullBeadPath));

          const taskId = randomUUID();
          BeadLifecycleService.createTask({
            taskId,
            projectId,
            title: candidate.title,
            sourceSpecPath: fullSpecPath,
            beadPath: fullBeadPath,
            priority: priorityDefault,
            ...(componentHint ? { componentPath: componentHint } : {}),
          });

          createdBeads.push({
            taskId,
            title: candidate.title,
            priority: priorityDefault,
            status: 'pending',
            beadPath: fullBeadPath,
            ...(componentHint ? { componentPath: componentHint } : {}),
          });
        }

        if (candidates.length < sections.length) {
          warnings.push(`The source spec produced ${sections.length} candidate sections. Only the first ${candidates.length} beads were created.`);
        }

        try {
          if (stagedPaths.length > 0) {
            await git.add(uniqueNonEmpty(stagedPaths));
          }
        } catch (error) {
          console.warn(`Failed to git add designed beads for ${fullSpecPath}`, error);
        }

        const result: DesignBeadsFromSpecResult = {
          projectId,
          specPath: fullSpecPath,
          designMode,
          createdCount: createdBeads.length,
          ...(designMode === 'replace' ? { replacedCount } : {}),
          beads: createdBeads,
          warnings,
          success: true,
        };

        return result;
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
      name: 'design_beads_from_spec',
      description: 'Lee un spec y crea beads accionables para Poncho.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project id canonico de destino' },
          specPath: { type: 'string', description: 'Ruta relativa al spec o PRD origen' },
          designMode: { type: 'string', description: 'Modo de diseno: append o replace' },
          maxBeads: { type: 'number', description: 'Cantidad maxima de beads a generar' },
          priorityDefault: { type: 'string', description: 'Prioridad por defecto: low, medium o high' },
          componentHint: { type: 'string', description: 'Ruta o modulo principal sugerido para los beads' },
        },
        required: ['projectId', 'specPath'],
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
