// The id of the first scanner quirk that explains a notification, or null (monitor/scanner-quirks.mjs classifyNotification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNotification } from '../scanner-quirks.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.CW_SCANNER_QUIRKS_OFF;

function loadDoc(content) {
  const dir = mkdtempSync(join(tmpdir(), 'classifyNotification-'));
  try {
    const path = join(dir, 'scanner-quirks.json');
    writeFileSync(path, JSON.stringify(content));
    return JSON.parse(readFileSync(path, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Returns null when CW_SCANNER_QUIRKS_OFF is 1 even though a quirk would match', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-off', match: { notificationId: 'semgrep' } }] });
  const input = { descriptor: { id: 'semgrep' }, message: { text: 'semgrep crashed' } };
  process.env.CW_SCANNER_QUIRKS_OFF = '1';
  try {
    const result = classifyNotification(input, { doc });
    assert.equal(result, null);
  } finally {
    delete process.env.CW_SCANNER_QUIRKS_OFF;
  }
});

test('Matches a notificationId case-insensitively against the descriptor id when the message does not mention it', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-desc', match: { notificationId: 'SemGrep' } }] });
  const input = { descriptor: { id: 'semgrep-parse' }, message: { text: 'parse failed' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-desc');
});

test('Falls back to the top-level id when the notification has no descriptor id', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-top', match: { notificationId: 'semgrep' } }] });
  const input = { id: 'semgrep-timeout', message: { text: 'timed out' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-top');
});

test('Skips an anyOf quirk with no hit and matches the next one whose set contains the id', () => {
  const doc = loadDoc({
    version: 1,
    quirks: [
      { id: 'q-miss', match: { notificationIdAnyOf: ['eslint'] } },
      { id: 'q-any', match: { notificationIdAnyOf: ['semgrep-a', 'semgrep-b', 'semgrep-c'] } },
    ],
  });
  const input = { descriptor: { id: 'semgrep-b' }, message: { text: 'parse error' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-any');
});

test('Matches messageContains case-sensitively against the message text', () => {
  const doc = loadDoc({
    version: 1,
    quirks: [
      { id: 'q-case', match: { messageContains: 'segmentation fault' } },
      { id: 'q-text', match: { messageContains: 'Segmentation fault' } },
    ],
  });
  const input = { descriptor: { id: 'scanner' }, message: { text: 'Segmentation fault in parser' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-text');
});

test('Reads a plain string message when the message has no text field', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-str', match: { messageContains: 'Segmentation fault' } }] });
  const input = { id: 'scanner', message: 'Segmentation fault in parser' };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-str');
});

test('An empty rules list does not narrow the quirk so a message without a rule still matches', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-empty', match: { notificationId: 'semgrep' }, rules: [] }] });
  const input = { descriptor: { id: 'semgrep' }, message: { text: 'crash without a rule name' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-empty');
});

test('Returns null when the running rule is not in the quirk rules list', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-narrow', match: { notificationId: 'semgrep' }, rules: ['rule-a'] }] });
  const input = { descriptor: { id: 'semgrep' }, message: { text: 'crash running rule-b' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, null);
});

test('Matches a narrowed quirk when the running rule is in its rules list', () => {
  const doc = loadDoc({ version: 1, quirks: [{ id: 'q-narrow', match: { notificationId: 'semgrep' }, rules: ['rule-a'] }] });
  const input = { descriptor: { id: 'semgrep' }, message: { text: 'crash running rule-a now' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, 'q-narrow');
});

test('Returns null when the quirks document has no quirks property', () => {
  const doc = loadDoc({ version: 1 });
  const input = { descriptor: { id: 'semgrep' }, message: { text: 'crash running rule-a' } };
  const result = classifyNotification(input, { doc });
  assert.equal(result, null);
});
