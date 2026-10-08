// node --test monitor/test/ — scanner-delta.mjs: the scanner-lane lifecycle diff.
//
// The properties under test are the ones the module exists to guarantee:
//   · identity is the PLACE (repo|category|identity-tuple), never the line — pure line movement
//     and partial row reduction inside a place are NOT fix events (the 2026-08-03 lesson: 8 of 9
//     line-keyed auto-closes were drift, and the anchor ratchet measured 33 → 44 drifted anchors
//     in a day with zero new findings);
//   · absence is only evidence when the category RAN in both slices and the repo was in scope —
//     the 456-fake-fixed gate, per category (a carried category chains prev rows verbatim, so a
//     diff over it proves nothing);
//   · refusals are named and their counters are null, never 0 — "could not compare" must stay
//     distinguishable from "compared, nothing changed" (explicit uncertainty, applied to deltas);
//   · hygiene lanes (TOTALS_EXCLUDE) stay out of the headline totals but remain in totalsAll;
//   · output is deterministic regardless of input row/category order.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffScannerFindings, scannerPlaceKey, PLACE_DETAIL_CAP } from '../scanner-delta.mjs';
import { TOTALS_EXCLUDE } from '../extractors.mjs';

const ran = { ran: 1 };
const notRan = { ran: 0, skipped: 1 };
const carriedProv = { ran: 1, carried: true, carriedFrom: 'sweep-x' };

const slice = ({ scanners = {}, findings = {}, repos = ['r1'], sliceId = 'sweep-cur' } = {}) =>
  ({ sliceId, scanners, scannerFindings: findings, scope: { repos } });

const sg = (rule, file, line, extra = {}) => ({ repo: 'r1', rule, file, line, sev: 'high', message: 'm', ...extra });

describe('scanner-delta', () => {
  test('fixed when a place stops producing rows; new when one appears', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 10), sg('rule-b', 'b.ts', 5)] }, sliceId: 'sweep-prev' });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-b', 'b.ts', 5), sg('rule-c', 'c.ts', 1)] } });
    const d = diffScannerFindings(prev, cur);
    const c = d.byCategory.sastSemgrep;
    assert.equal(c.status, 'compared');
    assert.equal(c.fixed, 1); assert.equal(c.new, 1); assert.equal(c.persisting, 1);
    assert.equal(c.byRule['rule-a'].fixed, 1);
    assert.equal(c.byRule['rule-c'].new, 1);
    assert.equal(c.fixedPlaces[0].file, 'a.ts');
    assert.equal(d.totals.fixed, 1); assert.equal(d.totals.new, 1);
    assert.equal(d.prevSliceId, 'sweep-prev');
    assert.equal(d.comparable, true);
  });

  test('pure line movement inside a place is persisting, never fixed+new', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 10)] } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 99)] } });
    const c = diffScannerFindings(prev, cur).byCategory.sastSemgrep;
    assert.equal(c.fixed, 0); assert.equal(c.new, 0); assert.equal(c.persisting, 1);
  });

  test('partial row reduction inside a place (2 rows → 1) is persisting, not a fix event', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 10), sg('rule-a', 'a.ts', 20)] } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 10)] } });
    const c = diffScannerFindings(prev, cur).byCategory.sastSemgrep;
    assert.equal(c.fixed, 0); assert.equal(c.new, 0); assert.equal(c.persisting, 1);
  });

  test('cross-FILE move is a different place: fixed at the old, new at the new', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 10)] } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'z.ts', 10)] } });
    const c = diffScannerFindings(prev, cur).byCategory.sastSemgrep;
    assert.equal(c.fixed, 1); assert.equal(c.new, 1);
  });

  test('cur carried / cur not-ran / prev not-ran refuse with named status and NULL counters', () => {
    const prevBoth = slice({ scanners: { sastSemgrep: ran, iac: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)], iac: [sg('DS-1', 'Dockerfile', 1)] } });
    const cur = slice({ scanners: { sastSemgrep: carriedProv, iac: notRan }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)] } });
    const d = diffScannerFindings(prevBoth, cur);
    assert.equal(d.byCategory.sastSemgrep.status, 'cur-carried');
    assert.equal(d.byCategory.iac.status, 'cur-not-ran');
    assert.equal(d.byCategory.sastSemgrep.fixed, null); // null, NEVER 0 — the iac rows are absent but nothing may claim them fixed
    assert.equal(d.byCategory.iac.fixed, null);
    assert.deepEqual(d.notCompared, ['iac:cur-not-ran', 'sastSemgrep:cur-carried']);

    const prevNotRan = slice({ scanners: { sastSemgrep: notRan }, findings: {} });
    const curRan = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)] } });
    assert.equal(diffScannerFindings(prevNotRan, curRan).byCategory.sastSemgrep.status, 'prev-not-ran');
  });

  test('no previous slice: every category no-prev, comparable false, totals null', () => {
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)] } });
    const d = diffScannerFindings(null, cur);
    assert.equal(d.comparable, false);
    assert.equal(d.byCategory.sastSemgrep.status, 'no-prev');
    assert.equal(d.totals.fixed, null); assert.equal(d.totals.new, null);
  });

  test('a prev place whose repo left the scope is carried, never fixed', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1), sg('r', 'b.ts', 1, { repo: 'r2' })] }, repos: ['r1', 'r2'] });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)] }, repos: ['r1'] });
    const c = diffScannerFindings(prev, cur).byCategory.sastSemgrep;
    assert.equal(c.fixed, 0); assert.equal(c.carriedPlaces, 1); assert.equal(c.persisting, 1);
  });

  test('an annotated (suppressed) row still holds its place: suppression is never a fix', () => {
    const ann = { action: 'accept', at: 'x', reason: 'x', who: 'x', whoKind: 'human' };
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)] } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1, { annotation: ann })] } });
    const c = diffScannerFindings(prev, cur).byCategory.sastSemgrep;
    assert.equal(c.fixed, 0); assert.equal(c.persisting, 1);
    assert.equal(c.acceptedPlaces, 1); // fully suppressed — counted as its own state
  });

  test('hygiene lanes (TOTALS_EXCLUDE) count in totalsAll but never the headline totals', () => {
    assert.ok(TOTALS_EXCLUDE.includes('stubs'), 'precondition: stubs is a hygiene lane');
    const prev = slice({ scanners: { stubs: ran, sastSemgrep: ran },
      findings: { stubs: [{ repo: 'r1', marker: 'TODO', file: 'a.ts', line: 1 }], sastSemgrep: [sg('r', 'a.ts', 1)] } });
    const cur = slice({ scanners: { stubs: ran, sastSemgrep: ran }, findings: { stubs: [], sastSemgrep: [] } });
    const d = diffScannerFindings(prev, cur);
    assert.equal(d.totalsAll.fixed, 2);
    assert.equal(d.totals.fixed, 1); // the TODO's disappearance is not a security fix
  });

  test('per-category identity tuples drive the key (secretsHistory keys on detector, not rule)', () => {
    const row = { repo: 'r1', detector: 'Postgres', file: 'db.env', line: 3, commit: 'c', verified: false };
    assert.equal(scannerPlaceKey('secretsHistory', row), 'r1|secretsHistory|Postgres|db.env');
    assert.equal(scannerPlaceKey('nonsuchCategory', row), null);
    const prev = slice({ scanners: { secretsHistory: ran }, findings: { secretsHistory: [row] } });
    const cur = slice({ scanners: { secretsHistory: ran }, findings: { secretsHistory: [] } });
    const c = diffScannerFindings(prev, cur).byCategory.secretsHistory;
    assert.equal(c.fixed, 1);
    assert.equal(c.byRule.Postgres.fixed, 1); // sub-category = identity[0] value
  });

  test('a category with no declared schema refuses as no-identity', () => {
    const prev = slice({ scanners: { mysteryLane: ran }, findings: { mysteryLane: [sg('r', 'a.ts', 1)] } });
    const cur = slice({ scanners: { mysteryLane: ran }, findings: { mysteryLane: [] } });
    const d = diffScannerFindings(prev, cur);
    assert.equal(d.byCategory.mysteryLane.status, 'no-identity');
    assert.equal(d.byCategory.mysteryLane.fixed, null);
  });

  test('a category unconserved on the CURRENT side refuses as cur-unconserved: no fixed places minted for it', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 1), sg('rule-b', 'b.ts', 2)] } });
    // Both prev places are absent from cur — without the conservation gate this would mint 2 fixed,
    // exactly the F3 failure (a DETAIL_CAP truncation reading as two places that "stopped producing rows").
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [] } });
    const curConservation = { checked: ['sastSemgrep'], violations: [{ category: 'sastSemgrep', declared: 50, published: 0, truncated: 10 }] };
    const d = diffScannerFindings(prev, cur, { curConservation });
    const c = d.byCategory.sastSemgrep;
    assert.equal(c.status, 'cur-unconserved');
    assert.equal(c.fixed, null); // refused — never 0, and never the 2 it would otherwise have minted
    assert.equal(c.new, null);
    assert.ok(d.notCompared.includes('sastSemgrep:cur-unconserved'));
  });

  test('a category unconserved on the PREVIOUS side refuses as prev-unconserved', () => {
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 1)] } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [sg('rule-a', 'a.ts', 1), sg('rule-c', 'c.ts', 3)] } });
    const prevConservation = { checked: ['sastSemgrep'], violations: [{ category: 'sastSemgrep', declared: 9, published: 1, truncated: 0 }] };
    const d = diffScannerFindings(prev, cur, { prevConservation });
    const c = d.byCategory.sastSemgrep;
    assert.equal(c.status, 'prev-unconserved');
    assert.equal(c.fixed, null);
    assert.equal(c.new, null); // otherwise rule-c would have compared as a genuine new place
    assert.ok(d.notCompared.includes('sastSemgrep:prev-unconserved'));
  });

  test('conservation violations do not leak across categories, and omitting both options reproduces the pre-conservation baseline', () => {
    const prev = slice({ scanners: { sastSemgrep: ran, iac: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)], iac: [sg('DS-1', 'Dockerfile', 1)] } });
    const cur = slice({ scanners: { sastSemgrep: ran, iac: ran }, findings: { sastSemgrep: [sg('r', 'a.ts', 1)], iac: [] } });
    const curConservation = { checked: ['sastSemgrep', 'iac'], violations: [{ category: 'sastSemgrep', declared: 99, published: 1, truncated: 0 }] };
    const d = diffScannerFindings(prev, cur, { curConservation });
    assert.equal(d.byCategory.sastSemgrep.status, 'cur-unconserved');
    assert.equal(d.byCategory.iac.status, 'compared'); // checked, but not named in violations — proceeds normally
    assert.equal(d.byCategory.iac.fixed, 1);

    const dNoOpt = diffScannerFindings(prev, cur); // no curConservation/prevConservation at all
    assert.equal(dNoOpt.byCategory.sastSemgrep.status, 'compared');
    assert.equal(dNoOpt.byCategory.iac.status, 'compared');
  });

  test('detail cap: counts stay exact, lists clip, truncation is stated', () => {
    const many = Array.from({ length: 7 }, (_, i) => sg('rule-a', `f${i}.ts`, 1));
    const prev = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: many } });
    const cur = slice({ scanners: { sastSemgrep: ran }, findings: { sastSemgrep: [] } });
    const c = diffScannerFindings(prev, cur, { detailCap: 3 }).byCategory.sastSemgrep;
    assert.equal(c.fixed, 7);                       // the COUNT is never capped
    assert.equal(c.fixedPlaces.length, 3);
    assert.equal(c.truncated.fixedPlaces, 4);       // and the clip is stated, not silent
    assert.ok(PLACE_DETAIL_CAP >= 100, 'default cap stays generous');
  });

  test('deterministic: shuffled row and category order produce identical bytes', () => {
    const rowsA = [sg('r1', 'a.ts', 1), sg('r2', 'b.ts', 2), sg('r0', 'c.ts', 3)];
    const rowsB = [rowsA[2], rowsA[0], rowsA[1]];
    const iacRows = [sg('DS-1', 'Dockerfile', 1)];
    const prevA = slice({ scanners: { sastSemgrep: ran, iac: ran }, findings: { sastSemgrep: rowsA, iac: iacRows } });
    const prevB = slice({ scanners: { iac: ran, sastSemgrep: ran }, findings: { iac: [...iacRows], sastSemgrep: rowsB } });
    const cur = slice({ scanners: { sastSemgrep: ran, iac: ran }, findings: { sastSemgrep: [], iac: [] } });
    assert.equal(JSON.stringify(diffScannerFindings(prevA, cur)), JSON.stringify(diffScannerFindings(prevB, cur)));
  });
});
