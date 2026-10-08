// lib/test/exemplar-select-units.test.mjs — case tests for renderExemplarLine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExemplarLine } from '../exemplar-select.mjs';

test('renders a line with rule, verdict, and reason', () => {
  const e = { identity: 'sc:repo|cat|rule|file|1', rule: 'rule', verdict: 'true-alarm', reason: 'valid' };
  assert.equal(renderExemplarLine(e), '- [true-alarm] rule — prior disposition: valid');
});

test('falls back to identity when rule is null', () => {
  const e = { identity: 'sc:repo|cat|rule|file|1', rule: null, verdict: 'false-alarm', reason: 'invalid' };
  assert.equal(renderExemplarLine(e), '- [false-alarm] sc:repo|cat|rule|file|1 — prior disposition: invalid');
});

test('falls back to identity when rule is undefined', () => {
  const e = { identity: 'f:pkg', rule: undefined, verdict: 'true-alarm', reason: 'cve' };
  assert.equal(renderExemplarLine(e), '- [true-alarm] f:pkg — prior disposition: cve');
});

test('renders with empty reason string', () => {
  const e = { identity: 'id1', rule: 'r1', verdict: 'true-alarm', reason: '' };
  assert.equal(renderExemplarLine(e), '- [true-alarm] r1 — prior disposition: ');
});
