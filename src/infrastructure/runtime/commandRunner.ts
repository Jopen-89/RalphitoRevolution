import { execFile, spawn } from 'child_process';
import type { SpawnOptions } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

export class CommandRunner {
  async run(command: string, args: string[], options: RunCommandOptions = {}) {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    } satisfies RunCommandResult;
  }

  spawnDetached(command: string, args: string[], options: SpawnOptions = {}) {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: 'ignore',
    });

    child.unref();
    return child.pid ?? null;
  }
}
