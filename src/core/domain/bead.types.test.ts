import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESIGN_BEADS_FROM_SPEC_TOOL,
  buildBeadFileName,
  normalizeBeadDesignMode,
  normalizeBeadPriority,
  slugifyBeadTitle,
} from './bead.types.js';

test('bead contract constants stay stable', () => {
  assert.equal(DESIGN_BEADS_FROM_SPEC_TOOL, 'design_beads_from_spec');
});

test('normalizeBeadPriority defaults to medium for unknown values', () => {
  assert.equal(normalizeBeadPriority(undefined), 'medium');
  assert.equal(normalizeBeadPriority('HIGH'), 'high');
  assert.equal(normalizeBeadPriority('urgent'), 'medium');
});

test('normalizeBeadDesignMode defaults to append', () => {
  assert.equal(normalizeBeadDesignMode(undefined), 'append');
  assert.equal(normalizeBeadDesignMode('replace'), 'replace');
  assert.equal(normalizeBeadDesignMode('APPEND'), 'append');
  assert.equal(normalizeBeadDesignMode('random'), 'append');
});

test('slugifyBeadTitle builds stable kebab-case slugs', () => {
  assert.equal(slugifyBeadTitle('Add Project Backlog View'), 'add-project-backlog-view');
  assert.equal(slugifyBeadTitle('  Stage 2: Poncho / Decomposition  '), 'stage-2-poncho-decomposition');
});

test('buildBeadFileName produces bead naming convention', () => {
  assert.equal(buildBeadFileName(1, 'Add Project Backlog View'), 'bead-01-add-project-backlog-view.md');
  assert.equal(buildBeadFileName(12, '  '), 'bead-12-untitled.md');
});
