import fetch from 'node-fetch';

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

export async function sendTelegramMessage(chatId: string, text: string): Promise<SendTelegramMessageResult> {
  const result = await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  }) as { message_id: number; chat: { id: number } };

  return {
    success: true,
    messageId: result.message_id,
    chatId: String(result.chat.id),
    text,
  };
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string) {
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  });
}

export function getAllowedChatId(): string {
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowedChatId) {
    throw new Error('TELEGRAM_ALLOWED_CHAT_ID no configurado');
  }
  return allowedChatId;
}
