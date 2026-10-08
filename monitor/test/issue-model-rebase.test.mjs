// monitor/test/issue-model-rebase.test.mjs — an issue's recorded analysis model follows its latest
// sighting, so an issue filed before a flow-model change can still be closed as fixed.
//
// The auto-close carries a scanner-row issue whose row is absent under a model other than
// source.model ("not comparable"). source.model used to be written at filing and never again, so an
// issue filed under model A, still reported under B and then fixed was carried for ever.
// Synthetic stores and a temp repo only; the live store is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { emptyIssuesDoc, verifyChain } from '../issue-store.mjs';
import { ingestArea } from '../issue-ingest.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');

const FILE = 'src/PAY.cbl';
const SOURCE = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAY.', '           CALL WS-PROG.',
  '           DISPLAY WS-OUT.', ''].join('\n');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-model-rebase-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, FILE), SOURCE);
  return dir;
}
// The finding under test (line 3) and a companion (line 4) that stays present, so the slice states
// which model the category ran under. Different rules keep them out of one group.
const TARGET = (model) => ({ repo: 'cw', rule: 'COB-CALL-001', file: FILE, line: 3, sev: 'high', fingerprint: 'fp-target', model });
const OTHER = (model) => ({ repo: 'cw', rule: 'COB-OUT-002', file: FILE, line: 4, sev: 'high', fingerprint: 'fp-other', model });
const KEY = 'sc:cw|sastCobol|fingerprint=fp-target';

const slice = (n, rows) => {
  const generated = `2026-09-2${n}T00:00:00.000Z`;
  return {
    now: generated,
    rollup: { generated, sliceId: `s${n}`, scanners: { sastCobol: { ran: 1, total: rows.length } },
      scannerFindings: { sastCobol: rows }, repos: [] },
  };
};
const ingest = (doc, dir, n, rows) => ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ...slice(n, rows) });
const target = (doc) => doc.issues[doc.byKey[KEY]];
// The fix: the anchored line is edited, which is what the anchor-drift close reads.
const editLine3 = (dir) => writeFileSync(join(dir, FILE), SOURCE.replace('CALL WS-PROG.', "CALL 'PAYSUB'."));

test('seen under A, re-seen under B: the record says B, and the change is an event on the chain', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  assert.equal(target(doc).source.model, 'whole-item');

  const s = ingest(doc, dir, 2, [TARGET('byte-range'), OTHER('byte-range')]);
  const iss = target(doc);
  assert.equal(iss.source.model, 'byte-range');
  assert.equal(iss.source.key, KEY, 'the rest of the source is untouched');
  assert.ok(s.updated.includes(iss.id));
  const ev = doc.events.filter((e) => e.issueId === iss.id && e.type === 'issue-updated' && e.data.model);
  assert.deepEqual(ev.map((e) => e.data.model), [{ from: 'whole-item', to: 'byte-range' }]);
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);

  // idempotent: a third sighting under the same model writes nothing
  const before = doc.events.length;
  const s3 = ingest(doc, dir, 3, [TARGET('byte-range'), OTHER('byte-range')]);
  assert.equal(doc.events.length, before);
  assert.deepEqual(s3.updated, []);
});

test('re-seen under B and then absent under B closes as fixed by the existing anchor rule', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  ingest(doc, dir, 2, [TARGET('byte-range'), OTHER('byte-range')]);
  editLine3(dir);
  const s = ingest(doc, dir, 3, [OTHER('byte-range')]);
  const iss = target(doc);
  assert.deepEqual(s.closed, [iss.id]);
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'fixed');
  assert.equal(iss.evidence.at(-1).tier, 'anchor-drift');
});

test('absent at the A to B change without a sighting under B stays open and says why', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  editLine3(dir);   // even with the anchored line changed, the reading was never compared
  const s = ingest(doc, dir, 2, [OTHER('byte-range')]);
  const iss = target(doc);
  assert.deepEqual(s.closed, []);
  assert.equal(iss.state, 'open');
  assert.equal(iss.source.model, 'whole-item', 'no sighting under B, so the record stays on A');
  assert.match(iss.evidence.at(-1).detail, /absent under sastCobol model byte-range; filed under whole-item/);
});

test('a closed issue that reappears under B is reopened on B', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  editLine3(dir);
  ingest(doc, dir, 2, [OTHER('whole-item')]);
  assert.equal(target(doc).state, 'closed');
  const s = ingest(doc, dir, 3, [TARGET('byte-range'), OTHER('byte-range')]);
  const iss = target(doc);
  assert.deepEqual(s.reopened, [iss.id]);
  assert.equal(iss.state, 'open');
  assert.equal(iss.source.model, 'byte-range');
  assert.deepEqual(verifyChain(doc), []);
});

test('a sighting whose row names no model leaves the recorded model alone', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  const s = ingest(doc, dir, 2, [TARGET(''), OTHER('')]);
  assert.equal(target(doc).source.model, 'whole-item');
  assert.deepEqual(s.updated, []);
});

test('dryRun reports nothing as re-based and writes nothing', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [TARGET('whole-item'), OTHER('whole-item')]);
  const before = doc.events.length;
  ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, dryRun: true, ...slice(2, [TARGET('byte-range'), OTHER('byte-range')]) });
  assert.equal(target(doc).source.model, 'whole-item');
  assert.equal(doc.events.length, before);
});
