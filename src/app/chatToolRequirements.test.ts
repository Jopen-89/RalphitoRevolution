import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRequiredToolCalls, findMissingRequiredToolNames, resolveRequiredToolNames } from './chatToolRequirements.js';

test('moncho exige write_spec_document cuando le piden redactar un PRD', () => {
  const required = resolveRequiredToolNames({
    agentId: 'moncho',
    allowedToolNames: ['write_spec_document', 'inspect_workspace_path'],
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Moncho, redacta un PRD para una bead de prueba' },
    ],
  });

  assert.deepEqual(required, ['write_spec_document']);
});

test('moncho no exige tool en charla normal', () => {
  const required = resolveRequiredToolNames({
    agentId: 'moncho',
    allowedToolNames: ['write_spec_document', 'inspect_workspace_path'],
    messages: [
      { role: 'user', content: 'Moncho, que opinas del scope?' },
    ],
  });

  assert.deepEqual(required, []);
});

test('detecta tool requerida ausente', () => {
  const missing = findMissingRequiredToolNames(
    ['write_spec_document'],
    [{ name: 'inspect_workspace_path', arguments: { path: 'docs/specs/projects/foo/Unified-PRD.md' } }],
  );

  assert.deepEqual(missing, ['write_spec_document']);
  assert.throws(
    () => assertRequiredToolCalls(
      ['write_spec_document'],
      [{ name: 'inspect_workspace_path', arguments: { path: 'docs/specs/projects/foo/Unified-PRD.md' } }],
    ),
    /Required tool call missing: write_spec_document/,
  );
});

test('acepta cuando la tool requerida si fue llamada', () => {
  assert.doesNotThrow(() => {
    assertRequiredToolCalls(
      ['write_spec_document'],
      [{ name: 'write_spec_document', arguments: { path: 'projects/foo/Unified-PRD.md', content: '# PRD' } }],
    );
  });
});
