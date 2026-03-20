interface CoordinatorLike {
  execute(intent: string, chatId: string): Promise<unknown>;
}

interface TelegramIngressResult {
  response: string;
}

const COORDINATOR_MODULE_PATHS = [
  '../orchestration/autonomousCoordinator.js',
  '../orchestration/AutonomousCoordinator.js',
  '../orchestration/index.js',
];

function isCoordinatorLike(value: unknown): value is CoordinatorLike {
  return typeof value === 'object' && value !== null && typeof (value as CoordinatorLike).execute === 'function';
}

function isConstructor(value: unknown): value is new () => CoordinatorLike {
  return typeof value === 'function';
}

function extractCoordinator(moduleRecord: Record<string, unknown>) {
  const directCandidates = [
    moduleRecord.autonomousCoordinator,
    moduleRecord.default,
  ];

  for (const candidate of directCandidates) {
    if (isCoordinatorLike(candidate)) return candidate;
  }

  const constructorCandidates = [
    moduleRecord.AutonomousCoordinator,
    moduleRecord.default,
  ];

  for (const candidate of constructorCandidates) {
    if (!isConstructor(candidate)) continue;

    try {
      const instance = new candidate();
      if (isCoordinatorLike(instance)) return instance;
    } catch {
      continue;
    }
  }

  if (typeof moduleRecord.getAutonomousCoordinator === 'function') {
    const coordinator = (moduleRecord.getAutonomousCoordinator as () => unknown)();
    if (isCoordinatorLike(coordinator)) return coordinator;
  }

  return null;
}

async function loadAutonomousCoordinator() {
  for (const modulePath of COORDINATOR_MODULE_PATHS) {
    try {
      const imported = await import(modulePath);
      const coordinator = extractCoordinator(imported as Record<string, unknown>);

      if (coordinator) return coordinator;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (message.includes('Cannot find module') || message.includes('ERR_MODULE_NOT_FOUND')) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('AutonomousCoordinator is not available in src/features/telegram/orchestration.');
}

function coerceMessage(value: Record<string, unknown>) {
  const candidates = [value.message, value.response, value.text, value.finalMessage];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function coerceEvidencePath(value: Record<string, unknown>) {
  const candidates = [
    value.evidencePath,
    value.relativeEvidencePath,
    value.artifactPath,
    value.path,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
}

function buildTelegramReply(result: Record<string, unknown>) {
  const message = coerceMessage(result) || 'La ejecucion termino sin devolver un mensaje util.';
  const evidencePath = coerceEvidencePath(result);
  const status = typeof result.status === 'string' ? result.status.toLowerCase() : undefined;
  const success = typeof result.success === 'boolean' ? result.success : undefined;

  if (!evidencePath) {
    return {
      response: `${message}\nRuta de evidencia: no disponible`,
      status: status === 'success' || success === true ? 'controlled_error' : 'controlled_error',
    } as const;
  }

  if (status === 'error' || status === 'failed' || success === false) {
    return {
      response: `${message}\nRuta de evidencia: ${evidencePath}`,
      status: 'controlled_error',
    } as const;
  }

  return {
    response: `${message}\nRuta de evidencia: ${evidencePath}`,
    status: 'success',
  } as const;
}

export async function runAutonomousCoordinatorLoop(intent: string, chatId: string): Promise<TelegramIngressResult> {
  const coordinator = await loadAutonomousCoordinator();
  const result = await coordinator.execute(intent, chatId);

  if (typeof result !== 'object' || result === null) {
    return {
      response: 'La ejecucion termino, pero el coordinador devolvio un formato invalido.\nRuta de evidencia: no disponible',
    };
  }

  return {
    response: buildTelegramReply(result as Record<string, unknown>).response,
  };
}
