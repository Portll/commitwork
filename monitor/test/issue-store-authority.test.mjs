// monitor/test/issue-store-authority.test.mjs — the authority gate's two namespaces. The gate is
// consulted with SCANNER categories, disjoint from the infrastructure vocabulary; membership is
// pinned so changing it is a deliberate edit.
import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTHORITY_CATEGORIES, AUTHORITY_SCANNER_CATEGORIES, mintIssue, readyIssues } from '../issue-store.mjs';
import { ingestArea } from '../issue-ingest.mjs';
import { detailKeys } from '../detail-schema.mjs';

const emptyDoc = () => ({ version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} });
const mint = (doc, over = {}) => mintIssue(doc, {
  area: 'a', repo: 'r', kind: 'code', severity: 'high', title: 't',
  source: { kind: 'scanner-row', key: 'sc:r|cspm|c=A|res=B', tool: 'cspm', rule: null },
  ...over,
}, '2026-08-13T00:00:00.000Z');

test('every AUTHORITY_SCANNER_CATEGORIES member is a real scanner category', () => {
  const known = new Set(detailKeys());
  const strangers = [...AUTHORITY_SCANNER_CATEGORIES].filter((c) => !known.has(c));
  assert.deepEqual(strangers, [],
    `these are not scanner categories, so the gate cannot fire for them: ${strangers.join(', ')}. `
    + 'A member that no ingest can produce is the exact defect this test exists to prevent — it is '
    + 'inert, and its inertness renders as "nothing needs authority".');
});

test('the scanner authority set is DECLARED, not accidental — its members are pinned', () => {
  // RULED 2026-08-13 (D11): cspm and tlsHeaders require authority — their fix is not in this tree.
  // iac and actionsPosture were considered and REFUSED. Membership asserted, not just size.
  assert.deepEqual([...AUTHORITY_SCANNER_CATEGORIES].sort(), ['cspm', 'tlsHeaders'],
    'AUTHORITY_SCANNER_CATEGORIES changed. That is a behaviour change for the work queue, not a '
    + 'refactor: update this assertion deliberately and record the ruling in evaluations/DECISIONS.md.');
});

test('the categories D11 REFUSED stay out — an ordinary tree edit is not an authority act', () => {
  // the refusals are part of the ruling — and the ones most likely undone by accident
  for (const c of ['iac', 'actionsPosture', 'sastCodeql', 'osv', 'npm', 'dockerfile']) {
    assert.equal(AUTHORITY_SCANNER_CATEGORIES.has(c), false,
      `${c} is remediated by editing a file in this tree — it must stay claimable`);
  }
});

test('an authority-gated issue leaves the ready pool; an ordinary one stays in it', () => {
  // The gate's whole effect, asserted end to end rather than assumed from the flag's presence.
  const doc = emptyDoc();
  mint(doc, { authorityRequired: true });
  mint(doc, { source: { kind: 'scanner-row', key: 'sc:r|iac|rule|f.tf', tool: 'iac', rule: 'rule' }, authorityRequired: false });
  const now = '2026-08-13T01:00:00.000Z';
  assert.equal(readyIssues(doc, { now }).length, 1, 'only the tree-editable one is claimable');
  assert.equal(readyIssues(doc, { now, includeAuthority: true }).length, 2, 'and the gate is what excluded it');
});

test('a RULING REACHES ISSUES THAT ALREADY EXIST — authority refreshes on ingest, both ways', () => {
  // authorityRequired was only set at MINT, so pre-ruling issues would stay claimable forever —
  // a ruling that applies to future rows only is half a ruling
  const NOW = '2026-08-13T12:00:00.000Z';
  const cspmRow = { repo: 'r1', control: 'Require signed commits', resource: 'org/r1', sev: 'high', message: 'unsigned' };
  // each slice must be strictly newer — the monotonicity guard refuses re-runs
  const rollup = (sliceId, generated) => ({
    sliceId, generated, repos: [],
    scanners: { cspm: { ran: 1 } }, scannerFindings: { cspm: [cspmRow] },
  });
  const ingest = (doc, sliceId, generated) => ingestArea(doc, {
    areaSlug: 'a', rollup: rollup(sliceId, generated), ledger: null, annotations: [], repoPaths: {},
    now: NOW, minSev: 'high', staleHours: 26,
  });

  const doc = emptyDoc();
  const s1 = ingest(doc, 'sweep-1', '2026-08-13T10:00:00.000Z');
  assert.equal(s1.status, 'ok', `the first ingest must run: ${s1.status} ${s1.reason || ''}`);
  const iss = Object.values(doc.issues).find((i) => i.source?.tool === 'cspm');
  assert.ok(iss, 'the cspm row filed');
  assert.equal(iss.authorityRequired, true, 'a NEW cspm issue is gated at mint');

  // Simulate the pre-ruling population: an issue that exists with the flag off.
  iss.authorityRequired = false;
  assert.equal(readyIssues(doc, { now: NOW }).some((i) => i.id === iss.id), true, 'claimable while unflagged');

  // strictly newer, or the guard refuses it and this test asserts nothing
  const s2 = ingest(doc, 'sweep-2', '2026-08-13T11:00:00.000Z');
  assert.equal(s2.status, 'ok', `the second ingest must run: ${s2.status} ${s2.reason || ''}`);
  assert.equal(doc.issues[iss.id].authorityRequired, true,
    'the next ingest applies the ruling to the issue that already existed');
  assert.equal(readyIssues(doc, { now: NOW }).some((i) => i.id === iss.id), false, 'and it leaves the pool');
  assert.ok(doc.events.some((e) => e.issueId === iss.id && e.data?.authorityRequired?.to === true),
    'the change is an EVENT in the chain, not a silent field flip');
});

test('the two namespaces stay separate — the infrastructure set is not a scanner set', () => {
  // pointing the scanner path back at AUTHORITY_CATEGORIES must fail here
  const known = new Set(detailKeys());
  const overlap = [...AUTHORITY_CATEGORIES].filter((c) => known.has(c));
  assert.deepEqual(overlap, [],
    'AUTHORITY_CATEGORIES now overlaps the scanner namespace. If that is intended, the two sets '
    + 'should be merged deliberately rather than colliding by accident.');
});
