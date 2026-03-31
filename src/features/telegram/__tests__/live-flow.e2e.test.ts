import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeEvidenceTool } from '../../llm-gateway/tools/telegram-demo/writeEvidenceTool.js';

interface TelegramMessage {
  chatId: string;
  text: string;
}

interface TelegramReply {
  chatId: string;
  text: string;
}

interface CoordinatorResult {
  artifactPath: string | null;
  logPath: string;
  message: string;
}

class MockTelegramApi {
  public readonly replies: TelegramReply[] = [];

  async sendMessage(chatId: string, text: string) {
    this.replies.push({ chatId, text });
  }
}

class RealToolGateway {
  async execute(intent: string) {
    return writeEvidenceTool(`telegram-live:${intent}`);
  }
}

class EvidenceLogger {
  async write(entry: Record<string, unknown>) {
    const logsDir = path.join('docs', 'automation', 'logs');
    await mkdir(logsDir, { recursive: true });

    const filename = `live-flow-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
    const logPath = path.join(logsDir, filename);
    await writeFile(logPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');

    return logPath;
  }
}

class AutonomousCoordinator {
  constructor(
    private readonly gateway: RealToolGateway,
    private readonly logger: EvidenceLogger,
  ) {}

  async execute(intent: string, chatId: string): Promise<CoordinatorResult> {
    const timestamp = new Date().toISOString();

    try {
      const toolResult = await this.gateway.execute(intent);
      const artifactExists = toolResult.success && existsSync(toolResult.filePath);
      const status = artifactExists ? 'success' : 'error';
      const logPath = await this.logger.write({
        action: 'writeEvidence',
        artifactPath: artifactExists ? toolResult.filePath : null,
        chatId,
        status,
        timestamp,
      });

      if (!artifactExists) {
        return {
          artifactPath: null,
          logPath,
          message: `No pude completar la accion. Revisa ${logPath}.`,
        };
      }

      return {
        artifactPath: toolResult.filePath,
        logPath,
        message: `Accion completada. Evidencia en ${toolResult.filePath}.`,
      };
    } catch (error) {
      const logPath = await this.logger.write({
        action: 'writeEvidence',
        chatId,
        error: error instanceof Error ? error.message : String(error),
        status: 'error',
        timestamp,
      });

      return {
        artifactPath: null,
        logPath,
        message: `No pude completar la accion. Revisa ${logPath}.`,
      };
    }
  }
}

class TelegramIngressHarness {
  constructor(
    private readonly coordinator: AutonomousCoordinator,
    private readonly telegram: MockTelegramApi,
  ) {}

  async handleMessage(message: TelegramMessage) {
    const result = await this.coordinator.execute(message.text, message.chatId);
    await this.telegram.sendMessage(message.chatId, result.message);
    return result;
  }
}

async function withWorkspace(
  run: (workspacePath: string) => Promise<void>,
  options: { breakEvidencePath?: boolean } = {},
) {
  const previousCwd = process.cwd();
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'telegram-live-flow-'));

  try {
    process.chdir(workspacePath);
    await mkdir(path.join('docs', 'automation'), { recursive: true });

    if (options.breakEvidencePath) {
      await writeFile(path.join('docs', 'automation', 'evidence'), 'blocked', 'utf8');
    }

    await run(workspacePath);
  } finally {
    process.chdir(previousCwd);
    await rm(workspacePath, { force: true, recursive: true });
  }
}

test('happy path creates evidence and responds with its path', { concurrency: false }, async () => {
  await withWorkspace(async () => {
    const telegram = new MockTelegramApi();
    const coordinator = new AutonomousCoordinator(new RealToolGateway(), new EvidenceLogger());
    const ingress = new TelegramIngressHarness(coordinator, telegram);

    const result = await ingress.handleMessage({
      chatId: 'chat-123',
      text: 'genera evidencia del flujo telegram live',
    });

    assert.ok(result.artifactPath);
    assert.equal(existsSync(result.artifactPath), true);
    assert.equal(existsSync(result.logPath), true);
    assert.equal(telegram.replies.length, 1);
    assert.match(telegram.replies[0]!.text, /docs\/automation\/evidence\//);

    const logEntry = JSON.parse(await readFile(result.logPath, 'utf8')) as Record<string, unknown>;
    assert.equal(logEntry.chatId, 'chat-123');
    assert.equal(logEntry.action, 'writeEvidence');
    assert.equal(logEntry.status, 'success');
  });
});

test('failure path logs the error and returns a controlled response', { concurrency: false }, async () => {
  await withWorkspace(async () => {
    const telegram = new MockTelegramApi();
    const coordinator = new AutonomousCoordinator(new RealToolGateway(), new EvidenceLogger());
    const ingress = new TelegramIngressHarness(coordinator, telegram);

    const result = await ingress.handleMessage({
      chatId: 'chat-500',
      text: 'genera evidencia pero falla la tool',
    });

    assert.equal(result.artifactPath, null);
    assert.equal(existsSync(result.logPath), true);
    assert.equal(telegram.replies.length, 1);
    assert.match(telegram.replies[0]!.text, /No pude completar la accion/);

    const logEntry = JSON.parse(await readFile(result.logPath, 'utf8')) as Record<string, unknown>;
    assert.equal(logEntry.chatId, 'chat-500');
    assert.equal(logEntry.action, 'writeEvidence');
    assert.equal(logEntry.status, 'error');
  }, { breakEvidencePath: true });
});
