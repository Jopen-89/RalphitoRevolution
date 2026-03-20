import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

interface TelegramMessage {
  chatId: string;
  text: string;
}

interface TelegramReply {
  chatId: string;
  text: string;
}

class MockTelegramApi {
  public readonly replies: TelegramReply[] = [];

  async sendMessage(chatId: string, text: string) {
    this.replies.push({ chatId, text });
  }
}

class TelegramIngressHarness {
  constructor(private readonly telegramApi: MockTelegramApi) {}

  async handleMessage(message: TelegramMessage) {
    const { runAutonomousCoordinatorLoop } = await import('../ingress/autonomousCoordinatorLoop.js');

    const result = await runAutonomousCoordinatorLoop(message.text, message.chatId);
    await this.telegramApi.sendMessage(message.chatId, result.response);

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
    await rm(workspacePath, { recursive: true, force: true });
  }
}

function extractEvidencePath(text: string) {
  const marker = 'Ruta de evidencia: ';
  const index = text.indexOf(marker);
  if (index === -1) return null;

  return text.slice(index + marker.length).trim() || null;
}

test('happy path creates evidence before replying to Telegram', { concurrency: false }, async () => {
  await withWorkspace(async () => {
    const telegram = new MockTelegramApi();
    const ingress = new TelegramIngressHarness(telegram);

    const result = await ingress.handleMessage({
      chatId: 'chat-123',
      text: 'genera evidencia del flujo telegram live',
    });

    const evidencePath = extractEvidencePath(result.response);

    assert.ok(evidencePath);
    assert.equal(existsSync(evidencePath), true);
    assert.equal(telegram.replies.length, 1);
    assert.equal(telegram.replies[0]!.chatId, 'chat-123');
    assert.equal(telegram.replies[0]!.text, result.response);
    assert.match(result.response, /Listo\./);

    const logDir = path.join('docs', 'automation', 'logs');
    assert.equal(existsSync(logDir), true);
  });
});

test('failure path logs the error and returns a controlled response', { concurrency: false }, async () => {
  await withWorkspace(async () => {
    const telegram = new MockTelegramApi();
    const ingress = new TelegramIngressHarness(telegram);

    const result = await ingress.handleMessage({
      chatId: 'chat-500',
      text: 'genera evidencia pero falla la tool',
    });

    const logPath = extractEvidencePath(result.response);

    assert.ok(logPath);
    assert.equal(existsSync(logPath), true);
    assert.equal(telegram.replies.length, 1);
    assert.equal(telegram.replies[0]!.chatId, 'chat-500');
    assert.equal(telegram.replies[0]!.text, result.response);
    assert.match(result.response, /No pude completar la accion solicitada/);

    const logEntry = JSON.parse(await readFile(logPath, 'utf8')) as Record<string, unknown>;
    assert.equal(logEntry.chatId, 'chat-500');
    assert.equal(logEntry.action, 'writeEvidence');
    assert.equal(logEntry.status, 'failure');
  }, { breakEvidencePath: true });
});
