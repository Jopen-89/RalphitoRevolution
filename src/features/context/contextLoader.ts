import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { recordSystemEvent } from '../ops/observabilityService.js';

const WORKSPACE_ROOT = process.cwd();
const SEARCH_ROOTS = ['src', 'docs', 'agents'];
const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.sh']);
const MAX_TOTAL_CHARS = 9000;
const MAX_FILES = 5;
const MAX_LINES_PER_SNIPPET = 60;
const SNIPPET_RADIUS = 12;
const DOC_FALLBACK_LIMIT = 2;

interface ContextSnippet {
  path: string;
  reason: 'explicit_path' | 'filename_match' | 'symbol_match' | 'docs_fallback';
  content: string;
}

const STOPWORDS = new Set([
  'para',
  'sobre',
  'quiero',
  'necesito',
  'revisa',
  'mirar',
  'mira',
  'archivo',
  'archivos',
  'codigo',
  'código',
  'docs',
  'spec',
  'specs',
  'este',
  'esta',
  'estos',
  'estas',
  'desde',
  'donde',
  'dónde',
  'como',
  'cómo',
  'sobre',
  'fase',
  'agent',
  'agents',
]);

let indexedFiles: string[] | null = null;

function normalizeRelativePath(filePath: string) {
  return path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join('/');
}

function isAllowedFile(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return FILE_EXTENSIONS.has(ext);
}

async function collectFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && isAllowedFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function getIndexedFiles() {
  if (indexedFiles) return indexedFiles;

  const files = await Promise.all(
    SEARCH_ROOTS.map(async (root) => {
      const absoluteRoot = path.join(WORKSPACE_ROOT, root);
      try {
        const rootStat = await stat(absoluteRoot);
        if (!rootStat.isDirectory()) return [];
        return collectFiles(absoluteRoot);
      } catch {
        return [];
      }
    }),
  );

  indexedFiles = files.flat().sort();
  return indexedFiles;
}

function extractExplicitPaths(input: string) {
  const matches = input.match(/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+/g) || [];
  return [...new Set(matches)];
}

function extractFilenameCandidates(input: string) {
  const matches = input.match(/[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+/g) || [];
  return [...new Set(matches.filter((match) => !match.includes('/')))];
}

function extractSymbolCandidates(input: string) {
  const tokens = input.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    const looksLikeSymbol = /[A-Z]/.test(token) || token.includes('_') || /[a-z][A-Z]/.test(token);
    if (!looksLikeSymbol || STOPWORDS.has(lower) || seen.has(token)) continue;
    seen.add(token);
    candidates.push(token);
  }

  return candidates.slice(0, 8);
}

function extractAreaTerms(input: string, matchedPaths: string[]) {
  const tokens = new Set<string>();

  for (const token of input.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) || []) {
    const lower = token.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    tokens.add(lower);
  }

  for (const matchedPath of matchedPaths) {
    for (const part of matchedPath.split('/')) {
      const cleaned = part.replace(/\.[^.]+$/, '').toLowerCase();
      if (cleaned.length >= 4 && !STOPWORDS.has(cleaned)) {
        tokens.add(cleaned);
      }
    }
  }

  return [...tokens].slice(0, 10);
}

async function readSnippet(relativePath: string, symbol?: string) {
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  const raw = await readFile(absolutePath, 'utf8');
  const lines = raw.split('\n');

  if (!symbol) {
    return lines.slice(0, MAX_LINES_PER_SNIPPET).map((line, index) => `${index + 1}: ${line}`).join('\n');
  }

  const regex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const index = lines.findIndex((line) => regex.test(line));
  if (index === -1) {
    return lines.slice(0, MAX_LINES_PER_SNIPPET).map((line, lineIndex) => `${lineIndex + 1}: ${line}`).join('\n');
  }

  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(lines.length, index + SNIPPET_RADIUS + 1);
  return lines.slice(start, end).map((line, offset) => `${start + offset + 1}: ${line}`).join('\n');
}

async function resolveExplicitPathSnippets(input: string): Promise<ContextSnippet[]> {
  const snippets: ContextSnippet[] = [];

  for (const explicitPath of extractExplicitPaths(input)) {
    const normalized = explicitPath.replace(/^\.\//, '');
    const absolutePath = path.join(WORKSPACE_ROOT, normalized);

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || !isAllowedFile(absolutePath)) continue;
      snippets.push({
        path: normalizeRelativePath(absolutePath),
        reason: 'explicit_path',
        content: await readSnippet(normalizeRelativePath(absolutePath)),
      });
    } catch {
      // ignore invalid path
    }
  }

  return snippets;
}

async function resolveFilenameSnippets(input: string, excludedPaths: Set<string>) {
  const files = await getIndexedFiles();
  const snippets: ContextSnippet[] = [];

  for (const candidate of extractFilenameCandidates(input)) {
    const matches = files
      .filter((filePath) => path.basename(filePath).toLowerCase() === candidate.toLowerCase())
      .slice(0, 2);

    for (const match of matches) {
      const relativePath = normalizeRelativePath(match);
      if (excludedPaths.has(relativePath)) continue;
      excludedPaths.add(relativePath);
      snippets.push({
        path: relativePath,
        reason: 'filename_match',
        content: await readSnippet(relativePath),
      });
    }
  }

  return snippets;
}

async function resolveSymbolSnippets(input: string, excludedPaths: Set<string>) {
  const files = await getIndexedFiles();
  const snippets: ContextSnippet[] = [];

  for (const symbol of extractSymbolCandidates(input)) {
    const regex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

    for (const filePath of files) {
      const relativePath = normalizeRelativePath(filePath);
      if (excludedPaths.has(relativePath)) continue;

      const content = await readFile(filePath, 'utf8');
      if (!regex.test(content)) continue;

      excludedPaths.add(relativePath);
      snippets.push({
        path: relativePath,
        reason: 'symbol_match',
        content: await readSnippet(relativePath, symbol),
      });
      break;
    }

    if (snippets.length >= 2) break;
  }

  return snippets;
}

async function resolveDocsFallbackSnippets(input: string, excludedPaths: Set<string>, matchedPaths: string[]) {
  const files = await getIndexedFiles();
  const areaTerms = extractAreaTerms(input, matchedPaths);
  const docCandidates = files.filter((filePath) => {
    const relativePath = normalizeRelativePath(filePath);
    if (!relativePath.startsWith('docs/')) return false;
    const lowered = relativePath.toLowerCase();
    return areaTerms.some((term) => lowered.includes(term));
  });

  const snippets: ContextSnippet[] = [];

  for (const filePath of docCandidates) {
    const relativePath = normalizeRelativePath(filePath);
    if (excludedPaths.has(relativePath)) continue;
    excludedPaths.add(relativePath);
    snippets.push({
      path: relativePath,
      reason: 'docs_fallback',
      content: await readSnippet(relativePath),
    });
    if (snippets.length >= DOC_FALLBACK_LIMIT) break;
  }

  return snippets;
}

function formatContext(snippets: ContextSnippet[]) {
  if (snippets.length === 0) return '';

  let totalChars = 0;
  const sections: string[] = [];

  for (const snippet of snippets.slice(0, MAX_FILES)) {
    const block = [`[${snippet.reason}] ${snippet.path}`, '```text', snippet.content, '```'].join('\n');
    if (totalChars + block.length > MAX_TOTAL_CHARS) break;
    sections.push(block);
    totalChars += block.length;
  }

  if (sections.length === 0) return '';

  return ['[CONTEXTO DETERMINISTA DE CODIGO Y DOCS]', ...sections, '[FIN DEL CONTEXTO]'].join('\n\n');
}

export async function loadDeterministicContext(input: string) {
  const startedAt = Date.now();

  try {
    const explicitSnippets = await resolveExplicitPathSnippets(input);
    const excludedPaths = new Set(explicitSnippets.map((snippet) => snippet.path));
    const filenameSnippets = await resolveFilenameSnippets(input, excludedPaths);
    const symbolSnippets = await resolveSymbolSnippets(input, excludedPaths);
    const docsFallbackSnippets = await resolveDocsFallbackSnippets(
      input,
      excludedPaths,
      [...explicitSnippets, ...filenameSnippets, ...symbolSnippets].map((snippet) => snippet.path),
    );

    const snippets = [
      ...explicitSnippets,
      ...filenameSnippets,
      ...symbolSnippets,
      ...docsFallbackSnippets,
    ];
    const formatted = formatContext(snippets);

    recordSystemEvent('context_loader', 'ok', {
      inputPreview: input.slice(0, 120),
      snippetCount: snippets.length,
      durationMs: Date.now() - startedAt,
    });

    return formatted;
  } catch (error) {
    recordSystemEvent('context_loader', 'error', {
      inputPreview: input.slice(0, 120),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
