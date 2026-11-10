// Exit code and JSON report for a provenance scan, with a could-not-run fallback (bin/commit-provenance.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../commit-provenance.mjs';

function run(argv, env) {
  const out = [];
  const err = [];
  const ow = process.stdout.write;
  const ew = process.stderr.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try {
    const code = main(argv, env);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
}

const failed = (reason) => ({
  tool: 'commit-provenance',
  summary: { findings: 0, byRule: {}, filesScanned: 0, commitsScanned: 0, notApplicable: 0, couldNotRun: reason },
  findings: [],
});

const reasonFor = (raw) => `CW_PROVENANCE_DEPTH must be a positive integer, got '${raw}'`;

test('a non-numeric depth returns 2 and emits the could-not-run report with zero counts', () => {
  const r = run(['node', 'commit-provenance.mjs', '/some/repo'], { CW_PROVENANCE_DEPTH: 'abc' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor('abc')));
  assert.equal(r.out, `${JSON.stringify(failed(reasonFor('abc')), null, 2)}\n`);
  assert.equal(r.err, `commit-provenance: could not run \u2014 ${reasonFor('abc')}\n`);
});

test('a depth of zero is rejected with exit code 2', () => {
  const r = run(['node', 'commit-provenance.mjs', '/repo'], { CW_PROVENANCE_DEPTH: '0' });
  assert.equal(r.code, 2);
  assert.equal(r.out, `${JSON.stringify(failed(reasonFor('0')), null, 2)}\n`);
  assert.equal(r.err, `commit-provenance: could not run \u2014 ${reasonFor('0')}\n`);
});

test('a negative depth is rejected with exit code 2', () => {
  const r = run(['node', 'commit-provenance.mjs'], { CW_PROVENANCE_DEPTH: '-1' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor('-1')));
  assert.equal(r.err, `commit-provenance: could not run \u2014 ${reasonFor('-1')}\n`);
});

test('a fractional depth is rejected with exit code 2', () => {
  const r = run(['node', 'commit-provenance.mjs', ''], { CW_PROVENANCE_DEPTH: '2.5' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor('2.5')));
  assert.equal(r.err, `commit-provenance: could not run \u2014 ${reasonFor('2.5')}\n`);
});

test('a whitespace depth counts as zero and is rejected', () => {
  const r = run(['node', 'commit-provenance.mjs', '/repo'], { CW_PROVENANCE_DEPTH: ' ' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor(' ')));
});

test('a non-string repo argument propagates the TypeError from path resolution', () => {
  assert.throws(() => run(['node', 'commit-provenance.mjs', 5], { CW_PROVENANCE_DEPTH: 'abc' }), {
    name: 'TypeError',
    message: 'The "paths[0]" argument must be of type string. Received type number (5)',
  });
});

test('the argument after the repo path is ignored', () => {
  const r = run(['node', 'commit-provenance.mjs', '', 7], { CW_PROVENANCE_DEPTH: 'x' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor('x')));
});

test('a missing repo argument falls back to the current directory and still reports', () => {
  const r = run(['node', 'commit-provenance.mjs', undefined, 9], { CW_PROVENANCE_DEPTH: 'no' });
  assert.equal(r.code, 2);
  assert.deepEqual(JSON.parse(r.out), failed(reasonFor('no')));
  assert.equal(r.err, `commit-provenance: could not run \u2014 ${reasonFor('no')}\n`);
});
