import { AutonomousCoordinator } from '../orchestration/autonomousCoordinator.js';

interface TelegramIngressResult {
  response: string;
}

const ORCHESTRATION_PATTERNS = [
  /docs\/specs\/projects\//i,
  /\bbead-\d+\b/i,
  /\b(?:bead|spec|ralphito|ralphitos|session|sesion|sesiones)\b/i,
  /\bproyecto\s+[a-z0-9_-]{3,}\b/i,
  /\b(?:lanza|orquesta|ejecuta)\b.*\b(?:ralphitos|beads?)\b/i,
];

function coerceRelativePath(artifactPath: string) {
  return artifactPath.replace(/^\.\//, '').trim();
}

export function shouldUseAutonomousCoordinator(agentId: string, instruction: string) {
  if (agentId !== 'raymon') return false;

  return !ORCHESTRATION_PATTERNS.some((pattern) => pattern.test(instruction));
}

function buildTelegramReply(message: string, artifactPath: string) {
  const relativePath = coerceRelativePath(artifactPath) || 'no disponible';
  return `${message}\nRuta de evidencia: ${relativePath}`;
}

export async function runAutonomousCoordinatorLoop(intent: string, chatId: string): Promise<TelegramIngressResult> {
  const coordinator = new AutonomousCoordinator();
  const result = await coordinator.execute(intent, chatId);

  return {
    response: buildTelegramReply(result.message, result.artifactPath),
  };
}
