import {
  FileEvidenceLogger,
  type EvidenceLogEntry,
  type EvidenceLogger,
} from './evidenceLogger.js';
import {
  ToolRegistryGatewayExecutor,
  type GatewayToolExecutor,
} from './gatewayToolExecutor.js';

export interface AutonomousCoordinatorResult {
  artifactPath: string;
  message: string;
  status: 'success' | 'failure';
}

interface AutonomousCoordinatorDependencies {
  evidenceLogger?: EvidenceLogger;
  gatewayExecutor?: GatewayToolExecutor;
}

const TOOL_ACTION = 'writeEvidence';
const SUCCESS_MESSAGE = 'Listo. Genere la evidencia solicitada.';
const FAILURE_MESSAGE = 'No pude completar la accion solicitada. Revise el log generado.';

export class AutonomousCoordinator {
  private readonly evidenceLogger: EvidenceLogger;
  private readonly gatewayExecutor: GatewayToolExecutor;

  constructor(dependencies: AutonomousCoordinatorDependencies = {}) {
    this.evidenceLogger = dependencies.evidenceLogger ?? new FileEvidenceLogger();
    this.gatewayExecutor = dependencies.gatewayExecutor ?? new ToolRegistryGatewayExecutor();
  }

  async execute(intent: string, chatId: string): Promise<AutonomousCoordinatorResult> {
    const timestamp = new Date().toISOString();

    try {
      const executionResult = await this.gatewayExecutor.execute(intent);

      await this.evidenceLogger.log({
        action: TOOL_ACTION,
        artifactPath: executionResult.artifactPath,
        chatId,
        intent,
        status: 'success',
        timestamp,
      });

      return {
        artifactPath: executionResult.artifactPath,
        message: SUCCESS_MESSAGE,
        status: 'success',
      };
    } catch (error) {
      const failureEntry: EvidenceLogEntry = {
        action: TOOL_ACTION,
        chatId,
        errorMessage: this.getErrorMessage(error),
        intent,
        status: 'failure',
        timestamp,
      };

      const failureLog = await this.evidenceLogger.log(failureEntry);

      return {
        artifactPath: failureLog.filePath,
        message: FAILURE_MESSAGE,
        status: 'failure',
      };
    }
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Fallo desconocido en la ejecucion del coordinador.';
  }
}
