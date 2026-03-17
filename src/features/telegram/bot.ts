import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import { analyzeAgentMentions, extractMultiAgentInstruction, loadAgentRegistry, getAgentById, type AgentInfo } from './agentRegistry.js';
import {
    getAgentRouteForMessage,
    getRecentActiveAgent,
    isRecentDuplicateMessage,
    rememberRecentMessage,
    setActiveAgent,
    setMessageAgentRoute,
} from './conversationStore.js';
import { executeAgentTask } from './chatExecutor.js';
import { executeOrchestrationTask, isExplicitExecutionIntent } from './orchestrationExecutor.js';

// Capturar errores no manejados para ver el error real y no "[Object: null prototype]"
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

if (!token || token === 'pega_tu_token_aqui_sin_comillas') {
    console.error('❌ ERROR: Falta TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

const bot = new Telegraf(token);
const agents = loadAgentRegistry();
const ACTIVE_AGENT_WINDOW_MS = 15 * 60 * 1000;
const DUPLICATE_MESSAGE_WINDOW_MS = 8 * 1000;
const processingChats = new Set<string>();
console.log(`🚀 Agentes detectados: ${agents.map(a => `${a.name} (${a.role})`).join(', ')}`);

function listAgentNames() {
    return agents.map((agent) => agent.name).join(', ');
}

function normalizeErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error || '');
    const cleaned = raw
        .replace(/\[notifier-[^\]]+\][^\n]*\n?/g, ' ')
        .replace(/node:internal[^\n]*/g, ' ')
        .replace(/at [^\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return 'He tropezado con un fallo interno. Prueba de nuevo en unos segundos.';
    }

    if (/timeout|timed out/i.test(cleaned)) {
        return 'Estoy tardando demasiado en responder. Prueba otra vez en unos segundos.';
    }

    if (cleaned.length > 280) {
        return `${cleaned.slice(0, 277)}...`;
    }

    return cleaned;
}

function buildMessageFingerprint(text: string, replyToMessageId?: number) {
    return `${text.trim().toLowerCase()}::${replyToMessageId || 0}`;
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

async function publishAgentReply(chatId: number | string, messageId: number, agent: AgentInfo, response: string) {
    const chunks = splitTelegramMessage(`${agent.name}:\n\n${response}`);
    const firstChunk = chunks[0] || `${agent.name}:`;

    await bot.telegram.editMessageText(chatId, messageId, undefined, firstChunk);
    setMessageAgentRoute(String(chatId), messageId, agent.id);
    setActiveAgent(String(chatId), agent.id);

    for (const chunk of chunks.slice(1)) {
        const sent = await bot.telegram.sendMessage(chatId, chunk);
        setMessageAgentRoute(String(chatId), sent.message_id, agent.id);
        setActiveAgent(String(chatId), agent.id);
    }
}

function resolveAgentFromReply(ctx: Context) {
    const replyMessageId = (ctx.message as any)?.reply_to_message?.message_id;
    if (!replyMessageId || !ctx.chat) return null;

    const agentId = getAgentRouteForMessage(String(ctx.chat.id), replyMessageId);
    if (!agentId) return null;

    return getAgentById(agents, agentId) || null;
}

function resolveRecentActiveAgent(chatId: string) {
    const activeAgentId = getRecentActiveAgent(chatId, ACTIVE_AGENT_WINDOW_MS);
    if (!activeAgentId) return null;

    return getAgentById(agents, activeAgentId) || null;
}

async function askToChooseAgent(ctx: Context, reason: 'ambiguous' | 'missing') {
    if (reason === 'ambiguous') {
        await ctx.reply(`Te he leído varios agentes a la vez. Háblame a uno solo por mensaje: ${listAgentNames()}.`);
        return;
    }

    await ctx.reply(`No tengo claro a quién le hablas. Nombra a uno al principio, por ejemplo: "Raymon, ayúdame con esto". Disponibles: ${listAgentNames()}.`);
}

async function processMultipleAgentRequest(ctx: Context, targetAgents: AgentInfo[], instruction: string) {
    if (!ctx.chat) return;

    const agentNames = targetAgents.map((agent) => agent.name).join(', ');
    const sharedInstruction = instruction.trim() || 'Quiero escuchar vuestra opinión.';

    await ctx.reply(`🎙️ Pongo a hablar a ${agentNames}.`);

    for (const agent of targetAgents) {
        await processAgentRequest(ctx, agent, sharedInstruction);
    }
}

async function processAgentRequest(ctx: Context, agent: AgentInfo, instruction: string) {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id;
    const chatKey = String(chatId);
    setActiveAgent(String(chatId), agent.id);
    
    if (!instruction) {
        await ctx.reply(`¡Hola! Soy ${agent.name} (${agent.role}). ¿En qué te puedo ayudar hoy?`);
        return;
    }

    const shouldExecute = isExplicitExecutionIntent(instruction);
    const statusLabel = shouldExecute ? 'poniendo la tarea en marcha' : 'analizando tu petición';
    if (processingChats.has(chatKey)) {
        await ctx.reply(`⏳ ${agent.name} sigue con la petición anterior. Dame unos segundos y vuelve a escribir.`);
        return;
    }

    processingChats.add(chatKey);

    const statusMessage = await ctx.reply(`⏳ *[${agent.name} (${agent.role})]* ${statusLabel}...`, { parse_mode: 'Markdown' });

    try {
        if (shouldExecute) {
            const result = await executeOrchestrationTask(agent.id, instruction);
            await publishAgentReply(chatId, statusMessage.message_id, agent, result.response);
            return;
        }

        const result = await executeAgentTask(String(chatId), agent, instruction);
        await publishAgentReply(chatId, statusMessage.message_id, agent, result.response);
    } catch (error: any) {
        await bot.telegram.editMessageText(
            chatId,
            statusMessage.message_id,
            undefined,
            `❌ ${agent.name}: ${normalizeErrorMessage(error)}`
        );
    } finally {
        processingChats.delete(chatKey);
    }
}

// Comandos
for (const agent of agents) {
    bot.command(agent.id, async (ctx) => {
        // @ts-ignore
        const text = ctx.message?.text || '';
        const instruction = text.replace(new RegExp(`^/${agent.id}\\s*`, 'i'), '').trim();
        await processAgentRequest(ctx, agent, instruction);
    });
}

// Texto natural
bot.on('text', async (ctx) => {
    const text = (ctx.message as any)?.text || '';
    const chatId = ctx.chat.id.toString();
    const userId = String(ctx.from?.id || 'unknown');
    const username = ctx.from?.username || 'Usuario desconocido';
    const replyToMessageId = (ctx.message as any)?.reply_to_message?.message_id;

    console.log(`\n📩 Mensaje recibido de [${username}] en Chat ID: ${chatId}`);
    console.log(`Contenido: "${text}"`);

    if (text.startsWith('/')) return;
    if (!text.trim()) return;

    if (allowedChatId && chatId !== allowedChatId) {
        console.log(`⚠️ Acceso denegado: El Chat ID ${chatId} no coincide con el permitido (${allowedChatId})`);
        return;
    }

    if (!allowedChatId) {
        console.log(`👉 Configura este ID en tu .env: TELEGRAM_ALLOWED_CHAT_ID=${chatId}`);
    }

    const fingerprint = buildMessageFingerprint(text, replyToMessageId);
    if (isRecentDuplicateMessage(chatId, userId, fingerprint, DUPLICATE_MESSAGE_WINDOW_MS)) {
        console.log(`↩️ Ignorando mensaje duplicado reciente de [${username}]`);
        return;
    }
    rememberRecentMessage(chatId, userId, fingerprint);

    const mentionAnalysis = analyzeAgentMentions(agents, text);
    if (mentionAnalysis.matches.length > 1) {
        const sharedInstruction = extractMultiAgentInstruction(mentionAnalysis.matches, text);
        await processMultipleAgentRequest(ctx, mentionAnalysis.matches, sharedInstruction || text.trim());
        return;
    }

    if (mentionAnalysis.leadingMatch) {
        await processAgentRequest(ctx, mentionAnalysis.leadingMatch.agent, mentionAnalysis.leadingMatch.instruction);
        return;
    }

    const replyAgent = resolveAgentFromReply(ctx);
    if (replyAgent) {
        await processAgentRequest(ctx, replyAgent, text.trim());
        return;
    }

    const activeAgent = resolveRecentActiveAgent(chatId);
    if (activeAgent) {
        await processAgentRequest(ctx, activeAgent, text.trim());
        return;
    }

    if (mentionAnalysis.matches.length === 1) {
        await processAgentRequest(ctx, mentionAnalysis.matches[0]!, text.trim());
        return;
    }

    await askToChooseAgent(ctx, 'missing');
});

bot.launch().then(() => {
    console.log('✅ Bot de Telegram iniciado correctamente.');
}).catch((err) => {
    console.error('❌ Error al iniciar el bot:', err);
});

// Exportar función de notificación de forma segura
export const sendNotification = async (message: string) => {
    if (allowedChatId) {
        await bot.telegram.sendMessage(allowedChatId, `🔔 *SISTEMA*:\n${message}`, { parse_mode: 'Markdown' })
            .catch(() => bot.telegram.sendMessage(allowedChatId, `🔔 SISTEMA:\n${message}`));
    }
};

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
