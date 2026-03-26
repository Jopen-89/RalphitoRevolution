import type { AgentInfo } from './agentRegistry.js';
import * as convStore from './conversationStore.js';
import { editTelegramMessage, sanitizeTelegramVisibleText, sendTelegramMessage } from './telegramSender.js';

function getAgentEmoji(agentId: string): string {
  const emojis: Record<string, string> = {
    raymon: '🤖',
    moncho: '🎯',
    juez: '⚖️',
    poncho: '🏗️',
    ricky: '🐛',
    miron: '👁️',
    mapito: '🛡️',
    tracker: '🔍',
    martapepis: '🕵️‍♀️',
    relleno: '⚡',
    lola: '🎨',
  };

  return emojis[agentId] || '👤';
}

function splitTelegramMessage(text: string, maxLength = 3800) {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const splitIndex = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    const cutAt = splitIndex > 0 ? splitIndex : maxLength;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }

  if (remaining) chunks.push(remaining);

  return chunks;
}

export async function publishAgentReply(chatId: string, messageId: number, agent: AgentInfo, response: string) {
  const emoji = getAgentEmoji(agent.id);
  const header = `${emoji} ${agent.name.toUpperCase()} (${agent.role}):\n\n`;
  const outgoingText = sanitizeTelegramVisibleText(response);
  const chunks = splitTelegramMessage(outgoingText ? `${header}${outgoingText}` : header, 3800);
  const firstChunk = chunks[0] || header;

  convStore.addMessageToHistory(chatId, agent.name, response, {
    externalMessageId: String(messageId),
    senderType: 'agent',
    senderId: agent.id,
    senderName: agent.name,
    role: 'assistant',
  });

  await editTelegramMessage(chatId, messageId, firstChunk, {
    senderPath: 'agentMessenger.publishAgentReply.edit',
    agentId: agent.id,
  });
  convStore.setMessageAgentRoute(chatId, messageId, agent.id);
  convStore.setActiveAgent(chatId, agent.id);

  for (const chunk of chunks.slice(1)) {
    const sent = await sendTelegramMessage(chatId, chunk, {
      senderPath: 'agentMessenger.publishAgentReply.chunk',
      agentId: agent.id,
    });
    if (!sent.messageId) continue;
    convStore.setMessageAgentRoute(chatId, sent.messageId, agent.id);
    convStore.setActiveAgent(chatId, agent.id);
  }
}
