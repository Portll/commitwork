// ratchet-corroborate — looks at gate-ratchet's clean stratum without turning looking into a
// verdict it cannot support: `steady` is a working-tree claim and re-deriving at headSha measures
// the committed tree, so corroboration is available and confirmation is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { corroborate, queueAt, count } from '../ratchet-corroborate.mjs';

const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const SHA = 'a'.repeat(40);
function fixture(records) {
  const d = mkdtempSync(join(tmpdir(), 'cw-corrob-'));
  writeFileSync(join(d, 'gate-ratchet.jsonl'), jsonl(records));
  return d;
}

// ── E1: AN EMPTY CORPUS IS NOT A CLEAN ONE ─────────────────────────────────────────────────────
test('a corpus with NO steady records reports no-steady-records, never no-refutation-found', () => {
  const d = fixture([{ at: '2026-08-01T00:00:00.000Z', verdict: 'worse' }]);
  try {
    const r = corroborate({ dir: d });
    assert.equal(r.steady, 0);
    assert.equal(r.state, 'no-steady-records',
      'nothing was examined, so nothing may be claimed — this is a different state from having looked and found nothing');
    assert.notEqual(r.state, 'no-refutation-found');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('steady records that are all UNANCHORED report none-anchored, not a clean result', () => {
  const d = fixture([
    { at: '2026-08-01T00:00:00.000Z', verdict: 'steady', metrics: { conflicts: 0, unreviewed: 90 } },
    { at: '2026-08-01T00:00:01.000Z', verdict: 'steady', metrics: { conflicts: 0, unreviewed: 90 } },
  ]);
  try {
    const r = corroborate({ dir: d });
    assert.equal(r.unanchored, 2);
    assert.equal(r.anchored, 0);
    assert.equal(r.state, 'none-anchored', 'no procedure can reach a record with no headSha, and saying so beats reporting zero refutations');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── E2: A RECORD THAT MADE NO CLAIM IS NOT IN DISAGREEMENT ─────────────────────────────────────
test('a steady record carrying no metrics is UNMEASURABLE, not a refutation candidate', () => {
  const d = fixture([{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady', headSha: SHA }]);
  try {
    const r = corroborate({ dir: d });
    // The fake sha is refused before git sees it, so this lands in `unreadable`; the property under
    // test is that a metrics-less record can never reach `refuted`, by either route.
    assert.equal(r.refuted, 0, 'a record that made no claim cannot disagree with anything — counting it would manufacture evidence');
    assert.equal(r.candidates.length, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── E3: A JOURNAL IS UNTRUSTED INPUT ───────────────────────────────────────────────────────────
// Journals live inside the tree untrusted agents edit, and git parses argv elements beginning
// with `-` as FLAGS.
test('a headSha that is not a 40-hex sha is refused before git is handed it', () => {
  for (const bad of ['--upload-pack=touch /tmp/pwned', '-x', 'HEAD --', '../../etc/passwd', '', 'A'.repeat(40)]) {
    const q = queueAt(bad);
    assert.equal(q.ok, false, `queueAt(${JSON.stringify(bad)}) must refuse`);
    assert.match(q.reason, /not a 40-hex sha/, `${JSON.stringify(bad)} must be refused for its SHAPE, not by git failing`);
  }
});

test('a well-formed but nonexistent sha fails closed as unreadable, never as agreement', () => {
  const q = queueAt('0'.repeat(40));
  assert.equal(q.ok, false);
  assert.match(q.reason, /unreadable/);
  assert.equal(q.conflicts, undefined, 'a failed read must not carry a number that could be compared');
});

// ── E4: THE COUNT MUST CARRY ITS OWN CAVEAT ────────────────────────────────────────────────────
// `corroborated` is a bare integer — the payload must say what it does and does not mean.
test('the payload states what `corroborated` does and does not mean', () => {
  const d = fixture([{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady' }]);
  try {
    const r = corroborate({ dir: d });
    assert.match(r.corroboratedMeans, /NOT a true-clean/);
    assert.match(r.corroboratedMeans, /working-tree claim/);
    assert.match(r.corroboratedMeans, /drifted/, 'the unchecked metric must be named on the payload, not only in the prose');
    assert.deepEqual(r.metricsUnchecked, ['drifted']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Snapshot the directory — it needs no import that can silently not exist.
test('it writes nothing — corroboration is not adjudication', () => {
  const d = fixture([{ at: '2026-08-01T00:00:00.000Z', verdict: 'steady', headSha: SHA, metrics: { conflicts: 0, unreviewed: 1 } }]);
  const snap = () => readdirSync(d).sort().map((f) => `${f}:${readFileSync(join(d, f), 'utf8')}`).join('|');
  try {
    const before = snap();
    corroborate({ dir: d });
    assert.equal(snap(), before, 'this tool proposes; a human or a canary still does the judging');
    assert.ok(!existsSync(join(d, 'adjudications.jsonl')), 'no adjudication ledger may appear');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('count() matches the gate\'s own coercion — array length, number as-is, else UNKNOWN', () => {
  assert.equal(count([1, 2, 3]), 3);
  assert.equal(count(90), 90);
  assert.equal(count(undefined), null, 'a schema that moved must read UNKNOWN, never 0');
  assert.equal(count('90'), null);
});
