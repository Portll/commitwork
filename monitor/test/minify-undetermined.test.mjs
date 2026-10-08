// minified-source counts as undetermined, never a severity. These pin the EFFECT: the row survives
// (classify, never drop), the buckets do not move, and a lane holding only these is not clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _minifyCounts } from '../extractors.mjs';

const METRICS = { entropy: 5.4, wsRatio: 0.14, bytesPerLineMax: 1305 };
const write = (findings) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-minify-und-'));
  writeFileSync(join(d, 'minify.json'), JSON.stringify({
    tool: 'minify-detect',
    summary: { findings: findings.length, byRule: {}, filesScanned: 12, filesSkipped: [] },
    findings,
  }));
  return d;
};
const row = (rule, sev, path, detail) => ({ rule, path, sev, capped: false, metrics: METRICS, detail });

test('a minified-source row is counted undetermined, not med, and not in total', () => {
  const d = write([row('minified-source', 'med', 'monitor/timeline2.mjs', 'wsRatio=0.059 maxLine=1071')]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.undetermined, 1, 'the readability row lands in undetermined');
    assert.equal(c.med, 0, 'and nowhere in the severity buckets');
    assert.equal(c.total, 0, 'total counts findings, and this is not one');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the row survives — classified, never dropped — with no severity and the producer claim intact', () => {
  const d = write([row('minified-source', 'med', 'monitor/timeline2.mjs', 'wsRatio=0.059 maxLine=1071')]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    const rows = c.findings || [];
    assert.equal(rows.length, 1, 'an excluded finding must stay enumerable');
    assert.equal(rows[0].file, 'monitor/timeline2.mjs');
    assert.equal(rows[0].sev, '', 'giving it a severity would be the assertion again');
    assert.match(rows[0].message, /^UNDETERMINED — /, 'the row says why it is grey');
    assert.match(rows[0].message, /wsRatio=0\.059 maxLine=1071/, 'minify-detect original claim preserved');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the severity rules are untouched — only readability is reclassified', () => {
  const d = write([
    row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3'),
    row('dynamic-exec-nonliteral', 'low', 'map/generate.mjs', 'count=1'),
    row('packer-signature', 'med', 'map/data/client-a/index.html', 'escapes=240'),
    row('minified-source', 'med', 'map/data/client-a/index.html', 'inline script minified'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.high, 1); assert.equal(c.low, 1); assert.equal(c.med, 1);
    assert.equal(c.total, 3, 'three findings, and one measurement that is not one');
    assert.equal(c.undetermined, 1);
    assert.equal((c.findings || []).length, 4, 'all four rows are still readable in the panel');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// explicit uncertainty: the reason `undetermined` is a field rather than a deletion.
test('a lane holding only readability rows reports zero findings AND says it judged nothing', () => {
  const d = write([
    row('minified-source', 'med', 'monitor/timeline2.mjs', 'wsRatio=0.059 maxLine=1071'),
    row('minified-source', 'med', 'monitor/corrected-history.mjs', 'wsRatio=0.14 maxLine=1305'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.total, 0);
    assert.equal(c.crit + c.high + c.med + c.low, 0);
    assert.ok(c.undetermined > 0, 'a zero with an undetermined count beside it is not a clean lane');
    assert.equal(c.ran, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The absent-vs-zero distinction the panel pill depends on (admin/index.html renders c.undetermined
// only when truthy), so a lane with nothing grey must not carry a stray 0.
test('a lane with no readability rows omits the field rather than reporting zero', () => {
  const d = write([row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3')]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.undetermined, undefined);
    assert.equal(c.total, 1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── agent-worktree rows: the same files counted again, classified rather than dropped ───────────
const WT = '.claude/worktrees/agent-a7aa848af9652adb0';

test('a worktree row leaves the headline counts but stays enumerable with its severity', () => {
  const d = write([
    row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3'),
    row('exec-redirection', 'high', `${WT}/admin/index.html`, 'execOpen=0 decode=3'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.high, 1, 'the copy does not double the headline');
    assert.equal(c.total, 1);
    assert.equal(c.worktrees.total, 1);
    assert.equal(c.worktrees.high, 1, 'set aside keeps its severity');
    assert.equal(c.worktrees.rows.length, 1, 'and stays enumerable');
    assert.equal(c.worktrees.rows[0].file, `${WT}/admin/index.html`);
    assert.equal(c.worktrees.rows[0].pattern, '.claude/worktrees');
    assert.equal(c.worktrees.rows[0].name, 'agent-a7aa848af9652adb0');
    // byName must actually be POPULATED — it was silently undefined here while partition()
    // promised it, which a fixture-only test cannot see. Caught by running the real tree.
    assert.deepEqual(c.worktrees.byName, { 'agent-a7aa848af9652adb0': 1 });
    assert.deepEqual(c.worktrees.byPattern, { '.claude/worktrees': 1 });
    assert.equal((c.findings || []).length, 1, 'the published table shows the real tree only');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the set-aside count is published as a fraction of everything scanned', () => {
  const d = write([
    row('minified-source', 'med', 'monitor/timeline2.mjs', 'wsRatio=0.059'),
    row('minified-source', 'med', `${WT}/monitor/timeline2.mjs`, 'wsRatio=0.059'),
    row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.worktrees.of, 3, 'the denominator counts findings + undetermined + set aside');
    assert.match(c.worktrees.note, /1 of 3/);
    assert.match(c.worktrees.note, /remain in minify\.json on disk/);
    assert.equal(c.undetermined, 1, 'the real tree readability row is still undetermined');
    assert.equal(c.total, 1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('worktree classification takes precedence over the undetermined reclassification', () => {
  const d = write([row('minified-source', 'med', `${WT}/monitor/timeline2.mjs`, 'wsRatio=0.059')]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.undetermined, undefined, 'a copy is not judged at all, grey or otherwise');
    assert.equal(c.worktrees.med, 1, 'it is set aside carrying what the producer said');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a lane with no worktree rows omits the field rather than reporting an empty one', () => {
  const d = write([row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3')]);
  try {
    assert.equal(_minifyCounts(d, 'minify.json').worktrees, undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── self-reference: the detector matching its own pattern definitions ───────────────────────────
const selfRow = (rule, file) => ({ ...row(rule, 'high', file, 'execOpen=2 decode=2'), selfReference: 'the detector\'s own pattern vocabulary' });

test('a selfReference row leaves the headline counts but keeps severity and stays enumerable', () => {
  const d = write([
    selfRow('exec-redirection', 'bin/minify-detect.mjs'),
    row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.high, 1, 'the detector reading itself does not inflate the headline');
    assert.equal(c.total, 1);
    assert.equal(c.selfReference.total, 1);
    assert.equal(c.selfReference.high, 1, 'set aside keeps its severity');
    assert.equal(c.selfReference.rows.length, 1, 'and stays enumerable');
    assert.deepEqual(c.selfReference.byFile, { 'bin/minify-detect.mjs': 1 });
    assert.match(c.selfReference.rows[0].why, /pattern vocabulary/);
    assert.match(c.selfReference.note, /1 of 2/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// The consumer must not re-derive the path list — that would be a second authority free to drift
// from the producer's. An UNMARKED row on the same file counts normally.
test('an unmarked finding on the detector itself still counts — the producer decides, not the reader', () => {
  const d = write([row('bidi-homoglyph', 'high', 'bin/minify-detect.mjs', 'bidi=1 mixedScript=0')]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.high, 1, 'a smuggled bidi char in the detector is a real finding');
    assert.equal(c.total, 1);
    assert.equal(c.selfReference, undefined);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the denominator counts every row scanned, across both set-aside piles', () => {
  const d = write([
    selfRow('exec-decode-pair', 'bin/test/minify-detect.test.mjs'),
    row('minified-source', 'med', `${WT}/monitor/timeline2.mjs`, 'wsRatio=0.059'),
    row('minified-source', 'med', 'monitor/timeline2.mjs', 'wsRatio=0.059'),
    row('exec-redirection', 'high', 'admin/index.html', 'execOpen=0 decode=3'),
  ]);
  try {
    const c = _minifyCounts(d, 'minify.json');
    assert.equal(c.total, 1);
    assert.equal(c.undetermined, 1);
    assert.equal(c.worktrees.total, 1);
    assert.equal(c.selfReference.total, 1);
    assert.equal(c.worktrees.of, 4, 'one denominator, every row scanned');
    assert.equal(c.selfReference.of, 4, 'and both piles state the same one');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
