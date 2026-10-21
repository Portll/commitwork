// lib/test/cobolwork-remediation-units.test.mjs — case tests for reviewPrompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPrompt } from '../cobolwork-remediation.mjs';

test('returns a string that opens with the reviewer instruction', () => {
  const packet = { finding: { id: 'F1' }, hops: [], sink: { line: 10 } };
  const diff = '+  MOVE X TO Y';
  const gateDoc = { verdict: 'pass', outcome: 'ok' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.equal(typeof out, 'string');
  assert.match(out, /^You review a drafted fix/);
});

test('includes the gate verdict and outcome in the expected format', () => {
  const packet = { finding: {}, hops: [], sink: {} };
  const diff = 'a';
  const gateDoc = { verdict: 'fail', outcome: 'blocked' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.ok(out.includes('# The gate\'s verdict: fail (blocked)'));
});

test('asks for JSON with the two keys its reader parses', () => {
  const packet = { finding: {}, hops: [], sink: {} };
  const diff = 'b';
  const gateDoc = { verdict: 'pass', outcome: 'ok' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.match(out, /Respond ONLY with JSON/);
  assert.match(out, /"agrees": boolean/);
  assert.match(out, /"concerns": string/);
});

test('includes the diff content', () => {
  const packet = { finding: {}, hops: [], sink: {} };
  const diff = 'UNIQUE_DIFF_MARKER_12345';
  const gateDoc = { verdict: 'pass', outcome: 'ok' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.ok(out.includes('UNIQUE_DIFF_MARKER_12345'));
});

test('includes the finding, hops, and sink from the packet', () => {
  const packet = { finding: { id: 'F42' }, hops: [{ step: 1 }], sink: { line: 99 } };
  const diff = 'c';
  const gateDoc = { verdict: 'pass', outcome: 'ok' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.ok(out.includes('F42'));
  assert.ok(out.includes('"step": 1'));
  assert.ok(out.includes('"line": 99'));
});

test('joins sections with newlines', () => {
  const packet = { finding: {}, hops: [], sink: {} };
  const diff = 'd';
  const gateDoc = { verdict: 'pass', outcome: 'ok' };
  const out = reviewPrompt({ packet, diff, gateDoc });
  assert.ok(out.includes('\n\n# The finding and the source it quotes'));
  assert.ok(out.includes('\n\n# The drafted diff'));
  assert.ok(out.includes('\n\n# The gate\'s verdict: pass (ok)'));
});
