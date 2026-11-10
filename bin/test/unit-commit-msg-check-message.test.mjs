// Validates commit message format and forbidden trailers (bin/commit-msg.mjs checkMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMessage } from '../commit-msg.mjs';

test('rejects messages with Co-Authored-By trailers', () => {
  const input = 'feat: add feature\n\nBody\n\nCo-Authored-By: Someone <someone@example.com>';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: false, lines: ["commit-msg: REFUSED. The message carries a Co-Authored-By trailer, which is forbidden here."] });
});

test('accepts fixup! messages without validation', () => {
  const input = 'fixup! feat: add feature';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: true });
});

test('accepts squash! messages without validation', () => {
  const input = 'squash! fix: correct bug';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: true });
});

test('accepts amend! messages without validation', () => {
  const input = 'amend! docs: update readme';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: true });
});

test('rejects invalid rules name', () => {
  const input = 'feat: add feature';
  const result = checkMessage(input, 'invalid-rules');
  assert.deepEqual(result, { ok: false, lines: ["commit-msg: REFUSED. commitwork.rules names 'invalid-rules', and the rule sets are commitwork, cobolwork, ironwork, cobolwork-web, spine."] });
});

test('accepts valid conventional commit message', () => {
  const input = 'feat: add feature\n\nThis adds the feature.\n\nRefs: #123';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: true });
});

test('rejects invalid conventional commit message', () => {
  const input = 'invalid message without type';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: false, lines: ["commit-msg: REFUSED. The message does not meet the commitwork commit rules.", "  subject was: \"invalid message without type\"\n  \u00b7 [clause 1,5] subject does not match `<type>[(scope)][!]: <description>` \u2014 no `<type>: ` prefix was found\n      fix: e.g. `fix(mcp): reject arguments that do not match the published schema`", "  Shape: <type>(<scope>)[!]: <imperative verb> \u2026 (\u226472 chars), blank line, body, blank line, footers."] });
});

test('rejects message with scope but missing type', () => {
  const input = '(scope) add feature';
  const result = checkMessage(input);
  assert.deepEqual(result, { ok: false, lines: ["commit-msg: REFUSED. The message does not meet the commitwork commit rules.", "  subject was: \"(scope) add feature\"\n  \u00b7 [clause 1,5] subject does not match `<type>[(scope)][!]: <description>` \u2014 no `<type>: ` prefix was found\n      fix: e.g. `fix(mcp): reject arguments that do not match the published schema`", "  Shape: <type>(<scope>)[!]: <imperative verb> \u2026 (\u226472 chars), blank line, body, blank line, footers."] });
});
