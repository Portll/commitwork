// monitor/test/timeline-corrupt-slice.test.mjs — the slice-read path must never let a slice
// vanish silently: ENOENT is legitimate and silent; anything else renders as an explicit
// `unreadable` column. sliceSha256 is three-state: verified / unreadable / unverified-legacy
// (absent hash, never alarmed). Runs the real timeline.mjs and reads the embedded payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const TIMELINE = join(CW, 'monitor', 'timeline.mjs');

const T = (h) => new Date(Date.UTC(2026, 7, 1, h)).toISOString();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// one real v1 slice — the "good data untouched" control; all readable slices share repo alpha
// so they land on one project page
function sliceBody(sliceId, i, vulnId) {
  return JSON.stringify({
    sliceVersion: 1, sliceId, generated: T(i), kind: 'sweep',
    toolRuns: { alpha: { osv: 1 } }, scope: { repos: ['alpha'] },
    totals: { crit: 0, high: 1, med: 0, low: 0, cves: 1 },
    counts: { born: 1, cleaned: 0, unconfirmed: 0, accepted: 0, carried: 0 },
    findings: [{ repo: 'alpha', id: vulnId, package: 'lodash', severity: 'high', state: 'persisting', key: `alpha|osv|${vulnId}|lodash|` }],
    resolved: [], carried: [], anchors: {},
  });
}

// Fixture history: five index rows exercising every branch of the read —
//   sweep-1  good slice,  NO sliceSha256                  -> unverified-legacy (today's real shape)
//   sweep-2  good slice,  sliceSha256 matches the bytes    -> verified
//   sweep-3  truncated mid-write JSON                      -> unreadable (parse failure)
//   sweep-4  valid JSON,  sliceSha256 does NOT match        -> unreadable (mismatch, same state as sweep-3)
//   sweep-5  index row names a file that was NEVER written -> absent entirely (ENOENT, legitimate)
function mkOut(root) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'history'), { recursive: true });

  const s1 = sliceBody('sweep-1', 0, 'GHSA-1');
  const s2 = sliceBody('sweep-2', 1, 'GHSA-2');
  const s4 = sliceBody('sweep-4', 3, 'GHSA-4'); // valid content, but the index will lie about its hash

  writeFileSync(join(out, 'history', 'sweep-1.json'), s1);
  writeFileSync(join(out, 'history', 'sweep-2.json'), s2);
  writeFileSync(join(out, 'history', 'sweep-3.json'), '{"sliceVersion":1,"sliceId":"sweep-3","findings":[{'); // truncated mid-object, the F2 shape
  writeFileSync(join(out, 'history', 'sweep-4.json'), s4);
  // sweep-5.json is deliberately never written — the index references it, disk does not have it.

  const idx = [
    { stamp: '20260801000000', sliceId: 'sweep-1', sliceVersion: 1, file: 'sweep-1.json', generated: T(0) },
    { stamp: '20260801010000', sliceId: 'sweep-2', sliceVersion: 1, file: 'sweep-2.json', generated: T(1), sliceSha256: sha256(Buffer.from(s2)) },
    { stamp: '20260801020000', sliceId: 'sweep-3', sliceVersion: 1, file: 'sweep-3.json', generated: T(2) },
    { stamp: '20260801030000', sliceId: 'sweep-4', sliceVersion: 1, file: 'sweep-4.json', generated: T(3), sliceSha256: 'f'.repeat(64) /* deliberately wrong */ },
    { stamp: '20260801040000', sliceId: 'sweep-5', sliceVersion: 1, file: 'sweep-5.json', generated: T(4) },
  ];
  writeFileSync(join(out, 'history', 'index.json'), JSON.stringify(idx));
  writeFileSync(join(out, 'remediation-ledger.json'), JSON.stringify({ entries: [] }));
  return out;
}

// minimal single-good-slice fixture — keeps ledger tests' stderr free of corrupt-slice diagnostics
function mkMinimalOut(root) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'history'), { recursive: true });
  writeFileSync(join(out, 'history', 'sweep-1.json'), sliceBody('sweep-1', 0, 'GHSA-1'));
  writeFileSync(join(out, 'history', 'index.json'), JSON.stringify([
    { stamp: '20260801000000', sliceId: 'sweep-1', sliceVersion: 1, file: 'sweep-1.json', generated: T(0) },
  ]));
  return out;
}

function readPayload(out) {
  const html = readFileSync(join(out, 'timeline.html'), 'utf8');
  const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the page must embed its data');
  return JSON.parse(m[1].replace(/<\\\//g, '</'));
}

function run(out, root) {
  const env = { ...process.env, CW_MONITOR_OUT: out, CW_ISSUES: join(root, 'never-written-issues.json') };
  return spawnSync(process.execPath, [TIMELINE], { env, encoding: 'utf8' });
}

function build(root) {
  const out = mkOut(root);
  const r = run(out, root);
  return { r, out, read: () => readPayload(out) };
}

test('a genuinely absent slice (ENOENT) is skipped silently — pruned v0 slices are legitimate', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const b = build(root);
    assert.equal(b.r.status, 0, `timeline.mjs must build despite the corrupt/mismatched slices: ${b.r.stderr}`);
    const d = b.read();
    assert.ok(!d.slices.some((sl) => sl.sliceId === 'sweep-5'), 'an ENOENT slice never appears — not as data, not as unreadable');
    assert.ok(!(d.corruptSlices || []).some((c) => c.sliceId === 'sweep-5'), 'ENOENT is not a corruption — it must not be flagged either');
    assert.doesNotMatch(b.r.stderr, /sweep-5/, 'a pruned slice raises no diagnostic at all');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a truncated/corrupt slice renders as an explicit unreadable state — never absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const d = build(root).read();
    const sl = d.slices.find((s) => s.sliceId === 'sweep-3');
    assert.ok(sl, 'the corrupt slice keeps its column — it must not vanish from history');
    assert.equal(sl.unreadable, true);
    assert.equal(sl.verify, 'unreadable');
    assert.deepEqual(sl.cells, {}, 'no per-repo state is invented for a slice that could not be read');
    assert.equal(sl.findings, null, 'null, not [] — an empty array here would read as a PROVEN zero in the diff/worldline views');
    const rec = (d.corruptSlices || []).find((c) => c.sliceId === 'sweep-3');
    assert.ok(rec, 'collected into corruptSlices[]');
    assert.equal(rec.file, 'sweep-3.json');
    assert.ok(rec.error, 'the error is named, not just the fact of failure');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a sliceSha256 MISMATCH is the SAME unreadable state as a parse failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const d = build(root).read();
    const sl = d.slices.find((s) => s.sliceId === 'sweep-4');
    assert.ok(sl, 'a hash-mismatched slice still keeps its column');
    assert.equal(sl.unreadable, true, 'valid JSON is not the same as TRUSTED JSON');
    assert.equal(sl.verify, 'unreadable');
    assert.equal(sl.findings, null);
    assert.deepEqual(sl.cells, {}, 'the parsed content is discarded wholesale on a hash mismatch, not partially trusted');
    const rec = d.corruptSlices.find((c) => c.sliceId === 'sweep-4');
    assert.ok(rec, 'a mismatch is collected exactly like a parse failure');
    assert.match(rec.error, /sha256|hash|mismatch/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a verified slice (sliceSha256 present and matching) renders verified, with its real data intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const d = build(root).read();
    const sl = d.slices.find((s) => s.sliceId === 'sweep-2');
    assert.ok(sl);
    assert.equal(sl.verify, 'verified');
    assert.ok(!sl.unreadable);
    assert.ok(sl.cells.alpha, 'good data is untouched by the verify machinery');
    assert.equal(sl.cells.alpha.high, 1);
    assert.ok(!d.corruptSlices.some((c) => c.sliceId === 'sweep-2'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pre-existing slice with NO sliceSha256 recorded renders unverified-legacy, and raises zero alarms', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const b = build(root);
    const d = b.read();
    const sl = d.slices.find((s) => s.sliceId === 'sweep-1');
    assert.ok(sl);
    assert.equal(sl.verify, 'unverified-legacy', 'absent hash is its OWN state — never verified, never unreadable');
    assert.ok(!sl.unreadable);
    assert.ok(sl.cells.alpha, 'good data is untouched — the legacy tier still renders its real findings');
    assert.equal(sl.cells.alpha.high, 1);

    // zero alarms: not in corruptSlices, not treated as a problem in stderr
    assert.ok(!(d.corruptSlices || []).some((c) => c.sliceId === 'sweep-1'));
    assert.doesNotMatch(b.r.stderr, /sweep-1 is unreadable/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the fleet-grid legend names the unreadable state explicitly (frontend wiring, not just data)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const b = build(root);
    const html = readFileSync(join(b.out, 'timeline.html'), 'utf8');
    assert.match(html, /unreadable \(corrupt \/ hash mismatch/, 'the legend describes the state, not just a class name');
    assert.match(html, /cell unreadable/, 'the grid CSS/JS actually wires the unreadable cell class');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── remediation-ledger read: same ENOENT-vs-corrupt split, one level up ───────────────────────
test('a CORRUPT remediation ledger warns loudly, names the consequence, and does not take the build down', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const out = mkMinimalOut(root);
    writeFileSync(join(out, 'remediation-ledger.json'), 'not json{{{');
    const r = run(out, root);
    assert.equal(r.status, 0, 'a corrupt ledger must not take the whole timeline down — only the ledger-derived series degrade');
    assert.match(r.stderr, /remediation-ledger\.json.*unreadable/i, 'warns loudly, naming the file');
    assert.match(r.stderr, /cleaned.*(zero|flat)/i, 'and names the consequence: the cleaned series silently flatlining');
    const d = readPayload(out);
    assert.equal(d.ledgerUnreadable, true);
    assert.equal(d.ledger.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── history/index.json read: the history store beneath every view. Corrupt must never surface as
// "no history": the absent-path advice (run a rollup) is destructive on a corrupt index — rollup
// swallows the same read, starts from empty, and rewrites the index with one row.
function mkBareOut(root, indexContent) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'history'), { recursive: true });
  if (indexContent !== undefined) writeFileSync(join(out, 'history', 'index.json'), indexContent);
  return out;
}

test('a CORRUPT history/index.json is named unreadable — never "no history", never "run a rollup"', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const r = run(mkBareOut(root, 'not json{{{'), root);
    assert.notEqual(r.status, 0, 'nothing can render over an unreadable index');
    assert.match(r.stderr, /index\.json.*unreadable/i, 'names the file and the state');
    assert.doesNotMatch(r.stderr, /no history\/index\.json/, 'corrupt is not absent');
    assert.doesNotMatch(r.stderr, /run a rollup first/i, 'must not recommend the path that erases the index');
    assert.match(r.stderr, /do NOT re-run a rollup/, 'and warns against it explicitly');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an ABSENT history/index.json (ENOENT) keeps the legitimate message — run a rollup first', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const r = run(mkBareOut(root), root); // history/ exists, index.json never written
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no history\/index\.json.*run a rollup/i, 'absent stays the friendly first-run state');
    assert.doesNotMatch(r.stderr, /unreadable/i, 'ENOENT is not a corruption');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a parsed-but-non-array index is corrupt-shaped — not empty, and no rollup advice', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const r = run(mkBareOut(root, '{"rows":[]}'), root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not an array/i);
    assert.doesNotMatch(r.stderr, /run a rollup/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a valid EMPTY index reads as no rows yet — appending to it is safe, so rollup advice is honest', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const r = run(mkBareOut(root, '[]'), root);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /holds no rows.*run a rollup/i);
    assert.doesNotMatch(r.stderr, /unreadable/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an ABSENT remediation ledger (ENOENT) stays silent — a fresh OUT dir has no ledger yet', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-corrupt-'));
  try {
    const out = mkMinimalOut(root); // mkMinimalOut never writes remediation-ledger.json at all
    const r = run(out, root);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /remediation-ledger/i, 'ENOENT is legitimate and silent — no warning at all');
    const d = readPayload(out);
    assert.equal(d.ledgerUnreadable, false);
    assert.equal(d.ledger.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
