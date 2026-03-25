import { createHash } from 'crypto';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';

const WORKSPACE_ROOT = process.cwd();
const INDEX_ROOTS = ['src', 'docs'];
const INDEX_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.yml', '.yaml', '.sh']);
const CHUNK_LINE_LIMIT = 60;
const SEARCH_LIMIT = 8;

interface IndexedDocumentRow {
  id: number;
  path: string;
  contentHash: string;
  mtime: number;
}

interface SearchRow {
  chunkId: number;
  path: string;
  kind: string;
  content: string;
  score: number;
}

export interface SearchResult {
  path: string;
  kind: string;
  score: number;
  content: string;
}

function normalizeRelativePath(filePath: string) {
  return path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join('/');
}

function detectKind(relativePath: string) {
  if (relativePath.startsWith('src/')) return 'code';
  if (relativePath.startsWith('docs/')) return 'docs';
  return 'other';
}

function isIndexableFile(filePath: string) {
  return INDEX_EXTENSIONS.has(path.extname(filePath).toLowerCase());
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

    if (entry.isFile() && isIndexableFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function getIndexableFiles() {
  const files = await Promise.all(
    INDEX_ROOTS.map(async (root) => {
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

  return files.flat().sort();
}

function computeContentHash(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function chunkContent(content: string) {
  const lines = content.split('\n');
  const chunks: string[] = [];

  for (let index = 0; index < lines.length; index += CHUNK_LINE_LIMIT) {
    const chunk = lines.slice(index, index + CHUNK_LINE_LIMIT).join('\n').trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function escapeFtsQuery(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/"/g, ''))
    .map((token) => `"${token}"`)
    .join(' ');
}

export async function indexWorkspaceDocuments() {
  const db = getRalphitoDatabase();
  const files = await getIndexableFiles();
  const indexedRows = db
    .prepare('SELECT id, path, content_hash AS contentHash, mtime FROM documents')
    .all() as IndexedDocumentRow[];
  const indexedByPath = new Map(indexedRows.map((row) => [row.path, row]));
  const seenPaths = new Set<string>();

  const upsertDocument = db.prepare(
    `
      INSERT INTO documents (path, kind, content_hash, mtime, indexed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(path)
      DO UPDATE SET
        kind = excluded.kind,
        content_hash = excluded.content_hash,
        mtime = excluded.mtime,
        indexed_at = excluded.indexed_at
    `,
  );
  const getDocumentId = db.prepare('SELECT id FROM documents WHERE path = ?');
  const deleteChunks = db.prepare('DELETE FROM document_chunks WHERE document_id = ?');
  const deleteFts = db.prepare('DELETE FROM document_chunks_fts WHERE rowid IN (SELECT id FROM document_chunks WHERE document_id = ?)');
  const insertChunk = db.prepare(
    'INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, ?, ?)',
  );
  const insertFts = db.prepare(
    'INSERT INTO document_chunks_fts (rowid, path, kind, content) VALUES (?, ?, ?, ?)',
  );

  for (const absolutePath of files) {
    const relativePath = normalizeRelativePath(absolutePath);
    seenPaths.add(relativePath);

    const fileStat = await stat(absolutePath);
    const content = await readFile(absolutePath, 'utf8');
    const contentHash = computeContentHash(content);
    const existing = indexedByPath.get(relativePath);

    if (existing && existing.contentHash === contentHash && existing.mtime === Math.floor(fileStat.mtimeMs)) {
      continue;
    }

    const now = new Date().toISOString();
    const kind = detectKind(relativePath);
    const chunks = chunkContent(content);

    const transaction = db.transaction(() => {
      upsertDocument.run(relativePath, kind, contentHash, Math.floor(fileStat.mtimeMs), now);
      const documentRow = getDocumentId.get(relativePath) as { id: number };
      deleteFts.run(documentRow.id);
      deleteChunks.run(documentRow.id);

      chunks.forEach((chunk, index) => {
        const result = insertChunk.run(documentRow.id, index, chunk);
        insertFts.run(result.lastInsertRowid, relativePath, kind, chunk);
      });
    });

    transaction();
  }

  const stalePaths = indexedRows.filter((row) => !seenPaths.has(row.path));
  if (stalePaths.length > 0) {
    const deleteDocument = db.prepare('DELETE FROM documents WHERE path = ?');
    const deleteTransaction = db.transaction(() => {
      for (const stale of stalePaths) {
        deleteFts.run(stale.id);
        deleteChunks.run(stale.id);
        deleteDocument.run(stale.path);
      }
    });
    deleteTransaction();
  }

  return {
    indexedCount: files.length,
    staleRemoved: stalePaths.length,
  };
}

export function searchIndexedDocuments(query: string, limit = SEARCH_LIMIT): SearchResult[] {
  const db = getRalphitoDatabase();
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];

  const rows = db
    .prepare(
      `
        SELECT
          document_chunks.rowid AS chunkId,
          document_chunks_fts.path AS path,
          document_chunks_fts.kind AS kind,
          document_chunks.content AS content,
          bm25(document_chunks_fts, 2.0, 1.0, 3.5) AS score
        FROM document_chunks_fts
        INNER JOIN document_chunks ON document_chunks.id = document_chunks_fts.rowid
        WHERE document_chunks_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `,
    )
    .all(ftsQuery, limit) as SearchRow[];

  return rows.map((row) => ({
    path: row.path,
    kind: row.kind,
    score: row.score,
    content: row.content,
  }));
}
