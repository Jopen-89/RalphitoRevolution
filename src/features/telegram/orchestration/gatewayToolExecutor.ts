import { stat } from 'fs/promises';

import { executeToolCall } from '../../llm-gateway/tools/toolRegistry.js';

export interface GatewayExecutionResult {
  artifactPath: string;
  bytesWritten: number;
}

export interface GatewayToolExecutor {
  execute(intent: string): Promise<GatewayExecutionResult>;
}

interface WriteEvidenceToolMetadata {
  bytesWritten?: number;
  filePath?: string;
  success?: boolean;
}

const TOOL_NAME = 'writeEvidence';

export class ToolRegistryGatewayExecutor implements GatewayToolExecutor {
  async execute(intent: string): Promise<GatewayExecutionResult> {
    const result = await executeToolCall({
      id: `autonomous_coordinator_${Date.now()}`,
      name: TOOL_NAME,
      arguments: { content: intent },
    });

    if (!result.ok) {
      throw new Error(`La tool ${TOOL_NAME} fallo: ${result.content}`);
    }

    const metadata = (result.metadata || {}) as WriteEvidenceToolMetadata;

    if (!metadata.success) {
      throw new Error('La tool del gateway fallo al escribir la evidencia.');
    }

    if (!metadata.filePath) {
      throw new Error('La tool del gateway no devolvio una ruta de evidencia.');
    }

    const fileStats = await stat(metadata.filePath);
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`La evidencia generada no es valida: ${metadata.filePath}.`);
    }

    return {
      artifactPath: metadata.filePath,
      bytesWritten: metadata.bytesWritten || fileStats.size,
    };
  }
}
