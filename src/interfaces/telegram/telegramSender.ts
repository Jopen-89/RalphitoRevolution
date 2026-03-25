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

export async function sendTelegramMessage(chatId: string, text: string): Promise<SendTelegramMessageResult> {
  const token = getToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });

  const data = (await response.json()) as { ok: boolean; result?: { message_id: number; chat: { id: number } }; description?: string };

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'unknown error'}`);
  }

  return {
    success: true,
    messageId: data.result!.message_id,
    chatId: String(data.result!.chat.id),
    text,
  };
}

export function getAllowedChatId(): string {
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  if (!allowedChatId) {
    throw new Error('TELEGRAM_ALLOWED_CHAT_ID no configurado');
  }
  return allowedChatId;
}
