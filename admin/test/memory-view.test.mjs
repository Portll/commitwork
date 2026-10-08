// The memory visualiser. The weight is on the EMPTY cases, because that is what this page opens on:
// measured 2026-09-07, 0 of 25 rollups on this disk carry a memory-layer-receipts.json and the
// default database carries neither memory table. A viewer that renders that as a calm empty table
// reports "nothing wrong" about a lane nobody has ever observed — the exact inversion the whole
// repo exists to catch. So: never-observed, store-absent, schema-absent and unreadable are asserted
// to be FOUR different renderings, and the two-axis verdict is asserted to be two CELLS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { open, put, recordReceipt } from '../../lib/memory-store.mjs';
import {
  ADAPTERS, adapterRow, adapterComparison, TONE_RANK, louder, stateTone, formTone,
  storeSnapshot, listRecords, listReceiptIdentities, rollupSurvey, diskReceiptIndex,
  observationState, normaliseReceipt, stepsForReceipt, recordView, buildModel, renderPage,
  sourceStep, redactStep, compareStep, verdictStep, readbackStep, acceptStep, RECEIPTS_FILE,
} from '../lib/memory-view.mjs';
import { houseTokens } from '../../lib/house-css.mjs';
import { routes } from '../routes/memory.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memview-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** N report directories, each with a rollup.json and (optionally) a receipts file beside it. */
function reportsRoot(dir, { rollups = 3, receiptsIn = [] } = {}) {
  const root = join(dir, 'reports');
  mkdirSync(root, { recursive: true });
  for (let i = 0; i < rollups; i++) {
    const d = join(root, `area${i}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'rollup.json'), JSON.stringify({ area: `area${i}`, repos: [] }, null, 2));
    const carry = receiptsIn.find((r) => r.area === i);
    if (carry) writeFileSync(join(d, RECEIPTS_FILE), JSON.stringify(carry.payload, null, 2));
  }
  return root;
}

const receipt = (over = {}) => ({
  external_id: 'commitwork:rollup:areaX:repo', adapter: 'veld', at: '2026-09-07T00:00:00.000Z',
  state: 'accepted-unverified', reason: 'memory-layer stored a preview, not the document',
  storedForm: 'preview', storedCoverage: 0.041,
  contentSha256: 'a'.repeat(64), storedSha256: 'b'.repeat(64),
  tagsSent: ['commitwork', 'scope:test'], tagsStoredCount: 5, truncated: false,
  id: 'veld-1', was_update: false, version: 1, ...over,
});

// ── THE EMPTY CASE ──────────────────────────────────────────────────────────

test('a store with a schema and ZERO receipts is NEVER-OBSERVED, and says so with the count', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();                       // schema created, nothing written
  const root = reportsRoot(dir, { rollups: 3 });

  const store = storeSnapshot({ path: db });
  assert.equal(store.state, 'present');
  assert.equal(store.storeAbsent, false, 'the store is here');
  assert.equal(store.neverObserved, true, 'and nothing has ever been observed in it — two separate facts');

  const o = observationState(store, rollupSurvey({ root }));
  assert.equal(o.state, 'never-observed');
  assert.equal(o.tone, 'grey', 'never-observed is grey: neither a pass nor a finding');
  assert.match(o.headline, /no write has ever been observed here: 0 receipts across 3 rollups/);
});

test('the empty page does not look clean — grey banner, no calm empty table', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();
  const root = reportsRoot(dir, { rollups: 3 });
  const html = renderPage(buildModel({ path: db, root }));

  assert.match(html, /no write has ever been observed here: 0 receipts across 3 rollups/);
  assert.match(html, /data-observation="never-observed"/);
  assert.match(html, /data-observation="never-observed" data-tone="grey"/, 'the banner tone is grey, never ok');
  assert.doesNotMatch(html, /data-observation="observed"/);
  // The identities table is NOT rendered empty; its absence is stated instead.
  assert.match(html, /data-identities="none"/);
  assert.match(html, /NO IDENTITY HAS A RECEIPT/);
  assert.match(html, /0 of 3 rollups/, 'the rollup denominator is on the page, not just the numerator');
});

test('store-absent and never-observed are DIFFERENT renderings, not one empty', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 3 });

  const missing = storeSnapshot({ path: join(dir, 'never-created.db') });
  assert.equal(missing.state, 'absent');
  assert.equal(missing.storeAbsent, true);
  const oAbsent = observationState(missing, rollupSurvey({ root }));

  const present = join(dir, 'm.db');
  open({ path: present }).close();
  const oEmpty = observationState(storeSnapshot({ path: present }), rollupSurvey({ root }));

  assert.equal(oAbsent.state, 'store-absent');
  assert.equal(oEmpty.state, 'never-observed');
  assert.notEqual(oAbsent.headline, oEmpty.headline, 'two different facts must not share a sentence');
  assert.match(oAbsent.headline, /no memory store exists/);
  assert.match(oEmpty.headline, /0 receipts across 3 rollups/);

  const htmlAbsent = renderPage(buildModel({ path: join(dir, 'never-created.db'), root }));
  const htmlEmpty = renderPage(buildModel({ path: present, root }));
  assert.match(htmlAbsent, /data-store="absent"/);
  assert.match(htmlEmpty, /data-store="present"/);
  assert.notEqual(htmlAbsent, htmlEmpty);
});

test('a database with no memory tables is a THIRD state — absence of writing, not a red fault', (t) => {
  const dir = tmp(t);
  const p = join(dir, 'other.db');
  const db = new DatabaseSync(p);
  db.exec('CREATE TABLE something_else (a TEXT)');
  db.close();

  const s = storeSnapshot({ path: p });
  assert.equal(s.state, 'schema-absent', 'the file exists; the schema does not');
  assert.equal(s.storeAbsent, false, 'the FILE is not absent — that is the point of the distinction');
  assert.equal(s.neverObserved, true);
  const o = observationState(s, rollupSurvey({ root: reportsRoot(dir, { rollups: 2 }) }));
  assert.equal(o.state, 'schema-absent');
  assert.equal(o.tone, 'grey', 'over-reporting is not the safe direction: this is grey, not an alarm');
  assert.match(o.headline, /no write has ever been observed here/);
  // and the listings agree rather than raising
  assert.equal(listRecords({ path: p }).state, 'schema-absent');
  assert.equal(listReceiptIdentities({ path: p }).state, 'schema-absent');
});

test('an UNREADABLE store is a fault and never an empty one', (t) => {
  const dir = tmp(t);
  const notADb = join(dir, 'adir');
  mkdirSync(notADb);                                 // stat() succeeds, sqlite cannot open it
  const s = storeSnapshot({ path: notADb });
  assert.equal(s.state, 'unreadable');
  assert.equal(s.records, null, 'null, never 0 — a fault has no count');
  assert.equal(s.neverObserved, null, 'and no verdict about observation either');
  const o = observationState(s, rollupSurvey({ root: reportsRoot(dir, { rollups: 1 }) }));
  assert.equal(o.state, 'unreadable');
  assert.equal(o.tone, 'alarm');
  assert.match(renderPage(buildModel({ path: notADb, root: join(dir, 'reports') })), /data-store="unreadable"/);
});

test('an unreadable ROLLUP population is UNKNOWN, never zero', () => {
  const sv = rollupSurvey({ root: '/nonexistent/reports/root' });
  assert.equal(sv.state, 'unreadable');
  assert.equal(sv.rollups, null, 'null population — 0 would become a denominator somebody quotes');
  assert.match(sv.reason, /unreadable/);
  const o = observationState({ state: 'present', path: '/x', receipts: 0, records: 0, neverObserved: true }, sv);
  assert.match(o.headline, /could not read/, 'the headline must not claim "0 across 0 rollups"');
});

test('an unparseable receipts file is unreadable, never an empty receipt set', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 1 });
  writeFileSync(join(root, 'area0', RECEIPTS_FILE), '{ this is not json');
  const sv = rollupSurvey({ root });
  assert.equal(sv.sites.length, 1);
  assert.equal(sv.sites[0].receipts.state, 'unreadable');
  assert.equal(sv.withReceipts, 0);
  assert.equal(sv.unreadable, 1, 'counted apart from the ones that are simply not there');
  assert.match(renderPage(buildModel({ path: join(dir, 'gone.db'), root })), /unparseable/);
});

// ── THE TWO AXES ────────────────────────────────────────────────────────────

test('a previewed write renders ACCEPTED and NOT-A-COPY at the same time, in two cells', () => {
  const v = verdictStep(normaliseReceipt(receipt()));
  assert.equal(v.axes.length, 2);
  assert.equal(v.axes[0].axis, 'state');
  assert.equal(v.axes[0].value, 'accepted-unverified');
  assert.equal(v.axes[1].axis, 'storedForm');
  assert.equal(v.axes[1].value, 'preview');
  assert.ok(v.notes.some((n) => /BOTH FACTS AT ONCE/.test(n)));

  const trail = stepsForReceipt(receipt());
  const html = renderPage({
    generatedAt: 'T', dbPath: '/x',
    store: { state: 'present', path: '/x', records: 1, bytes: 1, receipts: 1, neverObserved: false, adapters: { veld: {} } },
    survey: { state: 'ok', root: '/r', sites: [], rollups: 0, withReceipts: 0, receipts: 0 },
    observation: { state: 'observed', tone: 'ok', headline: 'h', detail: 'd' },
    adapters: adapterComparison({ veld: { total: 1 } }),
    records: [], identities: [{ external_id: 'x', receipts: 1, last_at: 'T' }],
    record: { externalId: 'x', record: null, recordReason: 'r', receiptsReason: null, trails: [trail], trailsReason: null },
  });
  const stateCell = html.match(/<td[^>]*data-axis="state"[^>]*>[\s\S]*?<\/td>/);
  const formCell = html.match(/<td[^>]*data-axis="storedForm"[^>]*>[\s\S]*?<\/td>/);
  assert.ok(stateCell && formCell, 'both axes must be their own cells');
  assert.match(stateCell[0], /accepted-unverified/);
  assert.doesNotMatch(stateCell[0], /preview/, 'the state cell must not carry the stored form — that is one badge again');
  assert.match(formCell[0], /preview/);
  assert.match(html, /NOT A DURABLE COPY/);
  assert.match(html, /storedForm — Is what the backend holds a durable copy\?/);
});

test('DIVERGENT renders louder than preview — corruption keeps its own volume', () => {
  assert.equal(formTone('preview'), 'warn');
  assert.equal(formTone('divergent'), 'alarm');
  assert.ok(TONE_RANK.alarm > TONE_RANK.warn);
  assert.equal(louder('warn', 'alarm'), 'alarm');

  const div = verdictStep(normaliseReceipt(receipt({ state: 'failed', storedForm: 'divergent', reason: 'stored text is not derived from the source' })));
  const prev = verdictStep(normaliseReceipt(receipt()));
  assert.equal(div.tone, 'alarm');
  assert.equal(prev.tone, 'warn');
  assert.ok(TONE_RANK[div.tone] > TONE_RANK[prev.tone], 'divergent must outrank preview, never merely differ');
  assert.ok(div.notes.some((n) => /CORRUPTION|corruption/.test(n)));
});

test('a dry run is grey on the state axis — never folded into failed', () => {
  const v = verdictStep(normaliseReceipt(receipt({ state: 'dry-run', storedForm: 'unknown', reason: 'not attempted' })));
  assert.equal(v.axes[0].tone, 'grey');
  assert.equal(stateTone('dry-run'), 'grey');
  assert.notEqual(stateTone('dry-run'), stateTone('failed'));
  assert.ok(v.notes.some((n) => /wrote nothing and lost nothing/.test(n)));
});

test('an UNDECLARED state announces itself instead of inheriting a verdict', () => {
  const v = verdictStep(normaliseReceipt(receipt({ state: 'something-new' })));
  assert.equal(v.axes[0].declared, false);
  assert.equal(v.axes[0].tone, 'grey');
  assert.match(v.axes[0].meaning, /does not declare/);
});

// ── EVERY STEP GREYS WITH A REASON ──────────────────────────────────────────

test('a bare receipt yields eight steps, and every unobservable field carries its reason', () => {
  const t8 = stepsForReceipt({ external_id: 'x', adapter: 'veld', at: null, state: null, storedForm: null });
  assert.equal(t8.steps.length, 8);
  assert.deepEqual(t8.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const s of t8.steps) {
    if (s.state === 'grey') assert.ok(s.reason && s.reason.length > 20, `step ${s.n} is grey with no reason`);
    for (const f of s.fields) {
      if (f.state === 'grey') assert.ok(f.reason && f.reason.length > 10, `${s.key}.${f.label} is grey with no reason`);
      else assert.notEqual(f.value, null, `${s.key}.${f.label} claims observed with a null value`);
    }
  }
  // the three steps that cannot possibly be observed from this receipt
  assert.equal(t8.steps[0].state, 'grey');            // SOURCE — nothing names an artefact
  assert.match(t8.steps[0].fields[0].reason, /no source column|names a source artefact/);
  assert.equal(t8.steps[2].state, 'grey');            // LOCAL — no record row
  assert.match(t8.steps[7].fields[0].reason, /never recorded/);  // VERDICT — no state
});

test('the rendered page has no blank cells', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const conn = open({ path: db });
  put({ external_id: 'id:1', content: 'hello world', tags: ['t'] }, { scope: 'test', db: conn });
  recordReceipt(receipt({ external_id: 'id:1' }), { db: conn });
  conn.close();
  const html = renderPage(buildModel({ path: db, root: reportsRoot(dir, { rollups: 1 }) }));
  assert.doesNotMatch(html, /<td[^>]*><\/td>/, 'a blank cell is a step that could not be observed, unlabelled');
  assert.match(html, /not observed/, 'and the greys say so in words');
});

// ── COMPARE: THREE WITNESSES, SEPARATELY ────────────────────────────────────

test('coverage, containment and length ratio are three separate bars', () => {
  const s = compareStep(normaliseReceipt(receipt()));
  assert.equal(s.bars.length, 3);
  assert.match(s.bars[0].label, /^coverage/);
  assert.match(s.bars[1].label, /^containment/);
  assert.match(s.bars[2].label, /^length ratio/);
  assert.equal(s.bars[0].state, 'observed');
  assert.equal(s.bars[0].value, 0.041);
  // The two witnesses the schema does not persist are GREY WITH THE REASON, never 0.
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[1].value, null);
  assert.match(s.bars[1].reason, /not persisted/);
  assert.equal(s.bars[2].state, 'grey');
});

test('identical hashes derive all three witnesses, and say they were derived', () => {
  const s = compareStep(normaliseReceipt(receipt({ storedSha256: 'a'.repeat(64), storedForm: 'full', state: 'verified' })));
  assert.equal(s.fields.find((f) => f.label === 'hashes').value, 'IDENTICAL');
  for (const b of s.bars) {
    assert.equal(b.state, 'observed');
    assert.equal(b.value, 1);
    assert.match(b.note, /derived from hash equality/);
  }
});

test('a supplied classification fills the two unpersisted witnesses', () => {
  const s = compareStep(normaliseReceipt(receipt()), { classification: { coverage: 0.04, containment: 0.98, lengthRatio: 0.05 } });
  assert.deepEqual(s.bars.map((b) => b.value), [0.04, 0.98, 0.05]);
  assert.ok(s.bars.every((b) => b.state === 'observed'));
});

test('one hash alone is not a comparison', () => {
  const s = compareStep(normaliseReceipt(receipt({ storedSha256: null })));
  const h = s.fields.find((f) => f.label === 'hashes');
  assert.equal(h.state, 'grey');
  assert.match(h.reason, /that is not a match/);
});

// ── STEPS 5 AND 6 ───────────────────────────────────────────────────────────

test('was_update null is UNKNOWN, never an insert', () => {
  const s = acceptStep(normaliseReceipt(receipt({ was_update: null })));
  const f = s.fields.find((x) => x.label === 'was_update');
  assert.equal(f.state, 'grey');
  assert.match(f.reason, /an unknown is NOT an insert/);
});

test('minted tags and dropped tags are opposite facts and read differently', () => {
  const minted = readbackStep(normaliseReceipt(receipt({ tagsStoredCount: 5 })));
  assert.match(minted.fields.find((f) => f.label === 'tags stored').value, /5 \(3 minted/);
  const dropped = readbackStep(normaliseReceipt(receipt({ tagsStoredCount: 1 })));
  const f = dropped.fields.find((x) => x.label === 'tags stored');
  assert.match(f.value, /SENT TAG\(S\) DROPPED/);
  assert.equal(f.tone, 'warn');
  // stored BYTES were never recorded anywhere, and the step says which column is missing
  assert.match(minted.fields.find((x) => x.label === 'stored bytes').reason, /no stored-bytes column/);
});

// ── REDACTION ───────────────────────────────────────────────────────────────

test('a refused write renders the gate verdict as REFUSED, not as a missing step', () => {
  const s = redactStep(normaliseReceipt(receipt({ state: 'failed', reason: 'redaction gate refused: record carries a credential-bearing key: token' })), null);
  const v = s.fields.find((f) => f.label === 'verdict');
  assert.equal(v.value, 'REFUSED');
  assert.equal(v.tone, 'alarm');
  assert.match(v.note, /credential-bearing key: token/);
});

test('with no verdict recorded and no row to re-check, the gate is UNWITNESSED — not passed', () => {
  const s = redactStep(normaliseReceipt(receipt({ reason: null })), null);
  const v = s.fields.find((f) => f.label === 'verdict');
  assert.equal(v.state, 'grey');
  assert.match(v.reason, /UNWITNESSED/);
});

test('with a stored row the same gate is re-run and its result is labelled as a re-run', () => {
  const s = redactStep(normaliseReceipt(receipt({ reason: null })), { content: 'plain prose', tags: [], external_id: 'x', memory_type: 'Context' });
  const v = s.fields.find((f) => f.label === 'verdict');
  assert.equal(v.state, 'observed');
  assert.match(v.value, /re-run against the stored row/);
});

// ── ADAPTERS ────────────────────────────────────────────────────────────────

test('the adapter table states stored form as a PROPERTY OF THE BACKEND', () => {
  assert.equal(adapterRow('local').expectedStoredForm, 'full');
  assert.equal(adapterRow('veld').expectedStoredForm, 'preview');
  for (const a of ADAPTERS) assert.ok(a.source, `${a.adapter} declares a capability with no provenance`);
  const html = renderPage(buildModel({ path: '/nonexistent/none.db', root: '/nonexistent/root' }));
  assert.match(html, /data-adapter="local"[^>]*>[\s\S]*?data-expected-form="full"/);
  assert.match(html, /data-adapter="veld"[^>]*>[\s\S]*?data-expected-form="preview"/);
});

test('a declared adapter with no receipts is NEVER-OBSERVED, not a clean zero', () => {
  const rows = adapterComparison({});
  assert.ok(rows.every((r) => r.observation === 'never-observed'));
  assert.match(rows[0].observationReason, /not a clean run/);
  const unknown = adapterComparison(null);
  assert.ok(unknown.every((r) => r.observation === 'unknown'), 'an unreadable store knows nothing about any backend');
});

test('an adapter observed but undeclared is named as such', () => {
  const rows = adapterComparison({ 'some-new-backend': { total: 3 } });
  const row = rows.find((r) => r.adapter === 'some-new-backend');
  assert.ok(row);
  assert.equal(row.declared, false);
  assert.match(row.observationReason, /per-record surprise/);
});

// ── THE JOIN TO DISK ────────────────────────────────────────────────────────

test('a receipts file on disk supplies the SOURCE step: path, bytes, sha256, mtime', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 2 });
  const rollupPath = join(root, 'area0', 'rollup.json');
  writeFileSync(join(root, 'area0', RECEIPTS_FILE), JSON.stringify({
    generated: '2026-09-07T00:00:00.000Z', area: 'area0', rollup: rollupPath,
    receipts: [receipt({ external_id: 'commitwork:rollup:area0:repo' })],
  }));
  const sv = rollupSurvey({ root });
  assert.equal(sv.withReceipts, 1);
  assert.equal(sv.rollups, 2);
  const idx = diskReceiptIndex(sv);
  assert.equal(idx.get('commitwork:rollup:area0:repo').length, 1);

  const rv = recordView('commitwork:rollup:area0:repo', { path: join(dir, 'none.db'), survey: sv });
  assert.equal(rv.trails.length, 1, 'a receipt on disk is a trail even with no local store');
  const src = rv.trails[0].steps[0];
  assert.equal(src.state, 'observed');
  assert.equal(src.fields.find((f) => f.label === 'artefact').value, rollupPath);
  assert.ok(src.fields.find((f) => f.label === 'bytes').value > 0);
  assert.match(src.fields.find((f) => f.label === 'sha256').value, /^[0-9a-f]{64}$/);
  assert.ok(src.fields.find((f) => f.label === 'mtime').value);
  // and the LOCAL step is grey, because there is no local row for it
  assert.equal(rv.trails[0].steps[2].state, 'grey');
});

test('an identity with no receipt anywhere says so instead of drawing eight empty steps', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const conn = open({ path: db });
  put({ external_id: 'id:lonely', content: 'a durable local write with no receipt', tags: [] }, { scope: 'test', db: conn });
  conn.close();
  const rv = recordView('id:lonely', { path: db, survey: rollupSurvey({ root: reportsRoot(dir, { rollups: 1 }) }) });
  assert.equal(rv.trails.length, 0);
  assert.match(rv.trailsReason, /no write has ever been observed for this identity/);
  const html = renderPage(buildModel({ path: db, root: join(dir, 'reports') }));
  assert.match(html, /data-trails="none"/);
  assert.match(html, /will not render eight empty steps as eight passed ones/);
});

// ── A REAL ROUND TRIP ───────────────────────────────────────────────────────

test('a real local write renders as verified AND full, with the version and byte count', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const conn = open({ path: db });
  const r = put({ external_id: 'id:real', content: 'the durable content', tags: ['x'] }, { scope: 'test', db: conn });
  assert.equal(r.state, 'verified');
  recordReceipt(r, { db: conn });
  conn.close();

  const rv = recordView('id:real', { path: db, survey: rollupSurvey({ root: reportsRoot(dir, { rollups: 1 }) }) });
  assert.equal(rv.trails.length, 1);
  const [source, redact, local, send, accept, readback, compare, verdict] = rv.trails[0].steps;
  assert.equal(source.state, 'grey', 'a local write names no artefact on disk, and says that rather than inventing one');
  assert.equal(redact.fields.find((f) => f.label === 'verdict').state, 'observed');
  assert.equal(local.fields.find((f) => f.label === 'row version').value, 1);
  assert.equal(local.fields.find((f) => f.label === 'content bytes').value, Buffer.byteLength('the durable content'));
  assert.equal(send.fields.find((f) => f.label === 'bytes sent').state, 'observed', 'a matching hash lets the byte count be derived');
  // Was 'grey' — the view rendered what was RECORDED, and nothing was, because put()'s `wasUpdate`
  // never reached recordReceipt()'s `was_update`. Fixed 2026-09-07 after this view made it visible;
  // the canary is now genuinely observable rather than permanently absent on the local adapter.
  assert.equal(accept.fields.find((f) => f.label === 'was_update').state, 'observed');
  assert.ok(readback.fields.find((f) => f.label === 'stored sha256').state === 'observed');
  assert.ok(compare.bars.every((b) => b.state === 'observed'));
  assert.equal(verdict.axes[0].value, 'verified');
  assert.equal(verdict.axes[1].value, 'full');
});

test('REGRESSION (was a live defect): the insert/update canary reaches the table', (t) => {
  // This test was written asserting the DEFECT: put() returned `wasUpdate` while recordReceipt()
  // persisted `r.was_update`, so the receipt in hand knew it was an insert and the receipt in the
  // table did not — for every local write ever made. That is the canary the client calls its
  // regression detector for a moving external_id, and it was silently null on one of the two
  // adapters, because a mismatched key returns undefined rather than throwing and `null` is a
  // legitimate value here ("the backend did not say").
  //
  // Fixed on 2026-09-07 once the view made it visible. The assertion is INVERTED rather than
  // deleted, so the fix is now pinned by the test that found it.
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const conn = open({ path: db });

  const inHand = put({ external_id: 'id:canary', content: 'first', tags: [] }, { scope: 'test', db: conn });
  assert.equal(normaliseReceipt(inHand).wasUpdate, false, 'in hand, the receipt knows it was an insert');
  recordReceipt(inHand, { db: conn });

  const again = put({ external_id: 'id:canary', content: 'second', tags: [] }, { scope: 'test', db: conn });
  recordReceipt(again, { db: conn });

  const rows = conn.prepare('SELECT was_update FROM memory_receipt WHERE external_id = ? ORDER BY id').all('id:canary');
  conn.close();
  assert.equal(rows[0].was_update, 0, 'the insert reaches the table');
  assert.equal(rows[1].was_update, 1, 'and so does the update — a moving id would show as two inserts');
});

// ── SELF-CONTAINMENT, DETERMINISM, ENV ──────────────────────────────────────

test('the document is self-contained: no link, no external script, no CDN, no external font', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const conn = open({ path: db });
  put({ external_id: 'id:1', content: 'hello', tags: [] }, { scope: 'test', db: conn });
  recordReceipt(receipt({ external_id: 'id:1' }), { db: conn });
  conn.close();
  const html = renderPage(buildModel({ path: db, root: reportsRoot(dir, { rollups: 1 }) }));
  assert.doesNotMatch(html, /<script[^>]*\bsrc=/i, 'the theme switch is inlined, never loaded');
  assert.equal((html.match(/<script\b[^>]*>/gi) || []).length, 1, 'the one script is the inlined theme switch');
  assert.match(html, /data-theme-switch/);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /https?:\/\//, 'nothing is fetched from anywhere');
  assert.equal((html.match(/<style>/g) || []).length, 1, 'one style block, which the panel hashes into its CSP');
  assert.ok(html.includes(houseTokens()), 'the house tokens travel with the page');
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ''), /#[0-9a-f]{6}\b/i, 'a colour outside the tokens is a second palette');
  assert.match(html, /^<!doctype html>/);
});

test('CW_NOW makes the page byte-identical across renders', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();
  const root = reportsRoot(dir, { rollups: 2 });
  const prev = process.env.CW_NOW;
  process.env.CW_NOW = '2026-09-07T12:00:00.000Z';
  t.after(() => { if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev; });
  assert.equal(renderPage(buildModel({ path: db, root })), renderPage(buildModel({ path: db, root })));
});

test('the report root env override is read at CALL time, not at module load', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 4 });
  const prev = process.env.CW_MEMORY_VIEW_ROOT;
  process.env.CW_MEMORY_VIEW_ROOT = root;
  t.after(() => { if (prev === undefined) delete process.env.CW_MEMORY_VIEW_ROOT; else process.env.CW_MEMORY_VIEW_ROOT = prev; });
  assert.equal(rollupSurvey({}).rollups, 4, 'an env captured at import would have defeated this');
});

test('content NEVER reaches the page — hashes, bytes and tags only', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  const secretish = 'THE-QUICK-BROWN-CONTENT-STRING-THAT-MUST-NOT-BE-RENDERED';
  const conn = open({ path: db });
  const r = put({ external_id: 'id:c', content: secretish, tags: ['t'] }, { scope: 'test', db: conn });
  recordReceipt(r, { db: conn });
  conn.close();
  const html = renderPage(buildModel({ path: db, root: reportsRoot(dir, { rollups: 1 }) }));
  assert.doesNotMatch(html, new RegExp(secretish));
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  assert.match(html, new RegExp(r.contentSha256), 'the hash stands in for the content');
});

// ── THE ROUTE ───────────────────────────────────────────────────────────────

const fakeCtx = ({ session = { user: 'op' }, query = '' } = {}) => {
  const out = {};
  return {
    ctx: {
      req: {}, res: {},
      query: new URLSearchParams(query),
      adminSession: () => session,
      send: (code, body, ct) => { out.code = code; out.body = body; out.ct = ct; return true; },
    },
    out,
  };
};

test('both routes are declared, GET, and named as expected', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), ['GET /api/memory-view', 'GET /api/memory-view.html']);
});

test('no session, no view — on both routes', () => {
  for (const r of routes) {
    const { ctx, out } = fakeCtx({ session: null });
    r.handle(ctx);
    assert.equal(out.code, 401);
  }
});

test('the JSON route returns the model, and the HTML route the document', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();
  const root = reportsRoot(dir, { rollups: 3 });
  const prevDb = process.env.CW_MEMORY_DB;
  const prevRoot = process.env.CW_MEMORY_VIEW_ROOT;
  process.env.CW_MEMORY_DB = db;
  process.env.CW_MEMORY_VIEW_ROOT = root;
  t.after(() => {
    if (prevDb === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = prevDb;
    if (prevRoot === undefined) delete process.env.CW_MEMORY_VIEW_ROOT; else process.env.CW_MEMORY_VIEW_ROOT = prevRoot;
  });

  const j = fakeCtx();
  routes[0].handle(j.ctx);
  assert.equal(j.out.code, 200);
  assert.equal(j.out.body.observation.state, 'never-observed');
  assert.match(j.out.body.observation.headline, /0 receipts across 3 rollups/);

  const h = fakeCtx();
  routes[1].handle(h.ctx);
  assert.equal(h.out.code, 200);
  assert.match(h.out.ct, /text\/html/);
  assert.match(h.out.body, /data-observation="never-observed"/);
});

test('a nonsense limit is clamped and REPORTED, never silently applied', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();
  const prevDb = process.env.CW_MEMORY_DB;
  const prevRoot = process.env.CW_MEMORY_VIEW_ROOT;
  process.env.CW_MEMORY_DB = db;
  process.env.CW_MEMORY_VIEW_ROOT = reportsRoot(dir, { rollups: 1 });
  t.after(() => {
    if (prevDb === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = prevDb;
    if (prevRoot === undefined) delete process.env.CW_MEMORY_VIEW_ROOT; else process.env.CW_MEMORY_VIEW_ROOT = prevRoot;
  });
  const { ctx, out } = fakeCtx({ query: 'limit=-4' });
  routes[0].handle(ctx);
  assert.equal(out.code, 200);
  assert.match(out.body.requestNotes.join(' '), /not a positive number/);
});

// The HTML route's two documents of its own take the house sheet (docs/THEME.md §11): the request
// notes are a --part warning, and the 503 is an unknown, drawn without a state colour (Rule 7).
test('the HTML route reports a clamped limit in --part, not a literal colour', (t) => {
  const dir = tmp(t);
  const db = join(dir, 'm.db');
  open({ path: db }).close();
  const prevDb = process.env.CW_MEMORY_DB;
  const prevRoot = process.env.CW_MEMORY_VIEW_ROOT;
  process.env.CW_MEMORY_DB = db;
  process.env.CW_MEMORY_VIEW_ROOT = reportsRoot(dir, { rollups: 1 });
  t.after(() => {
    if (prevDb === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = prevDb;
    if (prevRoot === undefined) delete process.env.CW_MEMORY_VIEW_ROOT; else process.env.CW_MEMORY_VIEW_ROOT = prevRoot;
  });
  const { ctx, out } = fakeCtx({ query: 'limit=-4' });
  routes[1].handle(ctx);
  assert.equal(out.code, 200);
  const notes = /<p([^>]*)>([^<]*not a positive number[^<]*)<\/p>/.exec(out.body);
  assert.ok(notes, 'the request notes are missing from the page');
  assert.equal(notes[1], ' style="color:var(--part)"');
});

test('the 503 document takes the house sheet and the theme follower, and draws the failure as an unknown', async () => {
  const { renderUnavailable } = await import('../lib/memory-view.mjs');
  const { houseCss } = await import('../../lib/house-css.mjs');
  const { followerScript } = await import('../../lib/theme-follower.mjs');
  const html = renderUnavailable('store <locked>');
  assert.ok(html.includes(houseCss({ fonts: 'none' })), 'the house sheet, no font');
  assert.ok(html.includes(followerScript()), 'the theme follower');
  const own = html.replace(houseCss({ fonts: 'none' }), '').replace(followerScript(), '');
  assert.doesNotMatch(own.replace(/\b1px\b/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(|\d(?:px|pt)\b|system-ui|BlinkMacSystemFont/i, 'a literal colour, a size that is not a hairline, or a font of its own');
  assert.doesNotMatch(own, /var\(--(?:crit|high|med|low|live|part|sev)\)/, 'an unknown takes no state colour');
  assert.match(own, /<span class="pill unk">unknown<\/span>/);
  assert.match(own, /store &lt;locked&gt;/, 'the reason is escaped');
});

// ── THE EXPORT AXIS ─────────────────────────────────────────────────────────
//
// Measured on this box 2026-10-03: 34 of 34 rollups carried a receipts file and 42 of the 390
// receipts in them recorded a write that never happened — and this page rendered every site as
// `N receipts` in an ok pill, under a grey banner about the LOCAL store, which is a different
// backend. Presence of a receipt file is not the health of the export, and these tests are the
// ratchet on that.

const exported = (receipts, over = {}) => ({
  generated: '2026-10-03T10:00:00.000Z', area: 'areaX', contractVersion: 1, receipts, ...over,
});
const sent = (over = {}) => receipt({ state: 'verified', storedForm: 'full', storedSha256: 'a'.repeat(64), reason: null, ...over });

test('a site whose every write FAILED does not render as a clean receipt count', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 2, receiptsIn: [
    { area: 0, payload: exported([sent(), sent()]) },
    { area: 1, payload: exported([...Array(22)].map(() => receipt({ state: 'failed', storedForm: 'unknown', reason: 'HTTP 500' }))) },
  ] });
  const sv = rollupSurvey({ root });

  assert.equal(sv.withReceipts, 2, 'both sites carry a receipt file — the fact that used to be the only one');
  assert.equal(sv.exports.failedReceipts, 22);
  assert.equal(sv.exports.byState.failed, 1);
  assert.equal(sv.exports.byState.verified, 1);

  const html = renderPage(buildModel({ path: join(dir, 'none.db'), root }));
  const rows = [...html.matchAll(/data-export-state="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['failed', 'verified'], 'worst first, and the failed site is named as failed');
  assert.equal(/data-exports="failed"/.test(html), true);
});

test('a failed export is ALARM even while the local store is grey — two backends, two sentences', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 1, receiptsIn: [
    { area: 0, payload: exported([receipt({ state: 'failed', storedForm: 'unknown', reason: 'HTTP 500' })]) },
  ] });
  // No database at all: the LOCAL half is grey, which is the live shape on this box.
  const store = storeSnapshot({ path: join(dir, 'never-created.db') });
  const o = observationState(store, rollupSurvey({ root }));

  assert.equal(o.local.tone, 'grey', 'the local store has never been written — that stays grey');
  assert.equal(o.exports.tone, 'alarm');
  assert.equal(o.tone, 'alarm', 'the banner takes the LOUDER of the two; the quiet half may not bury the loud one');
  assert.equal(o.state, store.state === 'absent' ? 'store-absent' : o.state,
    'the store half keeps its own state so existing readers do not shift');
  assert.match(o.exports.headline, /FAILED/);

  const html = renderPage(buildModel({ path: join(dir, 'never-created.db'), root }));
  assert.equal(/data-banner-tone="alarm"/.test(html), true);
  assert.equal(/data-export-observation="failed"/.test(html), true);
  assert.equal(/data-observation="store-absent"/.test(html), true, 'both sentences are in the document');
});

test('UNMEASURED is grey, not amber — an area with no receipt is neither a pass nor a finding', (t) => {
  const dir = tmp(t);
  // Three rollups, no receipts anywhere: the shape the two older grey tests on this page assert,
  // and the shape a first cut of this lane graded `warn`. Over-reporting is not the safe direction.
  const o = observationState(storeSnapshot({ path: join(dir, 'x.db') }), rollupSurvey({ root: reportsRoot(dir, { rollups: 3 }) }));
  assert.equal(o.exports.state, 'never-observed');
  assert.equal(o.exports.tone, 'grey');
  assert.equal(o.tone, 'grey');
  assert.match(o.exports.detail, /neither a pass nor a finding|not a finding/);
});

test('a clean export says so, and only when every area measured clean', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 2, receiptsIn: [
    { area: 0, payload: exported([sent()]) },
    { area: 1, payload: exported([sent()]) },
  ] });
  const o = observationState(storeSnapshot({ path: join(dir, 'x.db') }), rollupSurvey({ root }));
  assert.equal(o.exports.state, 'verified');
  assert.equal(o.exports.tone, 'ok');

  // One unmeasured area and the headline stops claiming the fleet is clean.
  const mixed = reportsRoot(mkdtempSync(join(tmpdir(), 'cw-memview-mix-')), { rollups: 2, receiptsIn: [{ area: 0, payload: exported([sent()]) }] });
  const o2 = observationState(storeSnapshot({ path: join(dir, 'x.db') }), rollupSurvey({ root: mixed }));
  assert.equal(o2.exports.state, 'partly-observed');
  assert.equal(o2.exports.tone, 'grey');
  assert.match(o2.exports.headline, /1 of 2 areas report a clean export/);
});

test('an unparseable receipts file makes the export UNKNOWN, never clean', (t) => {
  const dir = tmp(t);
  const root = reportsRoot(dir, { rollups: 1 });
  writeFileSync(join(root, 'area0', RECEIPTS_FILE), '{"receipts":[');
  const sv = rollupSurvey({ root });
  assert.equal(sv.sites[0].health.state, 'unreadable');
  const o = observationState(storeSnapshot({ path: join(dir, 'x.db') }), sv);
  assert.equal(o.exports.tone, 'alarm', 'a fault is louder than a degradation and never quieter than clean');
});

test('the export axis survives a model that predates it instead of taking the page down', () => {
  // A payload with no `exports` on the survey and no halves on the observation: the renderer states
  // the absence. A renderer that throws here is the empty-page inversion, seven blocks wide.
  const html = renderPage({
    generatedAt: 'T', dbPath: '/x',
    store: { state: 'present', path: '/x', records: 0, bytes: 0, receipts: 0, neverObserved: true, adapters: {} },
    survey: { state: 'ok', root: '/r', sites: [], rollups: 0, withReceipts: 0, receipts: 0 },
    observation: { state: 'observed', tone: 'ok', headline: 'h', detail: 'd' },
    adapters: adapterComparison({}), records: [], identities: [], record: null,
  });
  assert.match(html, /was not supplied/);
  assert.equal(/data-exports="unsupplied"/.test(html), true);
});
