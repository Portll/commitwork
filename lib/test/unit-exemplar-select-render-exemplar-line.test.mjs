// Formats a single exemplar line with verdict, rule or identity, and reason (lib/exemplar-select.mjs renderExemplarLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderExemplarLine } from '../exemplar-select.mjs';

test('renders a line with both rule and identity present', () => {
  const e = { verdict: 'pass', rule: 'r1', identity: 'i1', reason: 'ok' };
  const r = renderExemplarLine(e);
  assert.equal(r, "- [pass] r1 \u2014 prior disposition: ok");
});

test('falls back to identity when rule is null', () => {
  const e = { verdict: 'fail', rule: null, identity: 'i2', reason: 'bad' };
  const r = renderExemplarLine(e);
  assert.equal(r, "- [fail] i2 \u2014 prior disposition: bad");
});

test('falls back to identity when rule is undefined', () => {
  const e = { verdict: 'warn', identity: 'i3', reason: 'meh' };
  const r = renderExemplarLine(e);
  const expected = '- [warn] i3 \u2014 prior disposition: meh';
  assert.equal(r, expected);
});

test('uses rule when rule is an empty string', () => {
  const e = { verdict: 'pass', rule: '', identity: 'i4', reason: 'ok' };
  const r = renderExemplarLine(e);
  const expected = '- [pass]  \u2014 prior disposition: ok';
  assert.equal(r, expected);
});

test('uses rule when rule is zero', () => {
  const e = { verdict: 'fail', rule: 0, identity: 'i5', reason: 'err' };
  const r = renderExemplarLine(e);
  const expected = '- [fail] 0 \u2014 prior disposition: err';
  assert.equal(r, expected);
});

test('uses rule when rule is false', () => {
  const e = { verdict: 'warn', rule: false, identity: 'i6', reason: 'note' };
  const r = renderExemplarLine(e);
  const expected = '- [warn] false \u2014 prior disposition: note';
  assert.equal(r, expected);
});

test('renders with empty reason string', () => {
  const e = { verdict: 'pass', rule: 'r7', identity: 'i7', reason: '' };
  const r = renderExemplarLine(e);
  const expected = '- [pass] r7 \u2014 prior disposition: ';
  assert.equal(r, expected);
});

test('renders with long repeated reason', () => {
  const reason = 'x'.repeat(50);
  const e = { verdict: 'fail', rule: 'r8', identity: 'i8', reason };
  const r = renderExemplarLine(e);
  const expected = `- [fail] r8 \u2014 prior disposition: ${reason}`;
  assert.equal(r, expected);
});
