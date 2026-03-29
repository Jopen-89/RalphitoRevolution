import { getRalphitoDatabase } from '../../infrastructure/persistence/db/index.js';

export const EXECUTION_GUARDRAIL_KINDS = [
  'no_work_produced',
  'empty_or_repeated_loop',
  'orphan_task',
  'orphan_job',
  'stale_review',
] as const;

export type ExecutionGuardrailKind = (typeof EXECUTION_GUARDRAIL_KINDS)[number];
export type ExecutionGuardrailScope = 'runtime_session' | 'execution_job' | 'execution_review' | 'task';

export interface ExecutionGuardrailRecord {
  kind: ExecutionGuardrailKind;
  scope: ExecutionGuardrailScope;
  summary: string;
  reasonCode: string | null;
  detectedAt: string;
  taskId: string | null;
  executionJobId: string | null;
  runtimeSessionId: string | null;
  reviewId: string | null;
  metadata: Record<string, unknown> | null;
}

function trimText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function createGuardrailRecord(input: {
  kind: ExecutionGuardrailKind;
  scope: ExecutionGuardrailScope;
  summary: string;
  reasonCode?: string | null;
  detectedAt?: string;
  taskId?: string | null;
  executionJobId?: string | null;
  runtimeSessionId?: string | null;
  reviewId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    kind: input.kind,
    scope: input.scope,
    summary: trimText(input.summary) || input.kind,
    reasonCode: trimText(input.reasonCode),
    detectedAt: input.detectedAt || new Date().toISOString(),
    taskId: trimText(input.taskId),
    executionJobId: trimText(input.executionJobId),
    runtimeSessionId: trimText(input.runtimeSessionId),
    reviewId: trimText(input.reviewId),
    metadata: input.metadata || null,
  } satisfies ExecutionGuardrailRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function attachGuardrailPayload(
  payload: unknown,
  guardrail?: ExecutionGuardrailRecord | null,
) {
  if (!guardrail) {
    return payload === undefined ? null : payload;
  }

  const base = isRecord(payload) ? payload : {};
  return {
    ...base,
    guardrail,
  };
}

export function recordGuardrailEvent(
  guardrail: ExecutionGuardrailRecord,
  status: 'warn' | 'error' = 'warn',
) {
  const db = getRalphitoDatabase();
  db.prepare(
    'INSERT INTO system_events (event_type, status, payload_json, created_at) VALUES (?, ?, ?, ?)',
  ).run('guardrail_detected', status, JSON.stringify(guardrail), guardrail.detectedAt);
  return guardrail;
}
