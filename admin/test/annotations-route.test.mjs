// admin/routes/annotations.mjs — the scanner-annotation write path, module-level with a fake
// dispatcher ctx: no session ⇒ 401, same validator as the rollup, zero-match ⇒ 409 (force:true
// overrides), the response never claims the finding gone, unparseable store ⇒ 503 unclobbered.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { routes } from '../routes/annotations.mjs';
import { acquireLock } from '../../monitor/lockfile.mjs';
import { annotationsLockPath } from '../../monitor/annotate-lib.mjs';

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/annotations/scanner');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/annotations/scanner');

let TMP, STORE;
beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'cw-annroute-'));
  STORE = join(TMP, 'annotations.json');
  process.env.CW_ANNOTATIONS = STORE;
  writeFileSync(STORE, JSON.stringify({ annotations: [], scannerAnnotations: [] }));
});

// one call's worth of fake dispatcher ctx; returns what send() was called with
function call(route, { session = { user: 'op@example.com', provider: 'local' }, body, query = '' } = {}) {
  let out = null;
  const ctx = {
    req: {},
    query: new URLSearchParams(query),
    adminSession: () => session,
    send: (status, payload) => { out = { status, payload }; },
    readJsonBody: (_req, cb) => cb(body, null),
  };
  route.handle(ctx);
  return out;
}

// Relative to now: the route refuses an expiry in the past, so a fixed date fails the day it passes.
const daysAhead = (n) => new Date(Date.now() + n * 864e5).toISOString();
const EXPIRES = daysAhead(90);
const REVIEW = daysAhead(30);
const VALID = { project: '', category: 'secrets', repo: 'clientD', rule: 'jwt', file: 'a.html', action: 'false-positive', reason: 'verified placeholder', expires: EXPIRES };

describe('gate + validation', () => {
  test('both routes exist and refuse without a session — loopback included', () => {
    assert.ok(GET && POST, 'routes must be exported for the serve.mjs dispatcher');
    assert.equal(call(GET, { session: null }).status, 401);
    assert.equal(call(POST, { session: null, body: VALID }).status, 401);
  });

  test('an invalid record is a 400 with the defects named — same validator as the rollup', () => {
    const { rule, ...noRule } = VALID;
    const r = call(POST, { body: noRule });
    assert.equal(r.status, 400);
    assert.ok(r.payload.errors.some((e) => e.includes("identity field 'rule'")));
    assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0, 'nothing written');
  });

  test('a non-suppressing action is refused — note/resolved cannot ride the FP button', () => {
    assert.equal(call(POST, { body: { ...VALID, action: 'note' } }).status, 400);
    assert.equal(call(POST, { body: { ...VALID, action: 'delete-it' } }).status, 400);
  });

  test('who and at from the body are IGNORED — the session signs, the server clocks', () => {
    const r = call(POST, { body: { ...VALID, who: 'forged', at: '1999-01-01T00:00:00.000Z' } });
    assert.equal(r.status, 200);
    assert.equal(r.payload.record.who, 'op@example.com (local)');
    assert.notEqual(r.payload.record.at, '1999-01-01T00:00:00.000Z');
  });

  // expires is required at write time — a version-less identity with no expires is a permanent blindfold
  test('a record with no expires is a 400 naming why — never a silent write', () => {
    const { expires, ...noExpires } = VALID;
    const r = call(POST, { body: noExpires });
    assert.equal(r.status, 400);
    assert.ok(r.payload.errors.some((e) => e.includes('missing expires')));
    assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0, 'nothing written');
  });

  test('a record WITH expires is accepted and the stored record carries it', () => {
    const r = call(POST, { body: VALID });
    assert.equal(r.status, 200);
    assert.equal(r.payload.record.expires, EXPIRES);
  });
});

describe('write + honesty contract', () => {
  test('a valid record is appended and the response never claims the finding is gone', () => {
    const r = call(POST, { body: VALID });
    assert.equal(r.status, 200);
    assert.equal(r.payload.effective, 'next-rollup');
    assert.equal(r.payload.stillOpen, true);
    const doc = JSON.parse(readFileSync(STORE, 'utf8'));
    assert.equal(doc.scannerAnnotations.length, 1);
    assert.equal(doc.scannerAnnotations[0].rule, 'jwt');
    // and GET returns it
    const g = call(GET, { query: 'category=secrets' });
    assert.equal(g.status, 200);
    assert.equal(g.payload.records.length, 1);
  });

  test('zero-match against the area rollup is a 409 refusal; force:true overrides', () => {
    // a real area whose rollup carries one secrets row that does NOT match the record
    const areaOut = join(TMP, 'reports', 'clientD');
    mkdirSync(areaOut, { recursive: true });
    writeFileSync(join(areaOut, 'rollup.json'), JSON.stringify({
      scannerFindings: { secrets: [{ repo: 'clientD', rule: 'aws-key', file: 'other.js', line: 1 }] },
    }));
    process.env.CW_MONITOR_OUT = areaOut; // outDirFor honours the env seam for any slug
    try {
      const refused = call(POST, { body: { ...VALID, project: 'clientD' } });
      assert.equal(refused.status, 409);
      assert.equal(refused.payload.matched, 0);
      assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0, 'a refusal writes nothing');
      const forced = call(POST, { body: { ...VALID, project: 'clientD', force: true } });
      assert.equal(forced.status, 200);
      assert.equal(forced.payload.matched, 0, 'the response still states the match count');
      // and a record that DOES match sails through
      const hit = call(POST, { body: { ...VALID, project: 'clientD', rule: 'aws-key', file: 'other.js' } });
      assert.equal(hit.status, 200);
      assert.equal(hit.payload.matched, 1);
    } finally { delete process.env.CW_MONITOR_OUT; }
  });

  test('an unparseable store is a 503 and the broken bytes survive — fail closed, never clobbered', () => {
    writeFileSync(STORE, '{ not json');
    const r = call(POST, { body: VALID });
    assert.equal(r.status, 503);
    assert.match(r.payload.error, /unreadable/);
    assert.equal(readFileSync(STORE, 'utf8'), '{ not json', 'the write path must not overwrite what it could not read');
    assert.equal(call(GET).status, 503, 'the read path reports the same fact');
  });
});

// ---- duplicate suppressions: one per identity, every judgment still recorded -------------------
// The panel authors from a ROW; the matcher keys on an IDENTITY (rule+file+repo, never line). So a
// finding firing on four lines of one file collected four identical suppressions, of which only
// the first was ever read — while the last to expire decided when the suppression actually lifted.
describe('duplicate suppression — deduped on identity, corroboration kept', () => {
  test('a second identical judgment does not mint a second suppression; it lands as a note', () => {
    const first = call(POST, { body: { ...VALID, line: 12 } });
    assert.equal(first.status, 200);
    assert.ok(!first.payload.duplicate, 'the first record is not a duplicate of anything');

    // same identity (rule+file+repo), different ROW — this is the case that produced 11 records
    const second = call(POST, { body: { ...VALID, line: 88, reason: 'also checked line 88' } });
    assert.equal(second.status, 200);
    assert.equal(second.payload.duplicate, true);
    assert.equal(second.payload.recorded, 'note');
    assert.equal(second.payload.incumbent.at, first.payload.record.at, 'the response must name the record that already governs');

    const recs = JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations;
    assert.equal(recs.length, 2, 'the judgment is kept — deduping must not discard it');
    assert.equal(recs.filter((a) => a.action === 'false-positive').length, 1, 'exactly one SUPPRESSING record per identity');
    assert.equal(recs[1].action, 'note');
    assert.equal(recs[1].corroborates, first.payload.record.at, 'the note must point at what it corroborates');
    assert.equal(recs[1].reason, 'also checked line 88', "the operator's own words survive");
    assert.equal(recs[1].seenAtLine, 88, 'the row that was looked at is recorded');
    assert.equal(recs[1].expires, undefined, 'a note has nothing to expire — requiring one would make this path unusable');
  });

  test('the review date is the one the operator agreed to, not the last duplicate to lapse', () => {
    call(POST, { body: { ...VALID, expires: REVIEW } });
    call(POST, { body: { ...VALID, expires: '2099-01-01T00:00:00.000Z' } }); // would have extended it
    const sup = JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.filter((a) => a.action === 'false-positive');
    assert.equal(sup.length, 1);
    assert.equal(sup[0].expires, REVIEW, 'a later duplicate must not push the review date out');
  });

  test('seenAtLine is evidence, never identity — the matcher cannot see it', async () => {
    const { scannerAnnMatch } = await import('../../monitor/annotate-lib.mjs');
    const { identityFor } = await import('../../monitor/detail-schema.mjs');
    const idf = identityFor('secrets');
    assert.ok(!idf.includes('line') && !idf.includes('seenAtLine'), 'identity must exclude any line field');
    const a = { category: 'secrets', repo: 'clientD', rule: 'jwt', file: 'a.html', seenAtLine: 12, action: 'false-positive' };
    // the SAME finding, moved down the file: it must still match
    assert.equal(scannerAnnMatch(a, { repo: 'clientD', rule: 'jwt', file: 'a.html', line: 900 }, idf), true,
      'a record carrying seenAtLine must still match the finding at a different line');
  });

  test('force:true still authors a second suppression, deliberately', () => {
    call(POST, { body: VALID });
    const forced = call(POST, { body: { ...VALID, force: true } });
    assert.equal(forced.status, 200);
    assert.ok(!forced.payload.duplicate);
    const recs = JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations;
    assert.equal(recs.filter((a) => a.action === 'false-positive').length, 2, 'the override must remain available');
  });

  test('a DIFFERENT action on a suppressed identity is written, and the response says who still governs', () => {
    const first = call(POST, { body: VALID });                                   // false-positive
    const changed = call(POST, { body: { ...VALID, action: 'wont-fix', reason: 'changed my mind' } });
    assert.equal(changed.status, 200);
    assert.ok(!changed.payload.duplicate, 'a changed judgment is not a duplicate');
    assert.equal(changed.payload.governedBy.at, first.payload.record.at);
    assert.match(changed.payload.message, /still governs/,
      'first-match-wins means the earlier record keeps deciding — the operator must be told, not protected from it');
    assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 2);
  });

  test('an EXPIRED suppression does not block a fresh one — dedupe is scoped to what is in force', () => {
    const store = JSON.parse(readFileSync(STORE, 'utf8'));
    store.scannerAnnotations.push({
      category: 'secrets', repo: 'clientD', rule: 'jwt', file: 'a.html', action: 'false-positive',
      reason: 'lapsed', who: 'old@example.com', at: '2020-01-01T00:00:00.000Z', expires: '2020-02-01T00:00:00.000Z',
    });
    writeFileSync(STORE, JSON.stringify(store));
    const r = call(POST, { body: VALID });
    assert.equal(r.status, 200);
    assert.ok(!r.payload.duplicate, 'a lapsed record must not suppress the re-authoring it exists to force');
    assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.filter((a) => a.action === 'false-positive').length, 2);
  });
});

// ---- C2 lock: same path as bin/annotate.mjs, contention is a 409 naming the holder --------------
// Both write paths must converge on the exact same lock file — proven by pre-holding it.
describe('C2 lock — shared path, contention refuses without losing data', () => {
  test('a lock pre-held on annotationsLockPath(STORE) makes the write a 409 naming the holder, store untouched', () => {
    const lockPath = annotationsLockPath(STORE);
    const held = acquireLock(lockPath, { label: 'other-session' });
    assert.ok(held.ok, 'test setup: must be able to take the lock the route is expected to honour');
    try {
      const r = call(POST, { body: VALID });
      assert.equal(r.status, 409);
      assert.equal(r.payload.locked, true);
      assert.match(r.payload.error, /other-session/, 'the refusal names the holder, not just "locked"');
      assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0, 'a contended write must never touch the store');
    } finally {
      held.release();
    }
    // released: the identical write now goes through
    const r2 = call(POST, { body: VALID });
    assert.equal(r2.status, 200);
  });
});

// ---- coverage at write (bifocal H1/H2): what a record covered when written travels with it, an
// unreadable rollup refuses rather than proceeding, and the UI can measure before it saves. --------
describe('coverage at write', () => {
  const COVERAGE = routes.find((r) => r.method === 'GET' && r.path === '/api/annotations/scanner/coverage');
  const area = () => { const d = join(TMP, 'reports', 'clientD'); mkdirSync(d, { recursive: true }); return d; };
  const ROWS = { scannerFindings: { secrets: [
    { repo: 'clientD', rule: 'aws-key', file: 'other.js', line: 1 },
    { repo: 'clientD', rule: 'aws-key', file: 'third.js', line: 9 },
    { repo: 'clientD', rule: 'jwt', file: 'a.html', line: 3 },
  ] } };

  test('the record carries coveredAtWrite; a forced zero carries forced:true', () => {
    const d = area();
    writeFileSync(join(d, 'rollup.json'), JSON.stringify(ROWS));
    process.env.CW_MONITOR_OUT = d;
    try {
      const hit = call(POST, { body: { ...VALID, project: 'clientD' } });
      assert.equal(hit.status, 200);
      assert.equal(hit.payload.record.coveredAtWrite, 1);
      assert.equal(hit.payload.record.forced, undefined);
      // A rule-wide scope is only expressible as a claim about the INSTRUMENT (the matcher is strict
      // on every identity field otherwise), and the record then says how many rows it covered.
      const byRule = call(POST, { body: { ...VALID, project: 'clientD', rule: 'aws-key', file: undefined, action: 'incorrect-scan-result', defect: { tool: 'trufflehog', detail: 'aws-key fires on documentation examples' }, reason: 'rule-wide' } });
      assert.equal(byRule.status, 200, JSON.stringify(byRule.payload));
      assert.equal(byRule.payload.record.coveredAtWrite, 2, 'an instrument-scoped record records how many rows it covered');
      const strictNoFile = call(POST, { body: { ...VALID, project: 'clientD', rule: 'aws-key', file: undefined, reason: 'rule-wide' } });
      assert.equal(strictNoFile.status, 400, 'a false-positive without its place is refused, not widened');
      const forced = call(POST, { body: { ...VALID, project: 'clientD', rule: 'nothing-here', force: true } });
      assert.equal(forced.status, 200);
      assert.equal(forced.payload.record.coveredAtWrite, 0);
      assert.equal(forced.payload.record.forced, true);
      const stored = JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations;
      assert.deepEqual(stored.map((a) => a.coveredAtWrite), [1, 2, 0]);
      assert.equal(stored.filter((a) => a.forced).length, 1);
      // no project: nothing to measure against, and the record says so with null, not 0
      const noProj = call(POST, { body: { ...VALID, rule: 'elsewhere' } });
      assert.equal(noProj.status, 200);
      assert.equal(noProj.payload.record.coveredAtWrite, null);
    } finally { delete process.env.CW_MONITOR_OUT; }
  });

  test('an unreadable rollup is a 503 that names it and writes nothing — not a proceed', () => {
    const d = area();
    writeFileSync(join(d, 'rollup.json'), '{ not json');
    process.env.CW_MONITOR_OUT = d;
    try {
      const r = call(POST, { body: { ...VALID, project: 'clientD' } });
      assert.equal(r.status, 503);
      assert.match(r.payload.error, /rollup\.json is not JSON/);
      assert.equal(r.payload.unavailable, true);
      assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0);
      const forcedToo = call(POST, { body: { ...VALID, project: 'clientD', force: true } });
      assert.equal(forcedToo.status, 503, 'force overrides a zero, never an unreadable rollup');
    } finally { delete process.env.CW_MONITOR_OUT; }
  });

  test('GET coverage measures without writing: matched, rows, a sample, and the rollup state', () => {
    const d = area();
    writeFileSync(join(d, 'rollup.json'), JSON.stringify(ROWS));
    process.env.CW_MONITOR_OUT = d;
    try {
      assert.equal(call(COVERAGE, { session: null, query: 'project=clientD&category=secrets&repo=clientD&rule=aws-key' }).status, 401);
      assert.equal(call(COVERAGE, { query: 'project=clientD&category=nope&repo=clientD&rule=x' }).status, 400);
      assert.equal(call(COVERAGE, { query: 'project=clientD&category=secrets&rule=aws-key' }).status, 400, 'repo or scope=fleet');
      assert.equal(call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD' }).status, 400, 'an identity field is required');
      assert.equal(call(COVERAGE, { query: 'category=secrets&repo=clientD&rule=aws-key' }).status, 400, 'project is required');
      // strict (the default action): a rule without its file addresses nothing
      const strict = call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=aws-key' });
      assert.equal(strict.status, 200);
      assert.equal(strict.payload.matched, 0);
      const one = call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=jwt&file=a.html' });
      assert.equal(one.payload.matched, 1);
      assert.equal(call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=jwt&action=note' }).status, 400, 'only suppressing actions are measured');
      // instrument-scoped: the omitted place is a wildcard, and the number says so before the write
      const r = call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=aws-key&action=incorrect-scan-result' });
      assert.equal(r.status, 200);
      assert.equal(r.payload.matched, 2);
      assert.equal(r.payload.rows, 3);
      assert.equal(r.payload.rollupState, 'measured');
      assert.deepEqual(r.payload.sample.map((s) => s.file), ['other.js', 'third.js']);
      assert.deepEqual(r.payload.named, ['rule']);
      const miss = call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=absent' });
      assert.equal(miss.payload.matched, 0);
      assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).scannerAnnotations.length, 0, 'measuring writes nothing');
      writeFileSync(join(d, 'rollup.json'), '{ not json');
      assert.equal(call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=aws-key' }).status, 503);
    } finally { delete process.env.CW_MONITOR_OUT; }
  });

  test('no rollup yet is "absent" with matched null, never zero', () => {
    const d = area();
    process.env.CW_MONITOR_OUT = d;
    try {
      const r = call(COVERAGE, { query: 'project=clientD&category=secrets&repo=clientD&rule=aws-key' });
      assert.equal(r.status, 200);
      assert.equal(r.payload.matched, null);
      assert.equal(r.payload.rollupState, 'absent');
      const w = call(POST, { body: { ...VALID, project: 'clientD' } });
      assert.equal(w.status, 200, 'with no rollup there is no proof either way, and the write proceeds as before');
      assert.equal(w.payload.record.coveredAtWrite, null);
    } finally { delete process.env.CW_MONITOR_OUT; }
  });
});
