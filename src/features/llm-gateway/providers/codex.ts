import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ILLMProvider, Message, Provider, QuotaInfo } from '../interfaces/gateway.types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = 'gpt-5.4';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class CodexProvider implements ILLMProvider {
  name: Provider = 'codex';
  private model: string;

  constructor(model: string = DEFAULT_MODEL) {
    this.model = model;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    console.log(`[CodexProvider] Enrutando petición a openai/${this.model} mediante OAuth de opencode...`);

    const prompt = this.buildPrompt(messages);
    const model = this.model.includes('/') ? this.model : `openai/${this.model}`;
    const command = `opencode run '${this.escapeShellArg(prompt)}' -m '${this.escapeShellArg(model)}' --format json --dir '${this.escapeShellArg(process.cwd())}'`;

    try {
      const { stdout, stderr } = await execFileAsync(
        'script',
        ['-q', '-c', command, '/dev/null'],
        {
          cwd: process.cwd(),
          timeout: Number(process.env.OPENCODE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const responseText = this.extractText(stdout);
      if (!responseText) {
        throw new Error(`opencode no devolvió bloques de texto. stderr: ${stderr || '(vacío)'}`);
      }

      return responseText;
    } catch (error) {
      console.error('[CodexProvider] Fallo al ejecutar opencode con OAuth de OpenAI:', error);
      throw error;
    }
  }

  async getQuotaStatus(): Promise<QuotaInfo> {
    return {
      provider: this.name,
      remainingMessages: 999,
      totalLimit: 999,
      percentage: 100,
    };
  }

  private buildPrompt(messages: Message[]) {
    return messages
      .map((message) => `[${message.role.toUpperCase()}]\n${message.content.trim()}`)
      .join('\n\n')
      .trim();
  }

  private extractText(stdout: string) {
    const parts: string[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as { type?: string; part?: { text?: string } };
        if (event.type === 'text' && event.part?.text) {
          parts.push(event.part.text);
        }
      } catch {
        continue;
      }
    }

    return parts.join('\n').trim();
  }

  private escapeShellArg(value: string) {
    return value.replace(/'/g, `'"'"'`);
  }
}
