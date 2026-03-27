import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Message, ToolDefinition, ToolCall, ToolResult, ToolResultPayload } from '../../core/domain/gateway.types.js';
import type { IToolCallingProvider } from '../../core/domain/gateway.types.js';
import type { Tool } from './toolRegistry.js';
import { traceOutput } from '../../core/services/outputTrace.js';
import { RUNTIME_SESSION_FILE_NAME } from '../../core/domain/constants.js';
import { resolveRuntimeBeadPath } from '../../core/engine/runtimeFiles.js';

export interface ToolCallingLoopResult {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export interface ToolCallingLoopContext {
  worktreePath?: string;
  requiredToolNames?: string[];
}

export const MAX_CONSECUTIVE_IDENTICAL_TOOL_ITERATIONS = 2;
export const MAX_REQUIRED_TOOL_REMINDERS = 1;

function isBlankText(value: string | undefined) {
  return !value || !value.trim();
}

function normalizeToolArgument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeToolArgument);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeToolArgument(nestedValue)]),
    );
  }

  return value;
}

function buildToolCallSignature(call: ToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: normalizeToolArgument(call.arguments),
  });
}

function buildToolOutputPayload(output: unknown): ToolResultPayload {
  return { output: output ?? null };
}

function buildToolErrorPayload(message: string): ToolResultPayload {
  return {
    error: {
      message,
    },
  };
}

function findMissingRequiredToolNames(requiredToolNames: string[], toolCalls: ToolCall[]) {
  if (requiredToolNames.length === 0) return [];

  const calledTools = new Set(toolCalls.map((call) => call.name));
  return requiredToolNames.filter((toolName) => !calledTools.has(toolName));
}

function buildRequiredToolReminder(requiredToolNames: string[]) {
  return [
    `Debes llamar ahora la tool obligatoria: ${requiredToolNames.join(', ')}.`,
    'No respondas con texto final hasta ejecutar la tool.',
    'Si falta contenido, redactalo y guardalo con la tool.',
  ].join(' ');
}

function extractVerificationCommandFromBead(beadContent: string): string {
  const match = beadContent.match(/## VERIFICATION_COMMAND\s*\n`([^`]+)`/);
  const explicitCommand = match?.[1]?.trim();
  if (explicitCommand) return explicitCommand;
  console.log('[submit_for_review] No VERIFICATION_COMMAND in Bead, using fallback: npm run lint');
  return 'npm run lint';
}

interface VerificationResult {
  content: string;
  ok: boolean;
}

function runVerificationFromWorktree(worktreePath: string): VerificationResult {
  const sessionFilePath = path.join(worktreePath, RUNTIME_SESSION_FILE_NAME);
  if (!existsSync(sessionFilePath)) {
    return { content: `Error: Runtime session file not found at ${sessionFilePath}`, ok: false };
  }

  let beadPath: string | null = null;
  let beadSnapshotPath: string | null = null;
  try {
    const sessionData = JSON.parse(readFileSync(sessionFilePath, 'utf8'));
    beadPath = sessionData.beadPath;
    beadSnapshotPath = sessionData.beadSnapshotPath || null;
  } catch {
    return { content: `Error: Failed to read or parse runtime session file`, ok: false };
  }

  const beadFilePath = resolveRuntimeBeadPath(
    {
      beadPath,
      beadSnapshotPath,
    },
    { worktreePath },
  );

  if (!beadFilePath) {
    return { content: 'Error: No beadPath in runtime session file', ok: false };
  }

  if (!existsSync(beadFilePath)) {
    return { content: `Error: Bead file not found: ${beadFilePath}`, ok: false };
  }

  const beadContent = readFileSync(beadFilePath, 'utf8');
  const verificationCommand = extractVerificationCommandFromBead(beadContent);

  console.log(`[submit_for_review] Running verification: ${verificationCommand} in ${worktreePath}`);

  try {
    const stdout = execSync(verificationCommand, {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 120000,
      killSignal: 'SIGTERM',
    });
    return { content: `CI PASSED:\n${stdout}`, ok: true };
  } catch (err) {
    const error = err as { stderr?: string; stdout?: string; message?: string };
    const output = error.stderr || error.stdout || error.message || 'Unknown error';
    return { content: `CI FAILED:\n${output}`, ok: false };
  }
}

export async function executeToolCallLoop(
  messages: Message[],
  toolDefinitions: ToolDefinition[],
  toolImplementations: Tool[],
  provider: IToolCallingProvider,
  context: ToolCallingLoopContext = {},
  maxIterations = 15,
): Promise<ToolCallingLoopResult> {
  const toolMap = new Map(toolImplementations.map((t) => [t.name, t]));
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  let previousIterationSignature: string | null = null;
  let consecutiveIdenticalToolIterations = 0;
  let requiredToolReminderCount = 0;

  for (let i = 0; i < maxIterations; i++) {
    const { text, toolCalls: calls } = await provider.generateResponseWithTools(
      messages,
      toolDefinitions,
      context.requiredToolNames ? { requiredToolNames: context.requiredToolNames } : {},
    );
    console.log(`[executeToolCallLoop] Iteration ${i + 1}: LLM returned ${calls?.length || 0} calls`);

    if (!calls || calls.length === 0) {
      const missingRequiredToolNames = findMissingRequiredToolNames(context.requiredToolNames || [], allToolCalls);
      if (missingRequiredToolNames.length > 0) {
        if (requiredToolReminderCount >= MAX_REQUIRED_TOOL_REMINDERS) {
          throw new Error(`Required tool call missing: ${missingRequiredToolNames.join(', ')}`);
        }

        if (!isBlankText(text)) {
          messages.push({
            role: 'assistant',
            content: text,
          });
        }

        messages.push({
          role: 'user',
          content: buildRequiredToolReminder(missingRequiredToolNames),
        });
        requiredToolReminderCount += 1;
        continue;
      }

      if (isBlankText(text)) {
        throw new Error(`Provider ${provider.name} returned empty response without tool calls.`);
      }
      traceOutput({
        stage: 'gateway.toolCalling.final',
        text,
        provider: provider.name,
        toolCallCount: allToolCalls.length,
      });
      return { text, toolCalls: allToolCalls, toolResults: allToolResults };
    }

    requiredToolReminderCount = 0;

    for (const call of calls) {
      console.log(`[executeToolCallLoop] Iteration ${i + 1}: Calling ${call.name}(${JSON.stringify(call.arguments)})`);
    }

    const currentIterationSignature = calls.map(buildToolCallSignature).join('||');
    if (currentIterationSignature === previousIterationSignature) {
      consecutiveIdenticalToolIterations += 1;
    } else {
      previousIterationSignature = currentIterationSignature;
      consecutiveIdenticalToolIterations = 1;
    }

    if (consecutiveIdenticalToolIterations >= MAX_CONSECUTIVE_IDENTICAL_TOOL_ITERATIONS) {
      throw new Error(
        `Detected repeated tool loop: ${calls.map((call) => `${call.name}(${JSON.stringify(normalizeToolArgument(call.arguments))})`).join(', ')}`,
      );
    }

    messages.push({
      role: 'assistant',
      content: text || '',
      toolCalls: calls,
    });

    for (const call of calls) {
      const toolId = call.id || randomUUID();
      const tool = toolMap.get(call.name);

      let result: ToolResult;
      if (!tool) {
        const errorMessage = `Tool not found: ${call.name}`;
        result = {
          toolCallId: toolId,
          content: errorMessage,
          ok: false,
          payload: buildToolErrorPayload(errorMessage),
        };
      } else if (call.name === 'submit_for_review' && context.worktreePath) {
        const notes = typeof call.arguments === 'object' && call.arguments !== null
          ? (call.arguments as Record<string, unknown>).notes
          : undefined;
        if (typeof notes === 'string') {
          console.log(`[submit_for_review] notes: ${notes}`);
        }
        const verificationResult = runVerificationFromWorktree(context.worktreePath);
        result = {
          toolCallId: toolId,
          content: verificationResult.content,
          ok: verificationResult.ok,
          payload: verificationResult.ok
            ? buildToolOutputPayload(verificationResult.content)
            : buildToolErrorPayload(verificationResult.content),
        };
      } else {
        try {
          const execResult = await tool.execute(call.arguments);
          const content = typeof execResult === 'string' ? execResult : JSON.stringify(execResult);
          result = {
            toolCallId: toolId,
            content,
            ok: true,
            payload: buildToolOutputPayload(execResult),
          };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result = {
            toolCallId: toolId,
            content: `Error: ${errorMessage}`,
            ok: false,
            payload: buildToolErrorPayload(errorMessage),
          };
        }
      }

      messages.push({
        role: 'tool',
        toolCallId: toolId,
        name: call.name,
        content: result.content,
        toolResult: result.payload,
      } as Message);

      allToolResults.push(result);
    }

    allToolCalls.push(...calls);
  }

  throw new Error(
    `Límite de ${maxIterations} iteraciones de tool-calling alcanzado. ` +
      `Última llamada: ${JSON.stringify(allToolCalls[allToolCalls.length - 1])}.`,
  );
}
