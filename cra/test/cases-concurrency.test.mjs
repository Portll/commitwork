// node --test cra/test/cases-concurrency.test.mjs
//
// cra/cases.json is a whole-document read-modify-write over a hash chain, and it had four unlocked
// writers. Measured with real processes before the fix, 8 concurrent `watch.mjs ack` on 8 distinct
// cases against a 3000-event fixture: 8 of 8 reported success, 1 landed, 7 events lost — and the
// chain still verified, because the dropped events were never in the file the winner hashed.
//
// The assertion is "nothing is silently lost", not "every writer wins": updateCases fails closed, so
// a refusal is a correct outcome and only a success line for an absent write is a defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { chainHash, emptyCasesDoc, updateCases, saveCases, appendCaseEvent, stableStringify } from '../lib.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCH = join(CW, 'cra', 'watch.mjs');
const NOW = '2026-08-21T00:00:00.000Z';

// Big enough that the load->mutate->write window is a real one rather than a theoretical one. At 8
// writers this fixture reproduced 7 lost events every run before the fix.
const CASES = 8;
const EVENTS = 3000;

/** Never rejects on a non-zero exit: a refusal is data here, not an error. */
function run(argv, env) {
  return new Promise((ok) => {
    const kid = spawn(process.execPath, argv, { cwd: CW, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    kid.stdout.on('data', (d) => { out += d; });
    kid.stderr.on('data', (d) => { err += d; });
    kid.on('close', (code) => ok({ code, out, err }));
  });
}

/** A case log of `nCases` open cases and `nEvents` events, built through the real chain. */
function fixture(dir, nCases = CASES, nEvents = EVENTS) {
  const doc = emptyCasesDoc();
  for (let i = 0; i < nCases; i++) {
    const caseId = `prod--cve-2026-${1000 + i}`;
    doc.cases[caseId] = {
      caseId, productId: 'prod', vulnId: `CVE-2026-${1000 + i}`, kind: 'vulnerability',
      title: `fixture case ${i}`, advisory: null, severity: 'high', cvss: 8.1, epss: 0.7, kev: true,
      trigger: 'kev', packages: ['pkg'], repos: ['repo'], slices: ['sweep-20260101000000'],
      firstDetectedAt: '2026-08-01T00:00:00.000Z', awarenessAt: null, measures: [], status: 'open',
      clocks: {
        basis: 'detection', earlyWarningDue: '2026-08-02T00:00:00.000Z',
        notificationDue: '2026-08-03T00:00:00.000Z', finalDue: '2026-08-15T00:00:00.000Z', finalBasis: 'awareness + 14d',
      },
    };
  }
  const ids = Object.keys(doc.cases);
  for (let i = 0; i < nEvents; i++) {
    // Padded to megabytes: the read-to-write window scales with document size.
    appendCaseEvent(doc, 'case-updated', ids[i % ids.length], { filler: 'x'.repeat(400), n: i }, '2026-08-01T00:00:00.000Z');
  }
  const path = join(dir, 'cases.json');
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return { path, doc, ids };
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** cmdVerify's chain check, as a value rather than an exit code. */
function verifyChain(doc) {
  let prev = null;
  for (const [i, ev] of doc.events.entries()) {
    if (ev.prevHash !== prev) return `prevHash mismatch at event ${i} (${ev.type})`;
    if (chainHash(ev.prevHash, ev) !== ev.hash) return `hash mismatch at event ${i} (${ev.type})`;
    prev = ev.hash;
  }
  return null;
}

const envFor = (dir, store) => ({
  ...process.env,
  CW_CRA_ROOT: join(dir, 'scratchroot'),   // keep every default path away from the checkout
  CW_CASES: store,
  CW_CRA_NOW: NOW,
  CW_ESCALATE: '0',
});

test('concurrent acknowledgements all land, and the chain still verifies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-race-'));
  try {
    const { path: store, ids } = fixture(dir);
    const before = read(store).events.length;

    // Distinct cases, so every write is legitimate and none can be excused as a real conflict.
    const results = await Promise.all(ids.map((id) => run([WATCH, 'ack', id], envFor(dir, store))));

    const doc = read(store);
    const claimed = results.filter((r) => r.code === 0);
    const refused = results.filter((r) => r.code !== 0);

    // 0. Pin the denominator: assertion 1 passes vacuously over an empty set of successes.
    assert.ok(claimed.length >= 1,
      `at least one writer must complete, or this proves nothing: ${refused.map((r) => r.err.trim().split('\n')[0]).join(' | ')}`);

    // 1. Nothing silently lost. Before the lock: 8 claimed, 1 landed.
    const acked = new Set(Object.values(doc.cases).filter((k) => k.awarenessAt).map((k) => k.caseId));
    const lost = ids.filter((id, i) => results[i].code === 0 && !acked.has(id));
    assert.deepEqual(lost, [],
      `${lost.length} of ${claimed.length} writers reported success and are not in the case log `
      + `(${lost.join(', ')}) — that is the lost update this test exists to catch, and note that the `
      + 'hash chain verifies perfectly over it');

    // 2. Derived state and evidence trail agree — a re-based clock with no event explaining it.
    const ackEvents = doc.events.filter((e) => e.type === 'acknowledged');
    assert.equal(ackEvents.length, claimed.length,
      `${claimed.length} writers succeeded but ${ackEvents.length} acknowledgement events are on the chain`);

    // 3. Nothing corrupted. Weak on its own: an overwrite leaves a valid chain over a truncated
    //    history. It did fail before the fix.
    assert.equal(verifyChain(doc), null, 'the event chain must verify');

    // 4. History survived: a writer starting a fresh document passes everything above.
    assert.ok(doc.events.length >= before,
      `the case log had ${before} events and now has ${doc.events.length} — history was discarded`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The cost of failing closed is a number: refusing spends deadline slack, so the wait must be small
// against the 1800s watch tick. Asserted loosely — a bound, not a benchmark.
test('the wait for the case-log lock is bounded far below the Article 14 tick cadence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-wait-'));
  try {
    const { path: store, ids } = fixture(dir);
    const probe = join(dir, 'probe.mjs');
    // On disk rather than `-e`: a quoting hazard in argv surfaces as a SyntaxError in the child.
    writeFileSync(probe, `
import { updateCases } from ${JSON.stringify(pathToFileURL(join(CW, 'cra', 'lib.mjs')).href)};
const r = updateCases({ cases: ${JSON.stringify(store)} }, (doc) => {
  doc.cases[process.argv[2]].measures.push({ detail: 'probe', at: ${JSON.stringify(NOW)} });
  return true;
}, { label: 'probe' });
process.stdout.write(JSON.stringify({ ok: r.ok, waitedMs: r.waitedMs }) + '\\n');
process.exit(0);
`);
    const results = await Promise.all(ids.map((id) => run([probe, id], envFor(dir, store))));
    const waits = results.map((r) => JSON.parse(r.out.trim()).waitedMs);
    const max = Math.max(...waits);
    const granted = results.map((r) => JSON.parse(r.out.trim())).filter((r) => r.ok).length;

    // Printed, not just asserted: a bound nobody reads is a bound nobody notices moving.
    console.log(`  [cra-lock] ${ids.length} contending writers · ${granted} granted · waits ${waits.join('/')}ms · max ${max}ms · watch cadence 1800000ms`);

    assert.ok(max < 30_000,
      `the longest acquisition wait was ${max}ms; the retry budget is ~1s and the stale threshold 30s, `
      + 'so anything at or past 30s means a holder is not releasing');
    assert.ok(max < 1800_000 / 100,
      `the longest wait (${max}ms) must stay orders of magnitude under the 1800s watch tick — that `
      + 'margin is what makes refusing a contended write cheaper than risking a lost Article 14 event');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A refusal is not nothing happening: it is recorded on stderr while an operator can act, and in the
// ledger afterwards, so consumed slack is answerable from evidence rather than absence.
test('a refused write is loud, writes nothing, and is banked as a write-deferred event', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-defer-'));
  try {
    const { path: store, ids } = fixture(dir, 4, 50);
    const before = read(store).events.length;

    // A real second process holds past the retry budget, so the refusal is genuinely cross-process.
    const holder = join(dir, 'holder.mjs');
    writeFileSync(holder, `
import { updateCases } from ${JSON.stringify(pathToFileURL(join(CW, 'cra', 'lib.mjs')).href)};
updateCases({ cases: ${JSON.stringify(store)} }, () => {
  const until = Date.now() + 2500;
  while (Date.now() < until) { /* hold it past the ~1s retry budget */ }
  return false;
}, { label: 'holder' });
`);
    const held = run([holder], envFor(dir, store));
    await new Promise((r) => setTimeout(r, 300));           // let the holder take it first
    // A short retry budget, so the holder's 2500ms hold reliably OUTLASTS it. At the default 50
      // attempts the real wait is ~2535ms — 35ms LONGER than the hold — so the blocked writer won
      // the lock instead of being refused, and this test failed ~4 runs in 5 for that reason alone.
      const blocked = await run([WATCH, 'ack', ids[0]], { ...envFor(dir, store), CW_CRA_LOCK_ATTEMPTS: '10' });
    await held;

    // Loud and non-zero: an exit-0 refusal is indistinguishable from success to launchd.
    assert.notEqual(blocked.code, 0, 'a refused write must not exit 0');
    assert.match(blocked.err, /REFUSED to write the Article 14 case log/,
      'the refusal must say what was refused, on stderr, in words an operator can act on');

    // Fail closed: the refused writer left no partial trace.
    const mid = read(store);
    assert.equal(mid.events.length, before, 'a refused writer must not have appended anything');
    assert.ok(!Object.values(mid.cases)[0].awarenessAt, 'a refused ack must not have changed state');
    assert.ok(existsSync(`${store}.deferred.jsonl`), 'the deferral marker records the skipped tick');

    // The next successful writer banks the skip, making consumed slack countable.
    const after = await run([WATCH, 'ack', ids[1]], envFor(dir, store));
    assert.equal(after.code, 0, after.err);
    const doc = read(store);
    const deferred = doc.events.filter((e) => e.type === 'write-deferred');
    assert.equal(deferred.length, 1, 'exactly one write-deferred event summarising the contention');
    assert.ok(deferred[0].data.skipped >= 1, 'it must carry how many ticks were skipped');
    assert.ok(deferred[0].data.from, 'and when the skipping started, so the slack is measurable');
    assert.equal(verifyChain(doc), null, 'the deferral event is on the chain like any other');
    assert.ok(!existsSync(`${store}.deferred.jsonl`), 'the marker is drained once banked, never re-counted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The mutation must be computed from state read inside the lock: reading first and locking second
// writes superseded state, and the chain verifies clean over that too.
test('updateCases loads inside the lock, so a caller cannot mutate a pre-read document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-toctou-'));
  try {
    const { path: store, ids } = fixture(dir, 2, 5);
    const stale = read(store);                        // the pre-read a careless caller keeps

    // Somebody else commits in between.
    updateCases({ cases: store }, (doc) => { appendCaseEvent(doc, 'case-closed', ids[0], { reason: 'other writer' }, NOW); return true; });

    let seen = null;
    updateCases({ cases: store }, (doc) => { seen = doc.events.length; return false; });

    assert.equal(seen, stale.events.length + 1,
      'the mutator must be handed the CURRENT document, not the one the caller read before waiting — '
      + `it saw ${seen} events and the pre-read snapshot had ${stale.events.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The backstop, not the door: updateCases cannot forget the lock, so saveCases exists for a future
// writer reaching past it.
test('saveCases refuses to write the case log without the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-guard-'));
  try {
    const { path: store } = fixture(dir, 2, 5);
    const doc = read(store);

    assert.throws(() => saveCases({ cases: store }, doc), /updateCases/,
      'an unlocked save must be refused, and the message must name the primitive that fixes it');

    // …and the same save under the lock is exactly the ordinary path.
    updateCases({ cases: store }, (d) => { appendCaseEvent(d, 'case-closed', 'prod--cve-2026-1000', { reason: 'locked' }, NOW); return true; });
    assert.equal(read(store).events.length, 6, 'the locked save landed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fail closed on the read too: only ENOENT means "no cases yet". A fresh chain over an unparseable
// ledger replaces the Art. 14 record with a blank document and reports success.
test('an unreadable or non-case-shaped ledger is refused, never overwritten with an empty one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-failclosed-'));
  try {
    const store = join(dir, 'cases.json');

    writeFileSync(store, '{ this is not json');
    assert.throws(() => updateCases({ cases: store }, () => true), /not valid JSON/,
      'a corrupt ledger must refuse, not restart the chain');
    assert.equal(readFileSync(store, 'utf8'), '{ this is not json', 'and the bytes are untouched');

    writeFileSync(store, JSON.stringify({ hello: 'world' }));
    assert.throws(() => updateCases({ cases: store }, () => true), /not a case document/,
      'valid JSON that is not a case log must refuse too — "parses" is not "is the right file"');

    // ENOENT is the one absence that legitimately means "no cases have ever been opened".
    rmSync(store);
    const r = updateCases({ cases: store }, (doc) => { appendCaseEvent(doc, 'case-opened', 'x', {}, NOW); return true; });
    assert.equal(r.ok, true);
    assert.equal(read(store).events.length, 1, 'a genuinely absent ledger is created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The hash must cover what lands on disk. A bare `ack` (no `--at`) passes `at: undefined`, which
// Object.keys lists and JSON.stringify drops — so an uncontended ack made `verify` report a broken
// chain. Every existing test passes `--at`, the one form that defines the key.
test('an event carrying an undefined field hashes the same before and after a round trip', () => {
  const ev = { type: 'acknowledged', caseId: 'c', at: NOW, data: { at: undefined, by: 'operator' } };
  const { prevHash: _p, hash: _h, ...body } = ev;
  assert.equal(stableStringify(body), stableStringify(JSON.parse(JSON.stringify(body))),
    'the in-memory form and the serialised form must hash identically, or the chain accuses itself');
  assert.equal(chainHash(null, ev), chainHash(null, JSON.parse(JSON.stringify(ev))));
});

test('the documented CLI form with no --at leaves a verifiable chain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-noat-'));
  try {
    const { path: store, ids } = fixture(dir, 2, 5);
    const env = envFor(dir, store);
    // Exactly what the drafts tell an operator to run.
    assert.equal((await run([WATCH, 'ack', ids[0]], env)).code, 0);
    assert.equal((await run([WATCH, 'measure', ids[1], '--detail', 'hotfix shipped'], env)).code, 0);
    const v = await run([WATCH, 'verify'], env);
    assert.equal(v.code, 0, `verify must pass after the ordinary CLI path: ${v.stderr || v.err}`);
    assert.equal(verifyChain(read(store)), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
