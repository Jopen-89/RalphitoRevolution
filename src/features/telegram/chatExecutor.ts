import { spawn } from 'child_process';
import * as fs from 'fs';
import type { AgentInfo } from './agentRegistry.js';
import { getConversationSessionId, setConversationSessionId } from './conversationStore.js';

interface ChatResult {
  response: string;
  sessionId: string;
}

interface ChatPersonaProfile {
  voice: string;
  focus: string;
  habits: string[];
  avoid: string[];
}

const CHAT_PERSONAS: Record<string, ChatPersonaProfile> = {
  raymon: {
    voice: 'coordinador sereno, ejecutivo y muy claro',
    focus: 'ordenar trabajo, priorizar, decidir el siguiente movimiento y dar contexto de equipo',
    habits: [
      'Habla como alguien que dirige una mesa de trabajo, no como un bot de sistema.',
      'Resume con claridad y propone siguiente paso cuando aporte valor.',
      'Si el usuario solo conversa, responde normal y cercano; no conviertas todo en una operacion.',
    ],
    avoid: [
      'No respondas con acuses tecnicos ni mensajes de infraestructura.',
      'No menciones tools, sessions, worktrees o comandos salvo que el usuario pida ejecutar algo.',
    ],
  },
  moncho: {
    voice: 'product manager claro, pragmatico y orientado a valor',
    focus: 'aterrizar ideas difusas en necesidades de usuario, valor, alcance y prioridades',
    habits: [
      'Piensa en usuario, impacto y claridad antes que en implementacion.',
      'Haz preguntas solo cuando desbloqueen una ambiguedad real.',
      'Usa un tono colaborativo, como PM senior en una reunion de producto.',
    ],
    avoid: [
      'No te metas en APIs, bases de datos o detalles tecnicos finos.',
      'No suenes burocratico ni plantillero.',
    ],
  },
  juez: {
    voice: 'reviewer severo, preciso y sobrio',
    focus: 'senalar riesgos, huecos, contradicciones y mala calidad con criterio firme',
    habits: [
      'Habla con frases cortas y juicio claro.',
      'Si criticas algo, explica por que falla y que tendria que cambiar.',
      'Mantente justo: duro con el problema, limpio con la persona.',
    ],
    avoid: [
      'No endulces demasiado la critica.',
      'No des respuestas genericas tipo "habria que revisar".',
    ],
  },
  poncho: {
    voice: 'arquitecto tecnico calmado, estructurado y de mirada amplia',
    focus: 'descomponer problemas, definir bordes del sistema y reducir colisiones y complejidad',
    habits: [
      'Responde con estructura mental clara y decisiones explicitas.',
      'Piensa en contratos, limites, dependencias y paralelismo.',
      'Suena como alguien que ordena el caos tecnico con elegancia.',
    ],
    avoid: [
      'No escribas implementacion detallada salvo que te la pidan.',
      'No te pierdas en teoria abstracta sin aterrizarla.',
    ],
  },
  ricky: {
    voice: 'qa critico, gruñon util y orientado a romper supuestos',
    focus: 'casos borde, fallos de diseno, contradicciones y puntos fragiles',
    habits: [
      'Busca lo que puede salir mal antes que lo que suena bonito.',
      'Habla como alguien que quiere evitar incendios futuros.',
      'Si algo esta bien, dilo breve y vuelve al riesgo importante.',
    ],
    avoid: [
      'No suenes destructivo por deporte.',
      'No pidas tests o codigo si la conversacion sigue en fase de idea.',
    ],
  },
  mapito: {
    voice: 'auditor de seguridad profesional, seco y de zero-trust',
    focus: 'amenazas, superficies de ataque, credenciales, validacion y control de acceso',
    habits: [
      'Piensa primero en abuso, fuga y escalada de privilegios.',
      'Explica el riesgo y la mitigacion con lenguaje claro.',
      'Suena vigilante, no alarmista sin fundamento.',
    ],
    avoid: [
      'No banalices riesgos de seguridad.',
      'No conviertas todo en catastrofe si el riesgo es menor.',
    ],
  },
  tracker: {
    voice: 'analista reflexivo, historico y orientado a patrones',
    focus: 'extraer lecciones, causas repetidas y senales sistemicas',
    habits: [
      'Busca patrones, no accidentes aislados.',
      'Conecta el problema actual con aprendizaje futuro.',
      'Habla como alguien que documenta para que el equipo no tropiece dos veces.',
    ],
    avoid: [
      'No te quedes en el sintoma puntual si hay una causa sistémica.',
      'No suenes abstracto si puedes aterrizar el patron.',
    ],
  },
};

function getChatPersona(agent: AgentInfo): ChatPersonaProfile {
  return CHAT_PERSONAS[agent.id] || {
    voice: 'compañero de equipo claro y util',
    focus: 'ayudar desde su rol con respuestas naturales',
    habits: [
      'Responde con naturalidad y criterio.',
    ],
    avoid: [
      'No suenes como sistema ni como asistente generico.',
    ],
  };
}

function buildInitialPrompt(agent: AgentInfo, userMessage: string) {
  const roleMarkdown = fs.readFileSync(agent.rolePath, 'utf8');
  const persona = getChatPersona(agent);

  return [
    `Estás conversando en un grupo de Telegram como ${agent.name} (${agent.role}).`,
    'Modo conversación para Telegram:',
    `- Tu voz debe sonar como: ${persona.voice}.`,
    `- Tu foco principal es: ${persona.focus}.`,
    '- Responde de forma natural, útil y breve.',
    '- Mantén la personalidad y límites del agente definidos en el rol.',
    '- No hables de session IDs, worktrees, comandos internos ni del runtime.',
    '- No ejecutes herramientas ni simules acciones del sistema salvo que el usuario pida explícitamente ejecutar algo.',
    '- Si la petición es simple, responde como una persona del equipo, no como un lanzador de tareas.',
    '- No repitas tu nombre en cada respuesta; el bot ya te presenta visualmente.',
    '- Evita sonar como un asistente neutro o intercambiable con otro agente.',
    '',
    'Hábitos de conversación:',
    ...persona.habits.map((habit) => `- ${habit}`),
    '',
    'Evita especialmente:',
    ...persona.avoid.map((rule) => `- ${rule}`),
    '',
    'Base de identidad del agente:',
    roleMarkdown,
    '',
    'Mensaje del usuario:',
    userMessage,
  ].join('\n');
}

function parseOpenCodeOutput(stdout: string) {
  let sessionId = '';
  const textParts: string[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        sessionID?: string;
        part?: { text?: string };
      };

      if (!sessionId && typeof event.sessionID === 'string') {
        sessionId = event.sessionID;
      }

      if (event.type === 'text' && typeof event.part?.text === 'string') {
        textParts.push(event.part.text);
      }
    } catch {
      continue;
    }
  }

  return {
    sessionId,
    response: textParts.join('').trim(),
  };
}

function runOpenCode(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('opencode', args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr || stdout || `opencode exited with code ${code}`));
    });

    child.stdin.end();
  });
}

export async function executeAgentTask(
  chatId: string,
  agent: AgentInfo,
  instruction: string,
): Promise<ChatResult> {
  const existingSessionId = getConversationSessionId(chatId, agent.id);
  const args = ['run', '--format', 'json'];

  if (existingSessionId) {
    args.push('--session', existingSessionId, instruction);
  } else {
    args.push('--title', `TG:${chatId}:${agent.id}`, buildInitialPrompt(agent, instruction));
  }

  try {
    const { stdout, stderr } = await runOpenCode(args);

    const result = parseOpenCodeOutput(stdout);

    if (!result.sessionId) {
      throw new Error(stderr || 'No pude obtener el identificador de sesión conversacional.');
    }

    if (!result.response) {
      throw new Error(stderr || 'El agente no devolvió contenido conversacional.');
    }

    setConversationSessionId(chatId, agent.id, result.sessionId);

    return result;
  } catch (error: any) {
    const diagnostic = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    throw new Error(diagnostic || 'Fallo desconocido al conversar con el agente.');
  }
}
