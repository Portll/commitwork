// bin/test/eval-delta.test.mjs — the lifecycle diff: refuse-don't-coerce, regression alarms,
// vanished-dimension alarms, structured-only residual linkage, linkage-UNKNOWN on unreadable backlog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeDimension, diffDimensions, collectResiduals, checkLinkage, loadArtifact } from '../eval-delta.mjs';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'eval-delta-'));
const put = (name, doc) => { const p = join(dir, name); writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc)); return p; };
const TOOL = fileURLToPath(new URL('../eval-delta.mjs', import.meta.url));
const run = (args) => { try { return { out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8' }), code: 0 }; } catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status }; } };

test('normalizer accepts all three shipped shapes and nothing else', () => {
  assert.equal(normalizeDimension('a', 7.5), 7.5);
  assert.equal(normalizeDimension('a', { after: 8, before: 3 }), 8);
  assert.equal(normalizeDimension('a', { score: 6.5 }), 6.5);
  assert.throws(() => normalizeDimension('a', 'high'), /refusing to coerce/);
  assert.throws(() => normalizeDimension('a', null), /refusing to coerce/);
  assert.throws(() => normalizeDimension('a', [7]), /refusing to coerce/);
});

test('a dropped dimension is REGRESSED; a removed one is VANISHED — both alarm (exit 2)', () => {
  const base = put('b1.json', { dimensions: { x: 5, y: 5, z: 5 } });
  const cur = put('c1.json', { dimensions: { x: 6, y: 4 } });
  const r = run([base, cur, '--backlog', join(dir, 'nope.md')]);
  assert.equal(r.code, 2);
  assert.match(r.out, /y: 5 → 4.*REGRESSED/);
  assert.match(r.out, /z: 5 → VANISHED/);
});

test('a new dimension is reported, never alarmed', () => {
  const base = put('b2.json', { dimensions: { x: 5 } });
  const cur = put('c2.json', { dimensions: { x: 5, w: 9 } });
  const backlog = put('bk2.md', '| A | filed |');
  const r = run([base, cur, '--backlog', backlog]);
  assert.equal(r.code, 0);
  assert.match(r.out, /w: \(new\) → 9/);
});

test('mixed shapes compare (baseline bare numbers vs rescore {after}) — the real shipped seam', () => {
  const { rows, totals } = diffDimensions(
    { dimensions: { a: 3.0, b: 8.5 } },
    { dimensions: { a: { before: 3.0, after: 8.5 }, b: { after: 9.0 } } },
  );
  assert.deepEqual(rows.map((r) => r.state), ['improved', 'improved']);
  assert.equal(totals.before, 11.5);
  assert.equal(totals.after, 17.5);
});

test('corrupt artifact refuses (exit 4), never an empty comparison', () => {
  const base = put('b3.json', '{"dimensions": {truncated');
  const cur = put('c3.json', { dimensions: { x: 5 } });
  const r = run([base, cur]);
  assert.equal(r.code, 4);
  assert.match(r.out, /not valid JSON.*refusing/);
});

test('an artifact with no dimensions map refuses — not a scored evaluation', () => {
  assert.throws(() => loadArtifact(put('b4.json', { findings: [] })), /no dimensions map/);
});

test('residuals: unlinked counts and names (exit 3); linked refs pass; missing refs flagged', () => {
  const base = put('b5.json', { dimensions: { x: 5 } });
  const cur = put('c5.json', {
    dimensions: { x: { after: 6, residual: 'panel rendering missing', backlog: 'R' } },
    followOnBridge: [{ rank: 1, item: 'unfiled thing with no ref' }],
  });
  const backlog = put('bk5.md', '| R | panel rendering |\n| T | match count |');
  const r = run([base, cur, '--backlog', backlog]);
  assert.equal(r.code, 3);
  assert.match(r.out, /1 linked/);
  assert.match(r.out, /1 UNLINKED/);
  const ref = checkLinkage([{ source: 's', text: 't', ref: 'Z' }], backlog);
  assert.equal(ref.missingRefs.length, 1);
});

test('nonActionable residuals are ACCEPTED — counted, named, never alarmed (exit 0)', () => {
  const base = put('b10.json', { dimensions: { x: 5 } });
  const cur = put('c10.json', { dimensions: { x: { after: 6, residual: 'anchors unsigned — out of threat model', nonActionable: true } } });
  const backlog = put('bk10.md', '| A | x |');
  const r = run([base, cur, '--backlog', backlog]);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 accepted \(non-actionable, stated\)/);
});

test('unreadable backlog → linkage UNKNOWN, never "all filed" (exit 3)', () => {
  const base = put('b6.json', { dimensions: { x: 5 } });
  const cur = put('c6.json', { dimensions: { x: { after: 6, residual: 'a gap', backlog: 'R' } } });
  const r = run([base, cur, '--backlog', join(dir, 'missing-backlog.md'), '--json']);
  assert.equal(r.code, 3);
  const doc = JSON.parse(r.out);
  assert.equal(doc.residuals.linkage.state, 'linkage-unknown');
  assert.equal(doc.residuals.linkage.linked.length, 0, 'an unreadable backlog must link NOTHING');
});

test('clean pass: no regressions, no residuals → exit 0; deterministic under CW_NOW', () => {
  const base = put('b7.json', { dimensions: { x: 5 } });
  const cur = put('c7.json', { dimensions: { x: 7 } });
  const backlog = put('bk7.md', '| A | x |');
  const env = { ...process.env, CW_NOW: '2026-08-11T00:00:00.000Z' };
  const one = execFileSync('node', [TOOL, base, cur, '--backlog', backlog, '--json'], { encoding: 'utf8', env });
  const two = execFileSync('node', [TOOL, base, cur, '--backlog', backlog, '--json'], { encoding: 'utf8', env });
  assert.equal(one, two);
  assert.equal(JSON.parse(one).generated, '2026-08-11T00:00:00.000Z');
});

// A FULL-SIZE SHIPPED-SHAPE PAIR, synthetic on purpose: shipping the real evaluations/ artifacts
// would disclose what the audit quotes. The fixtures reproduce the SHAPE (18 dimensions, bare
// numbers vs all three object variants); the guard below stops a future edit flattening them.
const FIXTURE = (name) => fileURLToPath(new URL(`./fixtures/eval-delta/${name}`, import.meta.url));

test('a full shipped-shape pair compares without refusal (18 dims, bare numbers vs all three object variants)', () => {
  const base = loadArtifact(FIXTURE('baseline.json'));
  const cur = loadArtifact(FIXTURE('rescore.json'));

  // the fixture must keep carrying every shape the normalizer has to survive
  const baseVals = Object.values(base.dimensions);
  const curVals = Object.values(cur.dimensions);
  assert.ok(baseVals.every((v) => typeof v === 'number'), 'baseline fixture must be bare numbers');
  assert.equal(curVals.length, 18);
  assert.ok(curVals.every((v) => v && typeof v === 'object'), 'rescore fixture must be objects');
  assert.ok(curVals.some((v) => 'backlog' in v && 'residual' in v), 'rescore fixture must carry a backlog-linked residual');
  assert.ok(curVals.some((v) => !('backlog' in v) && !v.nonActionable), 'rescore fixture must carry an unlinked residual');
  assert.ok(curVals.some((v) => v.nonActionable === true), 'rescore fixture must carry a nonActionable dimension');

  const { rows, totals } = diffDimensions(base, cur);
  assert.equal(rows.length, 18);
  assert.ok(rows.every((r) => r.state === 'improved' || r.state === 'unchanged'), 'an executed arc must show no regressions');
  assert.equal(totals.regressed, 0);
  assert.equal(totals.vanished, 0);
  assert.ok(rows.some((r) => r.state === 'unchanged'), 'a zero delta must read as unchanged, never as a regression');
});
