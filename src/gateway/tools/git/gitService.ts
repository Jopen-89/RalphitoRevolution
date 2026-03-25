import path from 'path';
import { CommandRunner } from '../../../infrastructure/runtime/commandRunner.js';
import { ensureRelativeWorktreePath, requireWorktreePath } from '../filesystem/pathSafety.js';

const DEFAULT_GIT_TIMEOUT_MS = 600000;

export interface GitStatusSnapshot {
  branch: string;
  upstream: string | null;
  stagedFiles: string[];
  unstagedFiles: string[];
  untrackedFiles: string[];
  aheadCount: number;
  behindCount: number;
  isClean: boolean;
}

export interface GitCommitResult {
  commitHash: string;
  summary: string;
}

export class GitService {
  private readonly worktreePath: string;

  constructor(
    worktreePath: string,
    private readonly runner = new CommandRunner(),
  ) {
    this.worktreePath = requireWorktreePath(worktreePath);
  }

  private async runGit(args: string[], options: { allowFailure?: boolean } = {}) {
    try {
      return await this.runner.run('git', args, {
        cwd: this.worktreePath,
        timeoutMs: DEFAULT_GIT_TIMEOUT_MS,
      });
    } catch (error) {
      if (options.allowFailure) {
        return null;
      }

      throw error;
    }
  }

  private async readTrimmed(args: string[], options: { allowFailure?: boolean } = {}) {
    const result = await this.runGit(args, options);
    return result?.stdout.trim() ?? null;
  }

  async currentBranch() {
    return (await this.readTrimmed(['branch', '--show-current'])) || '';
  }

  async resolveUpstreamRef() {
    const upstream = await this.readTrimmed(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
      allowFailure: true,
    });
    if (upstream) return upstream;

    const branch = await this.currentBranch();
    return branch ? `origin/${branch}` : 'origin/master';
  }

  async upstreamRemote() {
    const upstream = await this.resolveUpstreamRef();
    return upstream.includes('/') ? upstream.split('/')[0] || 'origin' : 'origin';
  }

  async remoteBranchExists(remote: string, branch: string) {
    const result = await this.runGit(['ls-remote', '--exit-code', '--heads', remote, branch], { allowFailure: true });
    return result !== null;
  }

  async ensureRemoteBranchRefExists() {
    const upstream = await this.resolveUpstreamRef();
    const existing = await this.runGit(['rev-parse', '--verify', upstream], { allowFailure: true });
    if (existing) return;

    const branch = await this.currentBranch();
    if (!branch) return;

    await this.runGit(['fetch', 'origin', branch], { allowFailure: true });
  }

  async hasLocalCommitsAhead() {
    const upstream = await this.resolveUpstreamRef();
    const upstreamExists = await this.runGit(['rev-parse', '--verify', upstream], { allowFailure: true });
    if (upstreamExists) {
      const commits = await this.readTrimmed(['rev-list', `${upstream}..HEAD`], { allowFailure: true });
      return Boolean(commits);
    }

    const branch = await this.currentBranch();
    if (!branch) return false;

    const remoteExists = await this.remoteBranchExists('origin', branch);
    if (!remoteExists) return true;

    const commits = await this.readTrimmed(['rev-list', `origin/${branch}..HEAD`], { allowFailure: true });
    return Boolean(commits);
  }

  async status(): Promise<GitStatusSnapshot> {
    const branch = await this.currentBranch();
    const upstream = await this.resolveUpstreamRef();
    const stagedFiles = await this.listFiles(['diff', '--cached', '--name-only']);
    const unstagedFiles = await this.listFiles(['diff', '--name-only']);
    const untrackedFiles = await this.listFiles(['ls-files', '--others', '--exclude-standard']);
    const aheadBehind = await this.readTrimmed(['rev-list', '--left-right', '--count', `${upstream}...HEAD`], {
      allowFailure: true,
    });

    const [behindCount = 0, aheadCount = 0] = aheadBehind
      ? aheadBehind.split(/\s+/).map((value) => Number.parseInt(value, 10) || 0)
      : [0, 0];

    return {
      branch,
      upstream,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      aheadCount,
      behindCount,
      isClean: stagedFiles.length === 0 && unstagedFiles.length === 0 && untrackedFiles.length === 0,
    };
  }

  async listFiles(args: string[]) {
    const output = await this.readTrimmed(args, { allowFailure: true });
    return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
  }

  async diff(options: { cached?: boolean; range?: string } = {}) {
    const args = ['diff'];
    if (options.cached) args.push('--cached');
    if (options.range) args.push(options.range);

    const result = await this.runGit(args);
    if (!result) return '';
    return result.stdout;
  }

  async add(pathsToAdd: string[]) {
    const relativePaths = pathsToAdd.map((entry) => ensureRelativeWorktreePath(entry, this.worktreePath));
    await this.runGit(['add', '--', ...relativePaths]);
    return {
      added: relativePaths,
      count: relativePaths.length,
    };
  }

  async commit(message: string): Promise<GitCommitResult> {
    await this.runGit(['commit', '-m', message]);
    const commitHash = (await this.readTrimmed(['rev-parse', 'HEAD'])) || '';
    const summary = (await this.readTrimmed(['log', '-1', '--pretty=%s'])) || message;

    return {
      commitHash,
      summary,
    };
  }

  async fetch(remote: string, refspec?: string, options: { allowFailure?: boolean } = {}) {
    const args = ['fetch', remote];
    if (refspec) args.push(refspec);
    return this.runGit(args, options);
  }

  async rebase(baseRef: string) {
    await this.runGit(['rebase', baseRef]);
  }

  async pushSetUpstream(remote: string, branch: string) {
    await this.runGit(['push', '--set-upstream', remote, branch]);
  }

  async changedFilesSince(ref: string) {
    return this.listFiles(['diff', '--name-only', `${ref}..HEAD`]);
  }

  async repositoryRoot() {
    return (await this.readTrimmed(['rev-parse', '--show-toplevel'])) || path.resolve(this.worktreePath);
  }
}
