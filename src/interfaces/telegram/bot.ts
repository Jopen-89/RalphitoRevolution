import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import { loadAgentRegistry, getAgentById, type AgentInfo } from './agentRegistry.js';
import * as convStore from './conversationStore.js';
import { initializeRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';
import { EngineNotificationDispatcher } from './engineNotificationDispatcher.js';
import { AgentRegistryService } from '../../core/services/AgentRegistry.js';
import { ACTIVE_AGENT_WINDOW_MS, resolveTelegramRouting } from './routing.js';
import { invokeAgentInChatThread } from './agentInvocationService.js';
import { replaceTelegramMessage, sendTelegramMessage } from './telegramSender.js';

// Capturar errores no manejados para ver el error real y no "[Object: null prototype]"
process.on('uncaughtException', (err) => {
    console.error('❌ Excepción no capturada:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

dotenv.config();
initializeRalphitoDatabase();
AgentRegistryService.sync();

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

if (!token || token === 'pega_tu_token_aqui_sin_comillas') {
    console.error('❌ ERROR: Falta TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

const bot = new Telegraf(token);
const DUPLICATE_MESSAGE_WINDOW_MS = 8 * 1000;
const processingChats = new Set<string>();
const notificationDispatcher = new EngineNotificationDispatcher();

function getAgents() {
    return loadAgentRegistry();
}

console.log(`🚀 Agentes detectados: ${getAgents().map(a => `${a.name} (${a.role})`).join(', ')}`);

function listAgentNames() {
    return getAgents().map((agent) => agent.name).join(', ');
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

function resolveAgentFromReply(ctx: Context) {
    const replyMessageId = (ctx.message as any)?.reply_to_message?.message_id;
    if (!replyMessageId || !ctx.chat) return null;

    const agentId = convStore.getAgentRouteForMessage(String(ctx.chat.id), replyMessageId);
    if (!agentId) return null;

    return getAgentById(getAgents(), agentId) || null;
}

function resolveRecentActiveAgent(chatId: string) {
    const activeAgentId = convStore.getRecentActiveAgent(chatId, ACTIVE_AGENT_WINDOW_MS);
    return activeAgentId || null;
}

async function processAgentRequest(ctx: Context, agent: AgentInfo, instruction: string) {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id;
    const chatKey = String(chatId);

    if (!instruction) {
        await sendTelegramMessage(chatKey, `¡Hola! Soy ${agent.name} (${agent.role}). ¿En qué te puedo ayudar hoy?`, {
            senderPath: 'telegram.bot.processAgentRequest.emptyInstruction',
            agentId: agent.id,
        });
        return;
    }

    const statusLabel = 'analizando tu petición';

    if (processingChats.has(chatKey)) {
        await sendTelegramMessage(chatKey, `⏳ ${agent.name} sigue con la petición anterior. Dame unos segundos y vuelve a escribir.`, {
            senderPath: 'telegram.bot.processAgentRequest.busy',
            agentId: agent.id,
        });
        return;
    }

    processingChats.add(chatKey);

    const statusMessage = await sendTelegramMessage(chatKey, `⏳ ${agent.name} (${agent.role}) ${statusLabel}...`, {
        senderPath: 'telegram.bot.processAgentRequest.status',
        agentId: agent.id,
    });
    if (!statusMessage.messageId) {
        processingChats.delete(chatKey);
        throw new Error(`No pude publicar el mensaje de estado para ${agent.name}.`);
    }

    try {
        await invokeAgentInChatThread({
            chatId: chatKey,
            agent,
            instruction,
            statusMessageId: statusMessage.messageId,
        });
    } catch (error: any) {
        await replaceTelegramMessage(chatKey, statusMessage.messageId, `❌ ${agent.name}: ${normalizeErrorMessage(error)}`, {
            senderPath: 'telegram.bot.processAgentRequest.error',
            agentId: agent.id,
        });
    } finally {
        processingChats.delete(chatKey);
    }
}

// Comandos
for (const agent of getAgents()) {
    bot.command(agent.id, async (ctx) => {
        const chatId = ctx.chat.id.toString();
        if (allowedChatId && chatId !== allowedChatId) {
            console.log(`⚠️ Acceso denegado en comando /${agent.id}: El Chat ID ${chatId} no coincide con el permitido (${allowedChatId})`);
            return;
        }
        const message = ctx.message as any;
        const text = message?.text || '';
        const instruction = text.replace(new RegExp(`^/${agent.id}\\s*`, 'i'), '').trim();

        if (agent.id !== 'raymon') {
            await sendTelegramMessage(chatId, `Raymon es la puerta de entrada. Pídeselo a Raymon y él traerá a ${agent.name} cuando toque.`, {
                senderPath: 'telegram.bot.command.nonRaymonRejected',
                agentId: agent.id,
            });
            return;
        }

        await processAgentRequest(ctx, agent, instruction);
    });
}

bot.start((ctx) => {
    const chatId = ctx.chat.id.toString();
    if (allowedChatId && chatId !== allowedChatId) {
        console.log(`⚠️ Acceso denegado en /start: El Chat ID ${chatId} no coincide con el permitido (${allowedChatId})`);
        return;
    }
    void sendTelegramMessage(chatId, `¡Hola! Soy el sistema Autopilot.\n\n🤖 Raymon es el planner y la puerta de entrada del equipo. Escríbele a Raymon para arrancar cualquier conversación y él irá trayendo a los demás agentes cuando haga falta.\n\nUna vez un agente esté en el hilo, puedes seguir hablándole por reply o por contexto reciente.\n\nAgentes disponibles: ${listAgentNames()}`, {
        senderPath: 'telegram.bot.start',
    });
});

// Texto natural
bot.on('text', async (ctx) => {
    const text = (ctx.message as any)?.text || '';
    const chatId = ctx.chat.id.toString();
    const userId = String(ctx.from?.id || 'unknown');
    const username = ctx.from?.username || 'Usuario desconocido';
    const replyToMessageId = (ctx.message as any)?.reply_to_message?.message_id;

    console.log(`\n📩 Mensaje recibido de [${username}] en Chat ID: ${chatId}`);
    console.log(`Contenido: "${text}"`);

    if (!text.trim()) return;

    if (allowedChatId && chatId !== allowedChatId) {
        console.log(`⚠️ Acceso denegado en texto: El Chat ID ${chatId} no coincide con el permitido (${allowedChatId})`);
        return;
    }

    if (!allowedChatId) {
        console.log(`👉 Configura este ID en tu .env: TELEGRAM_ALLOWED_CHAT_ID=${chatId}`);
    }

    // Si empieza por /, comprobamos si es un comando que ya hemos manejado arriba
    // Si no es un comando de agente, lo tratamos como texto normal (fallback a Raymon)
    const isCommand = text.startsWith('/');
    const commandName = isCommand ? text.split(' ')[0]?.slice(1).toLowerCase() : null;
    const isAgentCommand = commandName && getAgents().some(a => a.id === commandName);

    // Si es un comando de agente, el bot.command ya lo habrá capturado.
    // Si es otro tipo de comando (ej: /hola), seguimos adelante para que Raymon conteste.
    if (isAgentCommand) return;

    const fingerprint = buildMessageFingerprint(text, replyToMessageId);
    if (convStore.isRecentDuplicateMessage(chatId, userId, fingerprint, DUPLICATE_MESSAGE_WINDOW_MS)) {
        console.log(`↩️ Ignorando mensaje duplicado reciente de [${username}]`);
        return;
    }
    convStore.rememberRecentMessage(chatId, userId, fingerprint);
    convStore.addMessageToHistory(chatId, 'Usuario', text, {
        externalMessageId: String((ctx.message as any)?.message_id || ''),
        senderType: 'user',
        senderId: userId,
        senderName: username,
        role: 'user',
    });

    const replyAgent = resolveAgentFromReply(ctx);
    const routingDecision = resolveTelegramRouting({
        agents: getAgents(),
        text,
        replyAgentId: replyAgent?.id,
        activeAgentId: resolveRecentActiveAgent(chatId),
    });

    if (routingDecision) {
        if (routingDecision.reason === 'raymon-entry') {
            console.log(`👉 Enrutando mensaje a Raymon como puerta de entrada: "${text}"`);
        } else if (routingDecision.reason === 'explicit-raymon') {
            console.log(`🎯 Enrutando por mención explícita a Raymon`);
        } else if (routingDecision.reason === 'active-agent') {
            console.log(`↪️ Enrutando por agente activo reciente: ${routingDecision.agent.id}`);
        } else {
            console.log(`💬 Enrutando por reply al agente: ${routingDecision.agent.id}`);
        }

        await processAgentRequest(ctx, routingDecision.agent, text.trim());
        return;
    }

    // Si llegamos aquí y es un comando desconocido, simplemente no hacemos nada o respondemos start
    if (text.startsWith('/')) return;
});

bot.catch((err, ctx) => {
    console.error('❌ Error en middleware de Telegram:', err);
    console.error('↳ Chat:', ctx.chat?.id, 'Update:', ctx.updateType);
});

async function startTelegramBot() {
    notificationDispatcher.start();

    try {
        await bot.launch();
        console.log('✅ Bot de Telegram iniciado correctamente.');
    } catch (err) {
        notificationDispatcher.stop();
        throw err;
    }
}

void startTelegramBot().catch((err) => {
    console.error('❌ Error al iniciar el bot:', err);
});
process.once('SIGINT', () => {
    notificationDispatcher.stop();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    notificationDispatcher.stop();
    bot.stop('SIGTERM');
});
