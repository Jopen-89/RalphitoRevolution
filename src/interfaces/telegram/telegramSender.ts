import fetch from 'node-fetch';
import { traceOutput } from '../../core/services/outputTrace.js';

export function sanitizeTelegramVisibleText(text: string) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'pega_tu_token_aqui_sin_comillas') {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  }
  return token;
}

export interface SendTelegramMessageResult {
  success: boolean;
  messageId?: number;
  chatId: string;
  text: string;
}

export interface TelegramSendMeta {
  senderPath?: string;
  agentId?: string;
}

async function callTelegram(method: string, body: Record<string, unknown>) {
  const token = getToken();
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as { ok: boolean; result?: any; description?: string };

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown error'}`);
  }

  return data.result;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  meta: TelegramSendMeta = {},
): Promise<SendTelegramMessageResult> {
  const sanitizedText = sanitizeTelegramVisibleText(text);
  traceOutput({
    stage: 'telegram.send',
    text,
    sanitizedText,
    ...(meta.senderPath ? { senderPath: meta.senderPath } : {}),
    ...(meta.agentId ? { agentId: meta.agentId } : {}),
  });
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: sanitizedText,
    parse_mode: 'HTML',
  }) as { message_id: number; chat: { id: number } };

  return {
    success: true,
    messageId: result.message_id,
    chatId: String(result.chat.id),
    text: sanitizedText,
  };
}

export async function editTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  meta: TelegramSendMeta = {},
) {
  const sanitizedText = sanitizeTelegramVisibleText(text);
  traceOutput({
    stage: 'telegram.edit',
    text,
    sanitizedText,
    ...(meta.senderPath ? { senderPath: meta.senderPath } : {}),
    ...(meta.agentId ? { agentId: meta.agentId } : {}),
  });
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: sanitizedText,
    parse_mode: 'HTML',
  });
}

function isIgnorableTelegramEditError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /message is not modified/i.test(message);
}

export async function replaceTelegramMessage(
  chatId: string,
  messageId: number,
  text: string,
  meta: TelegramSendMeta = {},
): Promise<SendTelegramMessageResult> {
  const sanitizedText = sanitizeTelegramVisibleText(text);

  try {
    await editTelegramMessage(chatId, messageId, sanitizedText, meta);
    return {
      success: true,
      messageId,
      chatId,
      text: sanitizedText,
    };
  } catch (error) {
    if (isIgnorableTelegramEditError(error)) {
      return {
        success: true,
        messageId,
        chatId,
        text: sanitizedText,
      };
    }

    console.warn(`[Telegram] editMessageText fallo para chat=${chatId} message=${messageId}. Reintento con sendMessage.`, error);
    return sendTelegramMessage(chatId, sanitizedText, {
      ...meta,
      ...(meta.senderPath ? { senderPath: `${meta.senderPath}.fallback` } : {}),
    });
  }
}

export function getAllowedChatId(): string {
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowedChatId) {
    throw new Error('TELEGRAM_ALLOWED_CHAT_ID no configurado');
  }
  return allowedChatId;
}
