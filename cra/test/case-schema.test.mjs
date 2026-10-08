// node --test cra/test/ — the Art. 14 case log validates at its write path.
//
// The chain proves cases.json was not EDITED. It proves nothing about whether it was WRITTEN
// correctly, and until 2026-08-22 nothing did: clock keys, track values and the reporting shape
// were conventions held only by the code that emitted them.
// Source: evaluations/REMEDIATION-schema-derivation-2026-08-22.md R2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { validateCase, updateCases, emptyCasesDoc, appendCaseEvent } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);

const NOW = '2026-07-20T00:00:00.000Z';
const good = (over = {}) => ({
  caseId: 'p--cve-1', kind: 'vulnerability', productId: 'p', vulnId: 'CVE-2026-1',
  trigger: 'kev', kev: true, epss: 0.9, status: 'open',
  reporting: { locale: 'DE', regime: 'regulatory', bodies: ['ENISA'], why: 'x' },
  clocks: {
    track: 'article14', basis: 'detection', basisAt: NOW,
    earlyWarningDue: NOW, notificationDue: NOW, finalDue: NOW,
  },
  ...over,
});

test('a well-formed case validates', () => {
  assert.deepEqual(validateCase(good()), []);
});

test('an internal clock carrying an Art. 14 key is REFUSED', () => {
  // The cross-track leak the whole split exists to prevent: a policy deadline that reads as a
  // regulatory one everywhere downstream.
  const bad = good({
    trigger: 'crit',
    clocks: { track: 'internal', basis: 'd', basisAt: NOW, triageDue: NOW, remediateDue: NOW, earlyWarningDue: NOW },
  });
  const errs = validateCase(bad);
  assert.ok(errs.some((e) => /internal clock carries Art\. 14 key 'earlyWarningDue'/.test(e)), errs.join('; '));
});

test('a reportable clock missing a deadline is REFUSED', () => {
  const bad = good({ clocks: { track: 'article14', basis: 'd', basisAt: NOW, earlyWarningDue: NOW } });
  const errs = validateCase(bad);
  assert.ok(errs.some((e) => /missing 'notificationDue'/.test(e)));
  assert.ok(errs.some((e) => /missing 'finalDue'/.test(e)));
});

test('a missing basisAt is REFUSED — every band would render 0%', () => {
  const bad = good({ clocks: { ...good().clocks, basisAt: undefined } });
  assert.ok(validateCase(bad).some((e) => /basisAt is required/.test(e)));
});

test('epss 0 and epss null are different, and only a number or null is accepted', () => {
  assert.deepEqual(validateCase(good({ epss: null })), []);
  assert.deepEqual(validateCase(good({ epss: 0 })), []);
  assert.ok(validateCase(good({ epss: 'unknown' })).some((e) => /epss must be a number or null/.test(e)));
});

test('an undeclared trigger or track is REFUSED', () => {
  assert.ok(validateCase(good({ trigger: 'vibes' })).some((e) => /not a declared trigger/.test(e)));
  assert.ok(validateCase(good({ clocks: { ...good().clocks, track: 'sort-of' } })).some((e) => /must be article14\|bestpractice\|internal/.test(e)));
});

// ── the write path ──────────────────────────────────────────────────────────────────────────────

function scratch() {
  const T = mkdtempSync(join(tmpdir(), 'case-schema-'));
  return { T, paths: { cases: join(T, 'cases.json') } };
}

test('updateCases REFUSES to persist a case this run made invalid', () => {
  const { T, paths } = scratch();
  const r = updateCases(paths, (doc) => {
    doc.cases['bad'] = good({ caseId: 'bad', clocks: { track: 'article14', basis: 'd', basisAt: NOW } });
    appendCaseEvent(doc, 'case-opened', 'bad', {}, NOW);
    return true;
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'case-invalid');
  assert.equal(r.saved, false);
  assert.ok(r.errors.some((e) => /missing 'earlyWarningDue'/.test(e)));
  rmSync(T, { recursive: true, force: true });
});

test('a PRE-EXISTING invalid case is reported, never rewritten, and never blocks a write', () => {
  // The guard must not brick the ledger: cases.json predates the schema, and refusing the whole
  // document over a legacy record would make every subsequent write fail.
  const { T, paths } = scratch();
  const legacy = emptyCasesDoc();
  legacy.cases['old'] = { caseId: 'old', kind: 'vulnerability', productId: 'p', trigger: 'kev', status: 'open', clocks: { earlyWarningDue: NOW } };
  writeFileSync(paths.cases, JSON.stringify(legacy));

  const r = updateCases(paths, (doc) => {
    doc.cases['new'] = good({ caseId: 'new' });
    appendCaseEvent(doc, 'case-opened', 'new', {}, NOW);
    return true;
  });
  assert.equal(r.ok, true, 'a legacy record must not block an unrelated valid write');
  assert.equal(r.saved, true);

  const after = JSON.parse(readFileSync(paths.cases, 'utf8'));
  assert.ok(after.cases['new'], 'the valid new case landed');
  assert.deepEqual(after.cases['old'], legacy.cases['old'], 'the legacy record is byte-for-byte untouched');
  rmSync(T, { recursive: true, force: true });
});
