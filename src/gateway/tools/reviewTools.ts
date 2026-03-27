import type { Tool } from './toolRegistry.js';
import type { ToolDefinition } from '../../core/domain/gateway.types.js';

interface ReviewToolsContext {
  worktreePath?: string;
}

export function createReviewTools(_context: ReviewToolsContext = {}): Tool[] {
  return [
    {
      name: 'submit_for_review',
      description:
        'Submit the current task for CI validation. Call this when the Bead implementation is complete.',
      execute: async (params: Record<string, unknown>) => {
        const notes = typeof params.notes === 'string' ? params.notes : undefined;
        if (notes) {
          console.log(`[submit_for_review] notes: ${notes}`);
        }
        return 'SUCCESS: Task submitted for CI validation';
      },
    },
  ];
}

export function createReviewToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'submit_for_review',
      description: 'Submit completed work for CI validation.',
      parameters: {
        type: 'object',
        properties: {
          notes: { type: 'string', description: 'Optional notes for the reviewer' },
        },
        required: [],
      },
    },
  ];
}
