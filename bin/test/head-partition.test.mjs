import test from 'node:test';
import assert from 'node:assert/strict';
import { filesForNames, headPlan, targetedCmd } from '../lib/head-partition.mjs';

const FILES = ['a.test.mjs', 'b.test.mjs', 'c.test.mjs'];
const SRC = {
  'a.test.mjs': "test('alpha holds', () => {});\ntest('shared name', () => {});",
  'b.test.mjs': "test('beta holds', () => {});",
  'c.test.mjs': "test('shared name', () => {});",
};
const read = (f) => (f in SRC ? SRC[f] : null);

test('a failing name resolves to the file that declares it', () => {
  const r = filesForNames(['alpha holds'], FILES, read);
  assert.deepEqual(r.files, ['a.test.mjs']);
  assert.deepEqual(r.unresolved, []);
});

test('a name declared in two files selects BOTH — an extra file is cheap, a dropped one is not', () => {
  const r = filesForNames(['shared name'], FILES, read);
  assert.deepEqual(r.files, ['a.test.mjs', 'c.test.mjs']);
  assert.equal(r.ambiguous.length, 1);
});

test('an unlocatable name is reported, never silently dropped', () => {
  const r = filesForNames(['no such test'], FILES, read);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.unresolved, ['no such test']);
});

test('an UNREADABLE file is not treated as a non-match', () => {
  const boom = (f) => { if (f === 'b.test.mjs') throw new Error('EACCES'); return read(f); };
  const r = filesForNames(['alpha holds'], FILES, boom);
  assert.deepEqual(r.files, ['a.test.mjs'], 'the readable files still resolve');
});

test('NO failures means the HEAD worktree is never created', () => {
  const p = headPlan([], FILES, read);
  assert.equal(p.mode, 'skip');
  assert.deepEqual(p.files, []);
});

test('failures that all resolve produce a TARGETED run', () => {
  const p = headPlan(['alpha holds', 'beta holds'], FILES, read);
  assert.equal(p.mode, 'targeted');
  assert.deepEqual(p.files, ['a.test.mjs', 'b.test.mjs']);
});

test('ONE unresolved name forces the FULL suite — a partial mapping must not become an attribution', () => {
  const p = headPlan(['alpha holds', 'no such test'], FILES, read);
  assert.equal(p.mode, 'full',
    'partitioning from an incomplete mapping would call a committed failure uncommitted, which blames whoever stopped last');
  assert.equal(p.unresolved.length, 1);
});

test('the targeted command quotes every path and keeps concurrency 1', () => {
  const cmd = targetedCmd(['a b.test.mjs', 'c.test.mjs']);
  assert.match(cmd, /^node --test --test-concurrency=1 /);
  assert.match(cmd, /"a b\.test\.mjs"/, 'a path with a space must survive the command string');
  assert.match(cmd, /"c\.test\.mjs"/);
});

test('duplicate failing names are collapsed before searching', () => {
  const r = filesForNames(['alpha holds', 'alpha holds'], FILES, read);
  assert.deepEqual(r.files, ['a.test.mjs']);
});

test('empty and blank names are ignored rather than matching everything', () => {
  const r = filesForNames(['', '   '], FILES, read);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.unresolved, []);
});
