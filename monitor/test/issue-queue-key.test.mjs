// node --test monitor/test/ — a queue-sourced issue is keyed on the queue entry's id, never on its
// anchor. The anchor is `file:line`; a key that carried it filed a re-anchored audit entry as a NEW
// issue beside the old one — the line-keyed identity the house rules forbid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { emptyIssuesDoc, ingestQueue, verifyChain } from '../issue-store.mjs';
import { CLASS, CLASS_FOR_QUEUE_KIND } from '../issue-key.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = '2026-09-27T00:00:00.000Z';
// `class` is declared on these entries; the kind-derived class is tested separately below.
const entry = (over = {}) => ({
  id: 'q-0a1b2c3d', class: 'F', disposition: 'open', kind: 'correctness', severity: 'high',
  file: 'src/widget.mjs', line: 40, anchor: 'src/widget.mjs:40',
  summary: 'synthetic finding for the key test', remediation: null, ...over,
});

test('the key is q:<id> — no line, no anchor in it', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, { queue: { queue: [entry()] }, now: NOW });
  assert.equal(r.created.length, 1);
  assert.deepEqual(Object.keys(doc.byKey), ['q:q-0a1b2c3d']);
  const iss = doc.issues[r.created[0]];
  assert.equal(iss.source.key, 'q:q-0a1b2c3d');
  assert.doesNotMatch(iss.source.key, /widget|:40\b/, 'the anchor leaked back into the identity');
  assert.deepEqual(verifyChain(doc), []);
});

test('the SAME entry re-anchored to another line is the SAME issue — the movement this exists for', () => {
  const doc = emptyIssuesDoc();
  ingestQueue(doc, { queue: { queue: [entry()] }, now: NOW });
  const moved = ingestQueue(doc, { queue: { queue: [entry({ line: 57, anchor: 'src/widget.mjs:57' })] }, now: NOW });
  assert.deepEqual(moved.created, [], 'a re-anchored entry was minted as a new issue');
  assert.equal(moved.skipped, 1);
  assert.equal(Object.keys(doc.issues).length, 1);
});

test('different ids are different issues, including a twin suffix', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, {
    queue: { queue: [entry(), entry({ id: 'q-0a1b2c3d-2' }), entry({ id: 'q-ffffffff' })] }, now: NOW,
  });
  assert.equal(r.created.length, 3);
  assert.deepEqual(Object.keys(doc.byKey).sort(), ['q:q-0a1b2c3d', 'q:q-0a1b2c3d-2', 'q:q-ffffffff']);
});

test('an entry with no usable id is UNKEYABLE and reported — never filed under a colliding key', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, {
    queue: { queue: [entry({ id: undefined }), entry({ id: undefined, anchor: 'src/other.mjs:3' }), entry({ id: '0007' })] },
    now: NOW,
  });
  assert.deepEqual(r.created, [], 'an entry without a q-<sha8> id was filed');
  assert.equal(r.unkeyable.length, 3, 'each unkeyable entry is named, not folded into `skipped`');
  assert.equal(r.status, 'unkeyable', 'a non-ok status is what makes bin/issue.mjs exit 4');
  assert.deepEqual(Object.keys(doc.byKey), []);
});

test('non-open entries are still skipped, and a clean run stays ok', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, { queue: { queue: [entry({ disposition: 'fixed' }), entry({ id: 'q-12345678' })] }, now: NOW });
  assert.equal(r.status, 'ok');
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.unkeyable, []);
  assert.equal(r.created.length, 1);
});

test('the entry\'s own class reaches the minted id and outranks its kind', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, { queue: { queue: [entry(), entry({ id: 'q-5ec5eca1', class: 'S', kind: 'hardcoded' })] }, now: NOW });
  assert.match(r.created[0], /^ISS-[A-Z0-9]+-F-/, 'the declared class F did not reach the id');
  assert.match(r.created[1], /^ISS-[A-Z0-9]+-S-/, 'the kind overrode a declared class');
});

test('an entry with no class takes it from its kind — the shape bin/reconcile-findings.mjs writes', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, { queue: { queue: [entry({ class: undefined, kind: 'erroring' })] }, now: NOW });
  assert.equal(r.status, 'ok');
  assert.match(r.created[0], /^ISS-[A-Z0-9]+-F-/);
  for (const [kind, cls] of Object.entries(CLASS_FOR_QUEUE_KIND)) assert.ok(Object.hasOwn(CLASS, cls), `${kind} -> ${cls}`);
});

test('an unmappable entry is refused by name and filed nowhere; the rest still file', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, {
    queue: { queue: [
      entry({ id: 'q-00000001', class: undefined, kind: 'other' }),
      entry({ id: 'q-00000002', class: undefined, kind: undefined }),
      entry({ id: 'q-00000003', class: undefined, kind: 'constructor' }),
      entry({ id: 'q-00000004', class: 'X', kind: 'erroring' }),
      entry({ id: 'q-00000005', class: undefined, kind: 'dead' }),
    ] },
    now: NOW,
  });
  assert.equal(r.status, 'unclassified', 'a non-ok status is what makes bin/issue.mjs exit 4');
  assert.deepEqual(r.unclassified.map((u) => u.split(':')[0]), ['q-00000001', 'q-00000002', 'q-00000003', 'q-00000004']);
  assert.match(r.unclassified[0], /kind 'other' maps to no class/);
  assert.match(r.unclassified[3], /class 'X' is not one of/);
  assert.equal(r.created.length, 1);
  assert.deepEqual(Object.keys(doc.byKey), ['q:q-00000005']);
  const dry = ingestQueue(emptyIssuesDoc(), { queue: { queue: [entry({ class: undefined, kind: 'other' })] }, now: NOW, dryRun: true });
  assert.deepEqual(dry.created, [], 'a dry run promised to file an entry the real run refuses');
  assert.equal(dry.status, 'unclassified');
});

test('a dry run reports the key it WOULD file, and it is the id key', () => {
  const doc = emptyIssuesDoc();
  const r = ingestQueue(doc, { queue: { queue: [entry()] }, now: NOW, dryRun: true });
  assert.deepEqual(r.created, ['(dry) q:q-0a1b2c3d']);
  assert.deepEqual(Object.keys(doc.issues), []);
});

// End to end: synthetic audit passes -> bin/reconcile-findings.mjs -> queue.json -> bin/issue.mjs
// ingest --queue -> a temp store. The queue carries no `class`, as the real one does not.
test('a reconciled queue ingests through the CLI into a verified store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-queue-ingest-'));
  const inDir = join(dir, 'audit');
  mkdirSync(inDir);
  const rec = (o) => ({ file: 'src/widget.mjs', line: 12, severity: 'high', evidence: 'e', remediation: 'r',
    intentional: false, verdict: 'confirmed', note: '', ...o });
  const areas = (records) => JSON.stringify([{ area: 'fixture-area', summary: '', perProject: {}, findings: records, missed: [] }]);
  writeFileSync(join(inDir, 'findings-pass1.json'), areas([
    rec({ kind: 'erroring', summary: 'the synthetic widget throws on an empty list' }),
    rec({ kind: 'other', line: 30, summary: 'the synthetic widget names nothing in particular' }),
  ]));
  writeFileSync(join(inDir, 'findings-pass2.json'), areas([]));
  const reconciled = spawnSync(process.execPath, [join(REPO, 'bin', 'reconcile-findings.mjs'), '--in', inDir, '--root', dir, '--no-gate'],
    { cwd: REPO, encoding: 'utf8' });
  assert.equal(reconciled.status, 0, reconciled.stderr);
  const queuePath = join(inDir, 'queue.json');
  const written = JSON.parse(readFileSync(queuePath, 'utf8')).queue;
  assert.deepEqual(written.map((e) => [e.kind, e.disposition, 'class' in e]).sort(), [['erroring', 'open', false], ['other', 'open', false]]);

  const store = join(dir, 'issues.json');
  const ingest = spawnSync(process.execPath, [join(REPO, 'bin', 'issue.mjs'), 'ingest', '--queue', queuePath, '--json'],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, CW_ISSUES: store, CW_NOW: NOW } });
  assert.equal(ingest.status, 4, 'the refused `other` entry must make the run non-ok');
  const [summary] = JSON.parse(ingest.stdout).summaries;
  assert.equal(summary.status, 'unclassified');
  assert.equal(summary.created.length, 1);
  assert.match(summary.created[0], /^ISS-[A-Z0-9]+-F-/);
  assert.equal(summary.unclassified.length, 1);
  assert.match(summary.unclassified[0], /kind 'other'/);

  const doc = JSON.parse(readFileSync(store, 'utf8'));
  const [iss] = Object.values(doc.issues);
  assert.equal(iss.source.kind, 'queue');
  assert.equal(iss.area, 'fixture-area');
  assert.equal(iss.severity, 'high');
  assert.deepEqual(verifyChain(doc), []);
});
