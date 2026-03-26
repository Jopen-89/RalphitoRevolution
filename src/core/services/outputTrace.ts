import { createHash } from 'crypto';

type OutputTraceEvent = {
  stage: string;
  text: string;
  sanitizedText?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  senderPath?: string;
  handoffAgentId?: string;
  toolCallCount?: number;
};

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function buildPreview(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function traceOutput(event: OutputTraceEvent) {
  const rawText = event.text || '';
  const sanitizedText = event.sanitizedText;
  const changed = typeof sanitizedText === 'string' ? sanitizedText !== rawText : false;

  console.log(
    `[OutputTrace] ${JSON.stringify({
      stage: event.stage,
      agentId: event.agentId,
      provider: event.provider,
      model: event.model,
      senderPath: event.senderPath,
      handoffAgentId: event.handoffAgentId,
      toolCallCount: event.toolCallCount,
      rawLength: rawText.length,
      rawHash: hashText(rawText),
      rawPreview: buildPreview(rawText),
      ...(typeof sanitizedText === 'string'
        ? {
            sanitizedLength: sanitizedText.length,
            sanitizedHash: hashText(sanitizedText),
            sanitizedPreview: buildPreview(sanitizedText),
            sanitizedChanged: changed,
          }
        : {}),
    })}`,
  );
}
