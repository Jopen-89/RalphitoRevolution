import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ralphitoMigrations } from '../../infrastructure/persistence/db/migrations.js';
import { RuntimeLockConflictError, RuntimeLockRepository } from './runtimeLockRepository.js';
import { RuntimeReaper } from './runtimeReaper.js';
import { RuntimeSessionRepository } from './runtimeSessionRepository.js';
import { EngineNotificationRepository } from '../services/EventBus.js';
import { resolveWriteScopeTargetsFromBeadFile } from './writeScope.js';
import { WorktreeManager } from '../../infrastructure/runtime/worktreeManager.js';

const GIT_BIN = '/usr/bin/git';

function createMigratedDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  for (const migration of ralphitoMigrations) {
    db.exec(migration.sql);
  }

  return db;
}

function createTempDirectory(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runGit(cwd: string, args: string[]) {
  execFileSync(GIT_BIN, args, { cwd, stdio: 'ignore' });
}

function createGitRepo() {
  const repoRoot = createTempDirectory('rr-engine-repo-');

  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.name', 'Codex']);
  runGit(repoRoot, ['config', 'user.email', 'codex@example.com']);

  writeFileSync(path.join(repoRoot, 'seed.txt'), 'seed\n', 'utf8');
  runGit(repoRoot, ['add', 'seed.txt']);
  runGit(repoRoot, ['commit', '-m', 'seed']);

  const headRef = readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
  const refName = headRef.replace('ref: ', '');
  const headCommit = readFileSync(path.join(repoRoot, '.git', refName), 'utf8').trim();

  return { repoRoot, headCommit };
}

function insertThread(db: Database.Database, externalChatId: string) {
  const now = '2026-03-21T10:00:00.000Z';
  const result = db
    .prepare(
      `
        INSERT INTO threads (channel, external_chat_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run('test', externalChatId, `Thread ${externalChatId}`, now, now);

  return Number(result.lastInsertRowid);
}

test('resolveWriteScopeTargetsFromBeadFile colapsa a base paths reales', () => {
  const repoRoot = createTempDirectory('rr-engine-scope-');

  try {
    mkdirSync(path.join(repoRoot, 'docs', 'specs', 'project'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'src', 'features', 'engine'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'package.json'), '{}\n', 'utf8');

    const beadPath = path.join(repoRoot, 'docs', 'specs', 'project', 'bead-1.md');
    writeFileSync(
      beadPath,
      '[WRITE_ONLY_GLOBS]: ["src/core/engine/**/*.ts", "src/core/engine/file.ts", "package.json"]\n',
      'utf8',
    );

    const targets = resolveWriteScopeTargetsFromBeadFile(beadPath, repoRoot);

    assert.deepEqual(
      targets.map((target) => target.repoRelativePath),
      ['package.json', path.join('src', 'core', 'engine')],
    );
    assert.deepEqual(targets[1]?.sourceGlobs, ['src/core/engine/**/*.ts', 'src/core/engine/file.ts']);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test('RuntimeLockRepository rechaza colision ancestro descendiente', () => {
  const db = createMigratedDatabase();

  try {
    const repository = new RuntimeLockRepository(db as unknown as ReturnType<typeof createMigratedDatabase>);
    const heartbeatAt = '2026-03-21T10:00:00.000Z';

    repository.acquireForSession({
      runtimeSessionId: 'rr-1',
      heartbeatAt,
      targets: [{ path: '/repo/src/core/engine', pathKind: 'directory' }],
    });

    assert.throws(
      () =>
        repository.acquireForSession({
          runtimeSessionId: 'rr-2',
          heartbeatAt,
          targets: [{ path: '/repo/src/core/engine/runtimeLockRepository.ts', pathKind: 'file' }],
        }),
      RuntimeLockConflictError,
    );
  } finally {
    db.close();
  }
});

test('RuntimeLockRepository lista solo locks activos segun nowIso', () => {
  const db = createMigratedDatabase();

  try {
    const repository = new RuntimeLockRepository(db as unknown as ReturnType<typeof createMigratedDatabase>);
    const heartbeatAt = '2026-03-21T10:00:00.000Z';

    repository.acquireForSession({
      runtimeSessionId: 'rr-1',
      heartbeatAt,
      ttlMs: 60_000,
      targets: [{ path: '/repo/src/core/engine', pathKind: 'directory' }],
    });

    assert.equal(repository.listAllActive('2026-03-21T10:00:30.000Z').length, 1);
    assert.equal(repository.listAllActive('2026-03-21T10:02:00.000Z').length, 0);
  } finally {
    db.close();
  }
});

test('WorktreeManager crea y desmonta worktree propio', async () => {
  const { repoRoot, headCommit } = createGitRepo();
  const worktreeRoot = createTempDirectory('rr-engine-phase2-worktrees-');

  try {
    const manager = new WorktreeManager(repoRoot, worktreeRoot);
    const workspacePath = await manager.createWorkspace('rr-2', headCommit);

    assert.equal(existsSync(workspacePath), true);
    assert.equal(readFileSync(path.join(workspacePath, 'seed.txt'), 'utf8'), 'seed\n');

    assert.equal(await manager.teardownWorkspace('rr-2'), true);
    assert.equal(existsSync(workspacePath), false);
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
    rmSync(worktreeRoot, { force: true, recursive: true });
  }
});

test('RuntimeReaper marca stuck, limpia locks stale y borra worktree gestionado', async () => {
  const db = createMigratedDatabase();
  const { repoRoot, headCommit } = createGitRepo();
  const worktreeRoot = createTempDirectory('rr-engine-phase2-worktrees-');

  try {
    const threadId = insertThread(db, 'chat-1');
    const sessionRepository = new RuntimeSessionRepository(
      db as unknown as ReturnType<typeof createMigratedDatabase>,
    );
    const notificationRepository = new EngineNotificationRepository(
      db as unknown as ReturnType<typeof createMigratedDatabase>,
    );
    const lockRepository = new RuntimeLockRepository(
      db as unknown as ReturnType<typeof createMigratedDatabase>,
    );
    const worktreeManager = new WorktreeManager(repoRoot, worktreeRoot);
    const worktreePath = await worktreeManager.createWorkspace('rr-stale', headCommit);
    const staleHeartbeatAt = '2026-03-21T10:00:00.000Z';

    sessionRepository.create({
      threadId,
      agentId: 'backend-team',
      runtimeSessionId: 'rr-stale',
      status: 'running',
      worktreePath,
      heartbeatAt: staleHeartbeatAt,
      startedAt: staleHeartbeatAt,
      createdAt: staleHeartbeatAt,
      updatedAt: staleHeartbeatAt,
    });

    lockRepository.acquireForSession({
      runtimeSessionId: 'rr-stale',
      heartbeatAt: staleHeartbeatAt,
      ttlMs: 60_000,
      targets: [{ path: path.join(repoRoot, 'src'), pathKind: 'directory' }],
    });
    const tmuxRuntime = {
      async isAlive() {
        return false;
      },
      async killSession() {
        return true;
      },
    };

    const reaper = new RuntimeReaper(
      sessionRepository,
      lockRepository,
      worktreeManager,
      tmuxRuntime as never,
      (input) => notificationRepository.enqueue(input),
    );
    const result = await reaper.reap({
      nowIso: '2026-03-21T10:10:00.000Z',
      sessionTtlMs: 60_000,
    });
    const session = sessionRepository.getByRuntimeSessionId('rr-stale');

    assert.deepEqual(result.staleSessions, ['rr-stale']);
    assert.equal(result.releasedLocks, 1);
    assert.deepEqual(result.removedWorktrees, [worktreePath]);
    assert.equal(lockRepository.listByRuntimeSessionId('rr-stale').length, 0);
    assert.equal(session?.status, 'stuck');
    assert.equal(session?.failureKind, 'heartbeat_timeout');
    assert.equal(existsSync(worktreePath), false);
    assert.deepEqual(
      notificationRepository.listAll().map((notification) => notification.eventType),
      ['session.reaped'],
    );
    assert.equal(notificationRepository.listAll()[0]?.runtimeSessionId, 'rr-stale');
  } finally {
    db.close();
    rmSync(repoRoot, { force: true, recursive: true });
    rmSync(worktreeRoot, { force: true, recursive: true });
  }
});
