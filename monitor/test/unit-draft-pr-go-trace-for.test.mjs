// Computes a reversed, capped list of qualified function names from a matching trace. (monitor/draft-pr-go.mjs traceFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceFor } from '../draft-pr-go.mjs';

test('returns empty array when stdout is null', () => {
  const r = traceFor(null, 'OSV-1');
  assert.deepEqual(r, []);
});

test('returns empty array when no finding matches the id', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-2', trace: [{ function: 'f' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, []);
});

test('returns empty array when trace entries lack function', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: [{ package: 'p' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, []);
});

test('returns empty array when trace is not an array', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: 'not-an-array' } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, []);
});

test('returns formatted trace with package and function', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: [{ package: 'pkg', function: 'fn' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, ["pkg.fn"]);
});

test('returns formatted trace with receiver', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: [{ package: 'pkg', receiver: 'R', function: 'fn' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, ["pkg.(R).fn"]);
});

test('returns formatted trace using module when package is missing', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: [{ module: 'mod', function: 'fn' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, ["mod.fn"]);
});

test('reverses and caps trace at 8 entries', () => {
  const trace = Array.from({ length: 10 }, (_, i) => ({ package: `p${i}`, function: `f${i}` }));
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, ["p9.f9", "p8.f8", "p7.f7", "p6.f6", "p5.f5", "p4.f4", "p3.f3", "p2.f2"]);
});

test('filters out entries without function before mapping', () => {
  const stdout = JSON.stringify({ finding: { osv: 'OSV-1', trace: [{ package: 'a' }, { package: 'b', function: 'fn' }] } });
  const r = traceFor(stdout, 'OSV-1');
  assert.deepEqual(r, ["b.fn"]);
});
