import { randomUUID } from 'crypto';
import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { CommandRunner } from './commandRunner.js';

const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;
const TMUX_COMMAND_TIMEOUT_MS = 5_000;

function assertSafeSessionId(sessionId: string) {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error(`Session id invalido: ${sessionId}`);
  }
}

export class TmuxRuntime {
  constructor(private readonly runner = new CommandRunner()) {}

  private async tmux(args: string[]) {
    const { stdout } = await this.runner.run('tmux', args, {
      timeoutMs: TMUX_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trimEnd();
  }

  private async sendBuffer(sessionId: string, text: string) {
    const bufferName = `rr-${randomUUID().slice(0, 8)}`;
    const tmpPath = path.join(tmpdir(), `rr-tmux-${randomUUID()}.txt`);
    writeFileSync(tmpPath, text, { encoding: 'utf8', mode: 0o600 });

    try {
      await this.tmux(['load-buffer', '-b', bufferName, tmpPath]);
      await this.tmux(['paste-buffer', '-b', bufferName, '-t', sessionId, '-d']);
    } finally {
      try {
        unlinkSync(tmpPath);
      } catch {
        // noop
      }

      try {
        await this.tmux(['delete-buffer', '-b', bufferName]);
      } catch {
        // noop
      }
    }
  }

  async createSession(sessionId: string, workspacePath: string, launchCommand: string, env: Record<string, string>) {
    assertSafeSessionId(sessionId);

    const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    await this.tmux(['new-session', '-d', '-s', sessionId, '-c', workspacePath, ...envArgs]);
    await this.sendLiteral(sessionId, launchCommand);
  }

  async sendLiteral(sessionId: string, text: string) {
    assertSafeSessionId(sessionId);

    await this.tmux(['send-keys', '-t', sessionId, 'C-u']);
    if (text.includes('\n') || text.length > 200) {
      await this.sendBuffer(sessionId, text);
    } else {
      await this.tmux(['send-keys', '-t', sessionId, '-l', text]);
    }

    await sleep(300);
    await this.tmux(['send-keys', '-t', sessionId, 'Enter']);
  }

  async captureOutput(sessionId: string, lines = 50) {
    try {
      return await this.tmux(['capture-pane', '-t', sessionId, '-p', '-S', `-${lines}`]);
    } catch {
      return '';
    }
  }

  async isAlive(sessionId: string) {
    try {
      await this.tmux(['has-session', '-t', sessionId]);
      return true;
    } catch {
      return false;
    }
  }

  async getPanePid(sessionId: string) {
    const output = await this.tmux(['display-message', '-p', '-t', sessionId, '#{pane_pid}']);
    const pid = Number.parseInt(output, 10);
    return Number.isFinite(pid) ? pid : null;
  }

  async killSession(sessionId: string) {
    try {
      await this.tmux(['kill-session', '-t', sessionId]);
      return true;
    } catch {
      return false;
    }
  }
}
