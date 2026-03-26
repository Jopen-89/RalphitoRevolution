import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTelegramVisibleText } from './telegramSender.js';

test('sanitizeTelegramVisibleText strips system reminder blocks', () => {
  const sanitized = sanitizeTelegramVisibleText('hola\n<system-reminder>secret</system-reminder>\nadios');

  assert.equal(sanitized, 'hola\n\nadios');
});

test('sanitizeTelegramVisibleText trims and normalizes line endings', () => {
  const sanitized = sanitizeTelegramVisibleText('\r\n  texto util\r\n');

  assert.equal(sanitized, 'texto util');
});
