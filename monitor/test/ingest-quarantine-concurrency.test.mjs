// node --test monitor/test/ingest-quarantine-concurrency.test.mjs
//
// defaultQuarantineSink replaces the whole document, and mcp, http and cli all reach it. Two writers
// on one snapshot both report an append, one entry vanishes, and `dropped` stays zero. Only visible
// across processes: the sink is synchronous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { loadQuarantine, ingestExternal, QUARANTINE_MAX } from '../ingest-external.mjs';
import { acquireLock } from '../lockfile.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOD = pathToFileURL(join(CW, 'monitor', 'ingest-external.mjs')).href;

// ~3.5MB of capped payloads, so load -> push -> write is a real window.
const SEED = 900;
const WRITERS = 8;
const T0 = '2026-10-20T00:00:00.000Z';

function seedDoc() {
  return {
    note: 'fixture quarantine',
    version: 1,
    dropped: 0,
    entries: Array.from({ length: SEED }, (_, i) => ({
      at: T0, channel: 'http', who: null, refused: 'schema',
      errors: ['x'.repeat(200)], payload: 'y'.repeat(3800), payloadTruncated: false, marker: `seed-${i}`,
    })),
  };
}

function childSource() {
  return `
import { defaultQuarantineSink } from ${JSON.stringify(MOD)};
const [, , marker, startAt] = process.argv;
while (Date.now() < Number(startAt)) { /* barrier */ }
const t0 = Date.now();
let ok = true, err = null;
try { defaultQuarantineSink({ at: ${JSON.stringify(T0)}, channel: 'cli', who: null, refused: 'schema', errors: [marker], payload: marker, payloadTruncated: false, marker }); }
catch (e) { ok = false; err = e.message; }
process.stdout.write(JSON.stringify({ marker, t0, t1: Date.now(), ok, err }) + '\\n');
`;
}

function run(argv, env) {
  return new Promise((ok) => {
    const kid = spawn(process.execPath, argv, { cwd: CW, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    kid.stdout.on('data', (d) => { out += d; });
    kid.stderr.on('data', (d) => { err += d; });
    kid.on('close', (code) => ok({ code, out, err }));
  });
}

function parse(r) {
  try { return JSON.parse(r.out.trim().split('\n').pop()); }
  catch { return { ok: null, err: `no parsable result (exit ${r.code}): ${r.err.trim().slice(0, 300)}` }; }
}

/** How many of these [t0,t1] intervals overlap at least one other. */
function overlapCount(rows) {
  return rows.filter((a, i) => rows.some((b, j) => j !== i && a.t0 < b.t1 && b.t0 < a.t1)).length;
}

function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-quarantine-race-'));
  const store = join(dir, 'ingest-quarantine.json');
  const child = join(dir, 'writer.mjs');
  writeFileSync(store, `${JSON.stringify(seedDoc(), null, 2)}\n`);
  writeFileSync(child, childSource());
  return { dir, store, child };
}

// Retention is out of reach, so every missing entry is a lost one rather than a rolled-off one.
const envFor = (store) => ({
  ...process.env,
  CW_INGEST_QUARANTINE: store,
  CW_INGEST_QUARANTINE_MAX: String(SEED + WRITERS + 100),
});

test('concurrent refusals all reach the quarantine, or say they did not', async () => {
  const { dir, store, child } = stage();
  try {
    const env = envFor(store);
    const before = loadQuarantine({ path: store }).entries.length;
    assert.equal(before, SEED, 'the fixture must load through the real reader');

    const solo = parse(await run([child, 'solo', '0'], env));
    assert.equal(solo.ok, true, `the uncontended append must succeed: ${solo.err}`);
    const soloMs = solo.t1 - solo.t0;
    writeFileSync(store, `${JSON.stringify(seedDoc(), null, 2)}\n`);

    const startAt = Date.now() + 1500;
    const results = (await Promise.all(Array.from({ length: WRITERS }, (_, i) =>
      run([child, `writer-${i}`, String(startAt)], env)))).map(parse);

    const doc = loadQuarantine({ path: store });
    const markers = new Set(doc.entries.map((e) => e.marker));
    const claimed = results.filter((r) => r.ok === true);
    const refused = results.filter((r) => r.ok === false);
    const lost = claimed.filter((r) => !markers.has(r.marker));

    console.log(`  [quarantine] ${WRITERS} writers · ${claimed.length} claimed · ${refused.length} refused`
      + ` · ${before} -> ${doc.entries.length} entries · dropped ${doc.dropped} · solo append ${soloMs}ms`);

    // "Nothing lost" is vacuous over zero successes.
    assert.equal(results.filter((r) => r.ok === null).length, 0,
      `a writer produced no usable result: ${results.filter((r) => r.ok === null).map((r) => r.err).join(' | ')}`);
    assert.ok(claimed.length >= 1, `at least one writer must complete: ${refused.map((r) => r.err).join(' | ')}`);

    assert.deepEqual(lost.map((r) => r.marker), [],
      `${lost.length} of ${claimed.length} writers reported an append that is not in the quarantine`);

    // Identity misses a loss replaced by an equal marker; a count misses a swap.
    assert.equal(doc.entries.length + (doc.dropped || 0), before + claimed.length,
      `${before} seeded + ${claimed.length} appended should account for ${doc.entries.length} entries `
      + `and ${doc.dropped || 0} dropped`);

    const seeds = doc.entries.filter((e) => String(e.marker).startsWith('seed-')).length;
    assert.equal(seeds, SEED, `the ${SEED} seeded refusals must survive; ${seeds} did`);

    // Writers that never collided pass everything above, so contention is asserted separately.
    const overlaps = overlapCount(results);
    assert.ok(overlaps >= 2,
      `only ${overlaps} of ${WRITERS} writers overlapped another (solo append ${soloMs}ms); `
      + 'the run did not contend, so it proved nothing about the lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the contention witness reports nothing on writers that never overlapped', () => {
  assert.equal(overlapCount([{ t0: 0, t1: 10 }, { t0: 10, t1: 20 }, { t0: 20, t1: 30 }]), 0);
  assert.equal(overlapCount([{ t0: 0, t1: 10 }, { t0: 5, t1: 20 }, { t0: 30, t1: 40 }]), 2);
});

test('a quarantine the sink cannot lock is a loud refusal, never a quiet accept', async () => {
  const { dir, store, child } = stage();
  // Held for the child's whole life: a hold timed against the sink's retry budget is a coin flip.
  const got = acquireLock(`${store}.lock`, { label: 'test-holder', attempts: 1 });
  assert.ok(got.ok, 'the test must be able to take the quarantine lock first');
  try {
    const blocked = parse(await run([child, 'blocked', '0'], envFor(store)));

    assert.equal(blocked.ok, false,
      `a sink that could not take the lock must throw rather than report an append: ${JSON.stringify(blocked)}`);
    assert.match(String(blocked.err), /lock/i, 'the throw must name what it could not take');
    const doc = loadQuarantine({ path: store });
    assert.equal(doc.entries.length, SEED, 'a refused sink must leave the ledger as it found it');
    assert.ok(!doc.entries.some((e) => e.marker === 'blocked'), 'and must not have written its entry');
  } finally {
    got.release();
    rmSync(dir, { recursive: true, force: true });
  }
});

// The sink may throw only because refuse() reports a failed quarantine write instead of accepting.
test('a sink failure never turns a refused judgement into an accepted one', () => {
  const out = ingestExternal({ events: [], issues: {} }, { nonsense: true }, {
    channel: 'cli',
    session: { user: 'op@example.test' },
    quarantineSink: () => { throw new Error('ingest quarantine is locked by another writer'); },
  });
  assert.equal(out.ok, false, 'a refusal stays a refusal when its quarantine write fails');
  assert.equal(out.quarantined, false, 'and it must not claim to have been quarantined');
  assert.ok(out.errors.some((e) => /quarantine write failed/.test(e)),
    `the failure must be named in the reply: ${JSON.stringify(out.errors)}`);
});

test('the retention bound is read from the env at call time', () => {
  const saved = process.env.CW_INGEST_QUARANTINE_MAX;
  try {
    process.env.CW_INGEST_QUARANTINE_MAX = '7';
    assert.equal(QUARANTINE_MAX(), 7);
  } finally {
    if (saved === undefined) delete process.env.CW_INGEST_QUARANTINE_MAX;
    else process.env.CW_INGEST_QUARANTINE_MAX = saved;
  }
});
