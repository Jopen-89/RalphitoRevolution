import fs from 'fs';
import path from 'path';
import type { ChatRequest, Message, Provider, ToolCall, ToolResult } from '../../gateway/interfaces/gateway.types.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';

export interface AgentLoopInput {
  runtimeSessionId: string;
  worktreePath: string;
  projectId?: string;
  systemPrompt: string;
  instruction: string;
  provider?: Provider | null;
  model?: string | null;
}

export interface AgentLoopResult {
  exitCode: number;
  iterations: number;
  lastResponse?: string;
}

export const MAX_ITERATIONS = 120;
export const MAX_COMMAND_TIME_MS = 600000;
export const GATEWAY_URL = process.env.RALPHITO_GATEWAY_URL || 'http://127.0.0.1:3006/v1/chat';
export const MAX_FINISH_REPROMPTS = 3;
export const MAX_TOOL_LEAK_REPROMPTS = 2;

const TOOL_MARKDOWN_BLOCK_PATTERN = /```(?:bash|sh|shell)\b/i;
const TEXTUAL_TOOL_INVOCATION_PATTERN = /\b(?:execute_bash|read_file_raw|write_file_raw|finish_task)\s*\(/i;

const TOOL_LEAK_REPROMPT =
  'You provided shell commands or textual tool usage. You MUST invoke the appropriate tool directly. Do not output markdown code blocks or tool names as text. Please invoke the tool now.';
const FINISH_REPROMPT =
  'You must explicitly use the finish_task tool or execute ./scripts/bd.sh sync to complete this task. Natural language confirmation alone is insufficient. Please invoke the appropriate tool now.';

export function loadBeadFromInstruction(instruction: string): string {
  if (instruction.includes('\n') || instruction.endsWith('.md')) {
    const beadPath = instruction.trim();
    try {
      return fs.readFileSync(beadPath, 'utf-8');
    } catch {
      return instruction;
    }
  }
  return instruction;
}

export function buildInitialMessages(systemPrompt: string, beadContent: string): Message[] {
  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: beadContent,
    },
  ];
}

export function hasFinishIndicator(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('finish') || lower.includes('done') || lower.includes('complete');
}

export function hasToolInvocationLeak(text: string): boolean {
  return TOOL_MARKDOWN_BLOCK_PATTERN.test(text) || TEXTUAL_TOOL_INVOCATION_PATTERN.test(text);
}

export function buildGatewayChatRequest(input: Pick<AgentLoopInput, 'provider' | 'model'> & { projectId?: string }, messages: Message[]): ChatRequest {
  return {
    agentId: input.projectId || 'ralphito',
    messages,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.provider && input.model ? { model: input.model } : {}),
  };
}

export async function agentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { runtimeSessionId, worktreePath, systemPrompt, instruction } = input;
  const logFile = path.join(worktreePath, '.agent-loop.log');
  const log = (msg: string) => {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    console.log(msg);
  };

  log(`[AgentLoop] Starting session ${runtimeSessionId}`);
  const sessionRepo = getRuntimeSessionRepository();
  const beadContent = loadBeadFromInstruction(instruction);
  const messages = buildInitialMessages(systemPrompt, beadContent);
  
  let iterations = 0;
  let done = false;
  let lastResponse = '';
  let finishRepromptCount = 0;
  let toolLeakRepromptCount = 0;

  while (iterations < MAX_ITERATIONS && !done) {
    iterations++;
    log(`[AgentLoop] Iteration ${iterations}...`);

    const session = sessionRepository.getByRuntimeSessionId(input.runtimeSessionId);
    if (session?.status === 'cancelled' || session?.status === 'failed') {
      log(`[AgentLoop] Session cancelled or failed`);
      return { exitCode: 1, iterations, lastResponse: 'Session cancelled or failed' };
    }

    try {
      log(`[AgentLoop] Calling gateway...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), MAX_COMMAND_TIME_MS);

      const response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ralphito-Worktree-Path': worktreePath,
        },
        body: JSON.stringify(buildGatewayChatRequest(input, messages)),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        log(`[AgentLoop] Gateway error ${response.status}: ${errorText}`);
        messages.push({
          role: 'assistant',
          content: `Gateway error: ${response.status}. Retrying...`,
        });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data = await response.json() as {
        response?: string;
        toolCalls?: ToolCall[];
        toolResults?: ToolResult[];
      };

      if (data.toolCalls && data.toolCalls.length > 0) {
        log(`[AgentLoop] Tool calls: ${data.toolCalls.map(tc => tc.name).join(', ')}`);
        messages.push({
          role: 'assistant',
          content: data.response || '',
          toolCalls: data.toolCalls,
        });

        const toolCallIdToName = new Map(data.toolCalls.map((tc) => [tc.id, tc.name]));

        if (data.toolResults) {
          for (const result of data.toolResults) {
            const toolName = toolCallIdToName.get(result.toolCallId);
            messages.push({
              role: 'tool',
              toolCallId: result.toolCallId,
              ...(toolName ? { name: toolName } : {}),
              content: result.content,
              ...(result.payload ? { toolResult: result.payload } : {}),
            });

            if (toolName === 'finish_task') {
              try {
                const parsed = JSON.parse(result.content) as { success: boolean; message: string };
                if (parsed.success) {
                  log('[AgentLoop] finish_task succeeded');
                  done = true;
                } else {
                  log(`[AgentLoop] finish_task failed: ${parsed.message}`);
                  done = true;
                  return { exitCode: 1, iterations, lastResponse: parsed.message };
                }
              } catch {
                if (result.content.toLowerCase().includes('success')) {
                  log('[AgentLoop] finish_task succeeded (text match)');
                  done = true;
                }
              }
            }
          }
        }
      } else if (data.response) {
        log(`[AgentLoop] Assistant response: ${data.response.slice(0, 50)}...`);
        lastResponse = data.response;
        messages.push({
          role: 'assistant',
          content: data.response,
        });

        if (hasToolInvocationLeak(data.response)) {
          log(`[AgentLoop] Tool leak detected`);
          toolLeakRepromptCount++;
          if (toolLeakRepromptCount >= MAX_TOOL_LEAK_REPROMPTS) {
            log(`[AgentLoop] Stuck in tool leakage`);
            done = true;
            return { exitCode: 1, iterations, lastResponse: 'Agent stuck: failed to invoke a tool after textual shell/tool responses' };
          }
          messages.push({
            role: 'user',
            content: TOOL_LEAK_REPROMPT,
          });
          continue;
        }

        if (hasFinishIndicator(data.response)) {
          log(`[AgentLoop] Finish indicator detected, reprompting...`);
          finishRepromptCount++;
          if (finishRepromptCount >= MAX_FINISH_REPROMPTS) {
            log(`[AgentLoop] Stuck in text-only finish`);
            done = true;
            return { exitCode: 1, iterations, lastResponse: 'Agent stuck: failed to invoke finish_task or bd.sh sync' };
          }
          messages.push({
            role: 'user',
            content: FINISH_REPROMPT,
          });
        }
      }
    } catch (error: any) {
      if (error instanceof Error && error.name === 'AbortError') {
        log(`[AgentLoop] Timeout after ${MAX_COMMAND_TIME_MS}ms`);
        return { exitCode: 1, iterations, lastResponse: 'Command timeout' };
      }
      log(`[AgentLoop] Error: ${error?.cause ? error.cause : error}`);
      messages.push({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}. Retrying...`,
      });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (iterations >= MAX_ITERATIONS && !done) {
    log(`[AgentLoop] Max iterations reached`);
    return { exitCode: 1, iterations, lastResponse: 'Max iterations reached' };
  }

  log(`[AgentLoop] Finished successfully`);
  return { exitCode: 0, iterations, lastResponse };
}
