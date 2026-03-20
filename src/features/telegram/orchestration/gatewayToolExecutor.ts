import { stat } from 'fs/promises';

import { getToolByName } from '../../llm-gateway/tools/toolRegistry.js';

export interface GatewayExecutionResult {
  artifactPath: string;
  bytesWritten: number;
}

export interface GatewayToolExecutor {
  execute(intent: string): Promise<GatewayExecutionResult>;
}

interface WriteEvidenceToolResult {
  bytesWritten: number;
  filePath: string;
  success: boolean;
}

const TOOL_NAME = 'writeEvidence';

export class ToolRegistryGatewayExecutor implements GatewayToolExecutor {
  async execute(intent: string): Promise<GatewayExecutionResult> {
    const tool = getToolByName(TOOL_NAME);

    if (!tool) {
      throw new Error(`La tool ${TOOL_NAME} no esta registrada en el gateway.`);
    }

    const result = await tool.execute({ content: intent });
    const toolResult = result as WriteEvidenceToolResult;

    if (!toolResult.success) {
      throw new Error('La tool del gateway fallo al escribir la evidencia.');
    }

    if (!toolResult.filePath) {
      throw new Error('La tool del gateway no devolvio una ruta de evidencia.');
    }

    const fileStats = await stat(toolResult.filePath);

    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`La evidencia generada no es valida: ${toolResult.filePath}.`);
    }

    return {
      artifactPath: toolResult.filePath,
      bytesWritten: toolResult.bytesWritten,
    };
  }
}
