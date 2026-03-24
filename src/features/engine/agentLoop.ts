import { readFileSync } from 'fs';
import type { Message, ToolCall, ToolResult } from '../llm-gateway/interfaces/gateway.types.js';
import { getRuntimeSessionRepository } from './runtimeSessionRepository.js';

export interface AgentLoopInput {
  runtimeSessionId: string;
  worktreePath: string;
  instruction: string;
}

export interface AgentLoopResult {
  exitCode: number;
  iterations: number;
  lastResponse?: string;
}

export const MAX_ITERATIONS = 120;
export const MAX_COMMAND_TIME_MS = 600000;
export const GATEWAY_URL = 'http://localhost:3005/v1/chat';

export const RALPHITO_SYSTEM_PROMPT = `You are Ralphito, a senior software engineer agent. You work inside a secure sandbox (worktree) and must complete tasks by implementing them directly.

## Available Tools
You have access to these tools:
- execute_bash(command): Run bash commands (npm, git, etc.) inside the worktree
- read_file_raw(path): Read files from the worktree
- write_file_raw(path, content): Write files to the worktree  
- finish_task(): Mark the task as complete and commit changes

## Security Rules
- NEVER leave the worktree directory
- NEVER use cd to navigate outside the worktree
- All file operations are sandboxed to the worktree
- If you need to access a file, use read_file_raw with a relative path

## Workflow
1. Read the bead/task instruction file to understand what to implement
2. Implement the required changes using execute_bash and write_file_raw
3. Verify your implementation works correctly
4. Use finish_task() when the implementation is complete and verified

## Important
- Always run commands in the worktree directory (already set as CWD)
- Verify git status before finishing
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

export async function agentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  const { runtimeSessionId, worktreePath, instruction } = input;
  const sessionRepo = getRuntimeSessionRepository();
  const beadContent = loadBeadFromInstruction(instruction);
  const messages = buildInitialMessages(RALPHITO_SYSTEM_PROMPT, beadContent);
  
  let iterations = 0;
  let done = false;
  let lastResponse = '';

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
        body: JSON.stringify({
          agentId: 'ralphito',
          messages,
        }),
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
            messages.push({
              role: 'tool',
              toolCallId: result.toolCallId,
              content: result.content,
            });

            const toolName = toolCallIdToName.get(result.toolCallId);
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

        if (hasFinishIndicator(data.response)) {
          done = true;
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
