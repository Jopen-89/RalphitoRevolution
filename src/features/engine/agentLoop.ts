import { readFileSync } from 'fs';
import type { ChatRequest, Message, Provider, ToolCall, ToolResult } from '../llm-gateway/interfaces/gateway.types.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';

export interface AgentLoopInput {
  runtimeSessionId: string;
  worktreePath: string;
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
export const GATEWAY_URL = 'http://localhost:3005/v1/chat';
export const MAX_FINISH_REPROMPTS = 3;
export const MAX_TOOL_LEAK_REPROMPTS = 3;

const TOOL_MARKDOWN_BLOCK_PATTERN = /```(?:bash|sh|shell)\b/i;
const TEXTUAL_TOOL_INVOCATION_PATTERN = /\b(?:execute_bash|read_file_raw|write_file_raw|finish_task)\s*\(/i;

const TOOL_LEAK_REPROMPT =
  'You provided shell commands or textual tool usage. You MUST invoke the appropriate tool directly. Do not output markdown code blocks or tool names as text. Please invoke the tool now.';
const FINISH_REPROMPT =
  'You must explicitly use the finish_task tool or execute ./scripts/bd.sh sync to complete this task. Natural language confirmation alone is insufficient. Please invoke the appropriate tool now.';

export const RALPHITO_SYSTEM_PROMPT = `You are Ralphito, a senior software engineer agent. You work inside a secure sandbox (worktree) and must complete tasks by implementing them directly.

## Core Rules
- Use the provided tools for all system interaction
- Do NOT output shell commands, tool names, or markdown code blocks instead of invoking a tool
- NEVER leave the worktree directory
- NEVER use cd to navigate outside the worktree
- All file operations are sandboxed to the worktree

## Workflow
1. Read the bead/task instruction file to understand what to implement
2. Implement the required changes using the provided tools
3. Verify your implementation works correctly
4. Finalize only when the implementation is complete and verified by invoking the appropriate tool

## Important
- Always run commands in the worktree directory (already set as CWD)
- Verify git status before finalizing
- If a command fails, diagnose the issue and try alternative approaches
- Do NOT ask for confirmation - just implement and finish when done`;

export function loadBeadFromInstruction(instruction: string): string {
  if (instruction.includes('\n') || instruction.endsWith('.md')) {
    const beadPath = instruction.trim();
    try {
      return readFileSync(beadPath, 'utf-8');
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

export function buildGatewayChatRequest(input: Pick<AgentLoopInput, 'provider' | 'model'>, messages: Message[]): ChatRequest {
  return {
    agentId: 'ralphito',
    messages,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.provider && input.model ? { model: input.model } : {}),
  };
}

export async function agentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { runtimeSessionId, worktreePath, instruction } = input;
  const sessionRepo = getRuntimeSessionRepository();
  const beadContent = loadBeadFromInstruction(instruction);
  const messages = buildInitialMessages(RALPHITO_SYSTEM_PROMPT, beadContent);
  
  let iterations = 0;
  let done = false;
  let lastResponse = '';
  let finishRepromptCount = 0;
  let toolLeakRepromptCount = 0;

  while (iterations < MAX_ITERATIONS && !done) {
    iterations++;

    const session = sessionRepo.getByRuntimeSessionId(runtimeSessionId);
    if (session?.status === 'cancelled' || session?.status === 'failed') {
      return { exitCode: 1, iterations, lastResponse: 'Session cancelled or failed' };
    }

    try {
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
        console.error(`[AgentLoop] Gateway error ${response.status}: ${errorText}`);
        messages.push({
          role: 'assistant',
          content: `Gateway error: ${response.status}. Retrying...`,
        });
        continue;
      }

      const data = await response.json() as {
        response?: string;
        toolCalls?: ToolCall[];
        toolResults?: ToolResult[];
      };

      if (data.toolCalls && data.toolCalls.length > 0) {
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
                  console.log('[AgentLoop] finish_task succeeded');
                  done = true;
                } else {
                  console.error(`[AgentLoop] finish_task failed: ${parsed.message}`);
                  done = true;
                  return { exitCode: 1, iterations, lastResponse: parsed.message };
                }
              } catch {
                if (result.content.toLowerCase().includes('success')) {
                  done = true;
                }
              }
            }
          }
        }
      } else if (data.response) {
        lastResponse = data.response;
        messages.push({
          role: 'assistant',
          content: data.response,
        });

        if (hasToolInvocationLeak(data.response)) {
          toolLeakRepromptCount++;
          if (toolLeakRepromptCount >= MAX_TOOL_LEAK_REPROMPTS) {
            console.error(`[AgentLoop] Agent stuck in textual tool leakage after ${MAX_TOOL_LEAK_REPROMPTS} attempts.`);
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
          finishRepromptCount++;
          if (finishRepromptCount >= MAX_FINISH_REPROMPTS) {
            console.error(`[AgentLoop] Agent stuck in text-only responses after ${MAX_FINISH_REPROMPTS} attempts.`);
            done = true;
            return { exitCode: 1, iterations, lastResponse: 'Agent stuck: failed to invoke finish_task or bd.sh sync' };
          }
          messages.push({
            role: 'user',
            content: FINISH_REPROMPT,
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[AgentLoop] Timeout after ${MAX_COMMAND_TIME_MS}ms`);
        return { exitCode: 1, iterations, lastResponse: 'Command timeout' };
      }
      console.error(`[AgentLoop] Error:`, error instanceof Error ? error.message : String(error));
      messages.push({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}. Retrying...`,
      });
    }
  }

  if (iterations >= MAX_ITERATIONS && !done) {
    return { exitCode: 1, iterations, lastResponse: 'Max iterations reached' };
  }

  return { exitCode: 0, iterations, lastResponse };
}
