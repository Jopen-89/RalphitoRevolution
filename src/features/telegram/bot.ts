import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { executeAgentTask } from './executor.js';

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

interface AgentInfo {
    id: string;
    name: string;
    role: string;
}

const AGENT_METADATA: Record<string, string> = {
    'raymon': 'Agent Orchestrator',
    'moncho': 'Feature PM',
    'juez': 'Code Reviewer',
    'ricky': 'Pre-Flight QA',
    'mapito': 'Security Auditor',
    'poncho': 'Technical Architect',
    'tracker': 'Error Learning Analyst'
};

function getAgentsMetadata(): AgentInfo[] {
    const rolesPath = path.join(process.cwd(), 'agents', 'roles');
    try {
        const files = fs.readdirSync(rolesPath);
        return files
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const match = f.match(/\(([^)]+)\)/);
                const agentName = match?.[1] ?? f.replace('.md', '');
                const id = agentName.toLowerCase();
                return {
                    id,
                    name: agentName,
                    role: AGENT_METADATA[id] || 'Agente'
                };
            });
    } catch (e) {
        return [];
    }
}

const agents = getAgentsMetadata();
console.log(`🚀 Agentes detectados: ${agents.map(a => `${a.name} (${a.role})`).join(', ')}`);

async function processAgentRequest(ctx: Context, agent: AgentInfo, instruction: string) {
    if (!ctx.chat) return;

    const chatId = ctx.chat.id;
    
    if (!instruction) {
        await ctx.reply(`¡Hola! Soy ${agent.name} (${agent.role}). ¿En qué te puedo ayudar hoy?`);
        return;
    }

    const statusMessage = await ctx.reply(`⏳ *[${agent.name} (${agent.role})]* analizando tu petición...`, { parse_mode: 'Markdown' });

    try {
        const response = await executeAgentTask(agent.id, instruction);
        
        await bot.telegram.editMessageText(
            chatId,
            statusMessage.message_id,
            undefined,
            `🤖 *${agent.name} (${agent.role})*:\n\n${response}`,
            { parse_mode: 'Markdown' }
        ).catch(async () => {
            await bot.telegram.editMessageText(
                chatId,
                statusMessage.message_id,
                undefined,
                `🤖 ${agent.name} (${agent.role}):\n\n${response}`
            );
        });
    } catch (error: any) {
        await bot.telegram.editMessageText(
            chatId,
            statusMessage.message_id,
            undefined,
            `❌ *${agent.name} (${agent.role})* Error: ${error.message}`
        );
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
    // @ts-ignore
    const text = ctx.message?.text || '';
    if (text.startsWith('/') || (allowedChatId && ctx.chat.id.toString() !== allowedChatId)) return;

    for (const agent of agents) {
        const regex = new RegExp(`^${agent.name}[,:\\s-]+(.+)$`, 'i');
        const match = text.match(regex);
        
        if (match?.[1]) {
            await processAgentRequest(ctx, agent, match[1].trim());
            return;
        }
        
        if (text.toLowerCase() === agent.id) {
            await processAgentRequest(ctx, agent, '');
            return;
        }
    }
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
