import type { Message, ToolCall } from '../core/domain/gateway.types.js';

const PRD_ACTION_PATTERN = /\b(?:crea(?:r)?|crees|escribe(?:r)?|redacta(?:r)?|genera(?:r)?|guarda(?:r)?|haz|hacer|actualiza(?:r)?|reescribe|overwrite|write|draft|create|generate|save|update)\b/i;
const PRD_TARGET_PATTERN = /\b(?:prd|unified-prd(?:\.md)?|product requirement(?:s)? document|product specification)\b/i;

function latestUserMessage(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (content) return content;
  }

  return '';
}

export function resolveRequiredToolNames(input: {
  agentId: string | undefined;
  messages: Message[];
  allowedToolNames: string[];
}) {
  const agentId = input.agentId?.trim().toLowerCase();
  if (agentId !== 'moncho') return [];
  if (!input.allowedToolNames.includes('write_spec_document')) return [];

  const latestMessage = latestUserMessage(input.messages);
  if (!latestMessage) return [];
  if (!PRD_TARGET_PATTERN.test(latestMessage)) return [];
  if (!PRD_ACTION_PATTERN.test(latestMessage) && !/write_spec_document/i.test(latestMessage)) return [];

  return ['write_spec_document'];
}

export function findMissingRequiredToolNames(requiredToolNames: string[], toolCalls: ToolCall[]) {
  if (requiredToolNames.length === 0) return [];

  const calledTools = new Set(toolCalls.map((call) => call.name));
  return requiredToolNames.filter((toolName) => !calledTools.has(toolName));
}

export function assertRequiredToolCalls(requiredToolNames: string[], toolCalls: ToolCall[]) {
  const missing = findMissingRequiredToolNames(requiredToolNames, toolCalls);
  if (missing.length === 0) return;

  throw new Error(`Required tool call missing: ${missing.join(', ')}`);
}
