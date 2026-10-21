// monitor/remediation-outcome.mjs — did a remediation CLAIM hold, as of the latest slice?
// Structured claim:'remediated' only (never prose); comparability is REFUSED, never guessed
// (notCompared/carried produce NO outcome; weak-tier is never a claim); appends are idempotent
// on (claimRef, findingKey, sliceId) — a new slice may legitimately re-refute.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deriveScannerClaimOutcomes, deriveLedgerClaimOutcomes, deriveOutcomes, idemKeyFor,
  loadLatestSlice, runRemediationOutcome, alreadyOutcomedKeys,
} from '../remediation-outcome.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remo-'));
  process.env.CW_VERDICT_DIR = join(dir, 'verdicts');
  process.env.CW_NOW = '2026-08-10T12:00:00.000Z';
});
afterEach(() => {
  delete process.env.CW_VERDICT_DIR;
  delete process.env.CW_NOW;
  rmSync(dir, { recursive: true, force: true });
});

// ---- fixture builders ---------------------------------------------------------------------
const slice = ({
  sliceId = 'sweep-cur', scannerFindings = {}, notCompared = [], byCategory = {},
  findings = [], carried = [],
} = {}) => ({
  sliceId, scannerFindings, scannerDelta: { notCompared, byCategory }, findings, carried,
});

const scannerClaim = (over = {}) => ({
  category: 'secrets', repo: 'r1', rule: 'aws-key', file: 'a.env',
  action: 'accept', reason: 'accepted pending removal', who: 'ops', at: '2026-08-01T00:00:00Z',
  claim: 'remediated', ...over,
});

const secretRow = (over = {}) => ({ repo: 'r1', rule: 'aws-key', file: 'a.env', sev: 'high', ...over });

const ledgerEntry = (over = {}) => ({
  key: 'r1|npm|CVE-1|leftpad|package-lock.json', repo: 'r1', vulnId: 'CVE-1', package: 'leftpad',
  tool: 'npm', resolvedSlice: 'sweep-prev', evidence: { tier: 'strong', detail: 'x' }, ...over,
});

// ---- scanner-annotation claim lane ---------------------------------------------------------

test('scanner claim: place absent from the latest slice -> verified-fixed', () => {
  const s = slice({ byCategory: { secrets: { status: 'compared' } } }); // no secrets rows at all
  const { out, skipped } = deriveScannerClaimOutcomes([scannerClaim()], s);
  assert.equal(skipped.length, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].outcome, 'verified-fixed');
  assert.equal(out[0].category, 'secrets');
  assert.equal(out[0].repo, 'r1');
});

test('scanner claim: place still present -> refuted-still-present, names the repo', () => {
  const s = slice({ scannerFindings: { secrets: [secretRow()] }, byCategory: { secrets: { status: 'compared' } } });
  const { out } = deriveScannerClaimOutcomes([scannerClaim()], s);
  assert.equal(out.length, 1);
  assert.equal(out[0].outcome, 'refuted-still-present');
  assert.deepEqual(out[0].stillPresentIn, ['r1']);
});

test('scanner claim: category in scannerDelta.notCompared -> NO outcome', () => {
  const s = slice({
    scannerFindings: { secrets: [] },
    notCompared: ['secrets:prev-not-ran'],
    byCategory: { secrets: { status: 'prev-not-ran' } },
  });
  const { out, skipped } = deriveScannerClaimOutcomes([scannerClaim()], s);
  assert.equal(out.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /not comparable/);
});

test('scanner claim: carried category -> NO outcome (same gate as notCompared, named reason)', () => {
  const s = slice({
    scannerFindings: { secrets: [secretRow()] }, // even though a row is present, carried refuses to look
    notCompared: ['secrets:cur-carried'],
    byCategory: { secrets: { status: 'cur-carried' } },
  });
  const { out, skipped } = deriveScannerClaimOutcomes([scannerClaim()], s);
  assert.equal(out.length, 0);
  assert.match(skipped[0].reason, /cur-carried/);
});

test('prose "REMEDIATED" in a note field is NEVER a claim — only claim:\'remediated\' counts', () => {
  const s = slice({ byCategory: { secrets: { status: 'compared' } } });
  const proseOnly = scannerClaim({ reason: 'REMEDIATED in prod, verified by hand', claim: undefined });
  const { out, skipped } = deriveScannerClaimOutcomes([proseOnly], s);
  assert.equal(out.length, 0);
  assert.equal(skipped.length, 0); // not even considered — skipped over silently at the `claim !== 'remediated'` gate, correctly
});

test('scanner claim: fleet scope is refuted if the identity appears under ANY repo', () => {
  const s = slice({
    scannerFindings: { secrets: [secretRow({ repo: 'other-repo' })] },
    byCategory: { secrets: { status: 'compared' } },
  });
  const fleetClaim = scannerClaim({ scope: 'fleet', repo: undefined });
  const { out } = deriveScannerClaimOutcomes([fleetClaim], s);
  assert.equal(out.length, 1);
  assert.equal(out[0].outcome, 'refuted-still-present');
  assert.deepEqual(out[0].stillPresentIn, ['other-repo']);
});

test('scanner claim: unknown category is skipped, never guessed', () => {
  const s = slice({ byCategory: {} });
  const { out, skipped } = deriveScannerClaimOutcomes([scannerClaim({ category: 'not-a-real-category' })], s);
  assert.equal(out.length, 0);
  assert.match(skipped[0].reason, /unknown category/);
});

// ---- remediation-ledger claim lane ----------------------------------------------------------

test('ledger claim: finding absent + comparable (not carried) -> verified-fixed', () => {
  const s = slice({ findings: [], carried: [] });
  const { out, skipped } = deriveLedgerClaimOutcomes([ledgerEntry()], s);
  assert.equal(skipped.length, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].outcome, 'verified-fixed');
  assert.equal(out[0].category, 'dependency-cve');
  assert.equal(out[0].findingKey, 'r1|CVE-1|leftpad');
});

test('ledger claim: finding still present -> refuted-still-present', () => {
  const s = slice({ findings: [{ key: ledgerEntry().key }], carried: [] });
  const { out } = deriveLedgerClaimOutcomes([ledgerEntry()], s);
  assert.equal(out.length, 1);
  assert.equal(out[0].outcome, 'refuted-still-present');
});

test('ledger claim: carried (not rescanned this slice) -> NO outcome', () => {
  const s = slice({ findings: [], carried: [{ key: ledgerEntry().key }] });
  const { out, skipped } = deriveLedgerClaimOutcomes([ledgerEntry()], s);
  assert.equal(out.length, 0);
  assert.match(skipped[0].reason, /not rescanned/);
});

test('ledger claim: weak-tier entry is never a claim', () => {
  const s = slice({ findings: [], carried: [] });
  const { out, skipped } = deriveLedgerClaimOutcomes([ledgerEntry({ evidence: { tier: 'weak', detail: 'x' } })], s);
  assert.equal(out.length, 0);
  assert.match(skipped[0].reason, /weak tier/);
});

test('ledger claim: slice missing findings/carried arrays -> NO outcome, never a fabricated fix', () => {
  const s = { sliceId: 'sweep-cur' }; // e.g. a summary rollup.json passed by mistake
  const { out, skipped } = deriveLedgerClaimOutcomes([ledgerEntry()], s);
  assert.equal(out.length, 0);
  assert.match(skipped[0].reason, /comparability unknown/);
});

// ---- combined + determinism ------------------------------------------------------------------

test('deriveOutcomes combines both lanes and sorts deterministically by findingKey', () => {
  const s = slice({
    scannerFindings: { secrets: [] },
    byCategory: { secrets: { status: 'compared' } },
    findings: [], carried: [],
  });
  const claims = [scannerClaim({ file: 'z.env' }), scannerClaim({ file: 'a.env' })];
  const res = deriveOutcomes(s, { scannerAnnotations: claims, ledgerEntries: [ledgerEntry()] });
  assert.equal(res.counts.scannerAnnotation, 2);
  assert.equal(res.counts.remediationLedger, 1);
  // Each lane is independently sorted by findingKey (concatenation order is scanner-then-ledger,
  // stable across runs) — re-deriving from the SAME inputs in a different claim order must yield
  // byte-identical output within each lane.
  const scannerKeys = res.outcomes.slice(0, res.counts.scannerAnnotation).map((o) => o.findingKey);
  assert.deepEqual(scannerKeys, [...scannerKeys].sort());
  const reordered = deriveOutcomes(s, { scannerAnnotations: [...claims].reverse(), ledgerEntries: [ledgerEntry()] });
  assert.deepEqual(reordered.outcomes, res.outcomes);
});

// ---- idempotency + full orchestration (real fs, CW_VERDICT_DIR) ------------------------------

function writeSlice(outDir, sliceObj, file = '1.json') {
  mkdirSync(join(outDir, 'history'), { recursive: true });
  writeFileSync(join(outDir, 'history', 'index.json'), JSON.stringify([{ file }]));
  writeFileSync(join(outDir, 'history', file), JSON.stringify(sliceObj));
}

test('loadLatestSlice reads the file history/index.json names; absent index -> null', () => {
  const outDir = join(dir, 'area-out');
  assert.equal(loadLatestSlice(outDir), null); // ENOENT — legitimate absence
  const s = slice();
  writeSlice(outDir, s);
  assert.deepEqual(loadLatestSlice(outDir), s);
});

test('idemKeyFor is stable regardless of the literal\'s field order', () => {
  const a = idemKeyFor({ claimRef: 'c1', findingKey: 'f1', sliceId: 's1' });
  const b = idemKeyFor({ sliceId: 's1', findingKey: 'f1', claimRef: 'c1' });
  assert.equal(a, b);
});

test('runRemediationOutcome: same (claimRef, findingKey, sliceId) re-run appends zero new records', () => {
  const outDir = join(dir, 'area-out');
  writeSlice(outDir, slice({
    scannerFindings: { secrets: [secretRow()] }, // still present -> refuted, exercised together with verified-fixed below
    byCategory: { secrets: { status: 'compared' } },
    findings: [], carried: [],
  }));
  const annPath = join(dir, 'annotations.json');
  writeFileSync(annPath, JSON.stringify({ scannerAnnotations: [scannerClaim(), scannerClaim({ file: 'gone.env', rule: 'gcp-key' })] }));
  const ledgerPath = join(dir, 'remediation-ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({ entries: [ledgerEntry()] }));

  const r1 = runRemediationOutcome({ outDir, annotationsPath: annPath, ledgerPath, write: true });
  assert.equal(r1.ok, true);
  assert.equal(r1.verifiedFixed, 2); // secret gcp-key/gone.env absent + ledger entry absent
  assert.equal(r1.refutedStillPresent, 1); // secret aws-key/a.env still present
  assert.equal(r1.loudLines.length, 1);
  assert.match(r1.loudLines[0], /REFUTED/);

  const r2 = runRemediationOutcome({ outDir, annotationsPath: annPath, ledgerPath, write: true });
  assert.equal(r2.verifiedFixed, 0);
  assert.equal(r2.refutedStillPresent, 0);
  assert.equal(r2.alreadyRecorded, 3);

  const journalLines = readFileSync(join(process.env.CW_VERDICT_DIR, 'adjudications.jsonl'), 'utf8')
    .split('\n').filter(Boolean);
  assert.equal(journalLines.length, 3); // still exactly 3 — the re-run appended nothing
});

test('runRemediationOutcome: a NEW sliceId may legitimately re-refute the same claim', () => {
  const outDir = join(dir, 'area-out');
  const annPath = join(dir, 'annotations.json');
  writeFileSync(annPath, JSON.stringify({ scannerAnnotations: [scannerClaim()] }));
  const ledgerPath = join(dir, 'remediation-ledger.json');
  writeFileSync(ledgerPath, JSON.stringify({ entries: [] }));

  // slice 1: claim holds (absent) -> verified-fixed
  writeSlice(outDir, slice({ sliceId: 'sweep-1', scannerFindings: { secrets: [] }, byCategory: { secrets: { status: 'compared' } } }), '1.json');
  const r1 = runRemediationOutcome({ outDir, annotationsPath: annPath, ledgerPath, write: true });
  assert.equal(r1.verifiedFixed, 1);
  assert.equal(r1.refutedStillPresent, 0);

  // slice 2: the same finding REAPPEARED -> a fresh refutation, not swallowed by (claimRef, findingKey) alone
  writeFileSync(join(outDir, 'history', 'index.json'), JSON.stringify([{ file: '1.json' }, { file: '2.json' }]));
  writeFileSync(join(outDir, 'history', '2.json'), JSON.stringify(
    slice({ sliceId: 'sweep-2', scannerFindings: { secrets: [secretRow()] }, byCategory: { secrets: { status: 'compared' } } }),
  ));
  const r2 = runRemediationOutcome({ outDir, annotationsPath: annPath, ledgerPath, write: true });
  assert.equal(r2.verifiedFixed, 0);
  assert.equal(r2.refutedStillPresent, 1);
  assert.equal(r2.loudLines.length, 1);

  const journalLines = readFileSync(join(process.env.CW_VERDICT_DIR, 'adjudications.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(journalLines.length, 2);
  assert.equal(journalLines[0].outcome, 'verified-fixed');
  assert.equal(journalLines[1].outcome, 'refuted-still-present');
  assert.equal(journalLines[1].sliceId, 'sweep-2');
});

test('runRemediationOutcome: no slice yet reads as absent, never a failure', () => {
  const outDir = join(dir, 'never-swept');
  const r = runRemediationOutcome({ outDir, annotationsPath: join(dir, 'nope.json'), ledgerPath: join(dir, 'nope2.json'), write: true });
  assert.equal(r.ok, true);
  assert.equal(r.note, 'no slice yet');
  assert.equal(alreadyOutcomedKeys().size, 0);
});

test('runRemediationOutcome: missing annotations/ledger files read as "nothing claimed", never an error', () => {
  const outDir = join(dir, 'area-out');
  writeSlice(outDir, slice({ byCategory: { secrets: { status: 'compared' } } }));
  const r = runRemediationOutcome({ outDir, annotationsPath: join(dir, 'absent-ann.json'), ledgerPath: join(dir, 'absent-ledger.json'), write: true });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.verifiedFixed, 0);
  assert.equal(r.refutedStillPresent, 0);
});

test('runRemediationOutcome: dry run (write:false) derives outcomes but appends nothing', () => {
  const outDir = join(dir, 'area-out');
  writeSlice(outDir, slice({ scannerFindings: { secrets: [] }, byCategory: { secrets: { status: 'compared' } } }));
  const annPath = join(dir, 'annotations.json');
  writeFileSync(annPath, JSON.stringify({ scannerAnnotations: [scannerClaim()] }));
  const r = runRemediationOutcome({ outDir, annotationsPath: annPath, ledgerPath: join(dir, 'no-ledger.json'), write: false });
  assert.equal(r.verifiedFixed, 1);
  assert.equal(alreadyOutcomedKeys().size, 0); // nothing written
});
