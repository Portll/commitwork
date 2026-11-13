// node --test admin/test/cra-products-concurrency.test.mjs
//
// POST /api/cra/products is a compare-and-swap on the hash the wizard loaded. Unlocked, the failure
// is a false success: concurrent writers are all told 200, one document is on disk, and each loser
// is handed the winner's hash as its next base.
//
// Separate processes, because the handler is synchronous and one process cannot interleave with
// itself; two panels on one store can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { acquireLock } from '../../monitor/lockfile.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE = pathToFileURL(join(CW, 'admin', 'routes', 'cra.mjs')).href;

// Big enough that read -> parse -> hash -> schema-validate -> write is a real window rather than a
// theoretical one: validateProducts walks every entry and the JSON schema walks it again.
const PRODUCTS = 3000;
const WRITERS = 8;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function fixtureDoc() {
  return {
    note: 'baseline',
    manufacturer: { name: 'Fixture GmbH', contact: 'psirt@fixture.example' },
    products: Array.from({ length: PRODUCTS }, (_, i) => ({
      id: `prod-${i}`, name: `Product ${i}`, version: '1.0.0',
      description: 'x'.repeat(200), repos: [`repo-${i}`], market: { eu: false },
    })),
  };
}

/** A real second process invoking the real route handler on the operator port. */
function childSource() {
  return `
import { readFileSync } from 'node:fs';
import { routes } from ${JSON.stringify(ROUTE)};
const [, , marker, startAt, baseHash] = process.argv;
const r = routes.find((x) => x.method === 'POST' && x.path === '/api/cra/products');
const doc = JSON.parse(readFileSync(process.env.PROBE_BODY, 'utf8'));
doc.note = marker;                       // which writer's document this is, kept out of any identity
while (Date.now() < Number(startAt)) { /* barrier: every writer arrives inside one window */ }
let out = null;
const t0 = Date.now();
r.handle({
  req: {}, adminSession: () => null, isLoopbackReq: true,
  send: (code, body) => { out = { code, body }; },
  readJsonBody: (_req, cb) => cb({ products: doc, baseHash: baseHash === 'null' ? null : baseHash }, null),
});
const t1 = Date.now();
process.stdout.write(JSON.stringify({
  marker, t0, t1, code: out && out.code,
  hash: (out && out.body && out.body.hash) || null,
  error: (out && out.body && (out.body.error || out.body.errors)) || null,
}) + '\\n');
`;
}

const envFor = (dir, store, body) => ({
  ...process.env,
  CW_CRA_ROOT: join(dir, 'scratchroot'),   // keep every default path away from the checkout
  CW_PRODUCTS: store,
  PROBE_BODY: body,
});

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
  catch { return { code: null, error: `no parsable result (exit ${r.code}): ${r.err.trim().slice(0, 300)}` }; }
}

/** How many of these [t0,t1] intervals overlap at least one other. The contention witness. */
function overlapCount(rows) {
  return rows.filter((a, i) => rows.some((b, j) => j !== i && a.t0 < b.t1 && b.t0 < a.t1)).length;
}

function stage() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cra-products-race-'));
  mkdirSync(join(dir, 'scratchroot'), { recursive: true });
  const store = join(dir, 'cra-products.json');
  const body = join(dir, 'body.json');
  const child = join(dir, 'writer.mjs');
  const doc = fixtureDoc();
  writeFileSync(store, `${JSON.stringify(doc, null, 2)}\n`);
  writeFileSync(body, JSON.stringify(doc));
  writeFileSync(child, childSource());
  return { dir, store, body, child, baseHash: sha256(readFileSync(store, 'utf8')) };
}

test('concurrent products writes sharing one baseHash: at most ONE may be told it landed', async () => {
  const { dir, store, body, child, baseHash } = stage();
  try {
    const env = envFor(dir, store, body);

    // The uncontended cost of one POST, measured rather than assumed: it is the width of the window
    // the writers below have to arrive inside for this to be a contention test at all.
    const solo = parse(await run([child, 'solo', '0', baseHash], env));
    assert.equal(solo.code, 200, `the uncontended write must succeed, or nothing below means anything: ${JSON.stringify(solo)}`);
    const soloMs = solo.t1 - solo.t0;
    // …and put the store back, so every writer below shares one base.
    writeFileSync(store, `${JSON.stringify(fixtureDoc(), null, 2)}\n`);
    assert.equal(sha256(readFileSync(store, 'utf8')), baseHash);

    const startAt = Date.now() + 1500;    // enough for 8 node processes to boot and reach the spin
    const results = (await Promise.all(Array.from({ length: WRITERS }, (_, i) =>
      run([child, `writer-${i}`, String(startAt), baseHash], env)))).map(parse);

    const landed = results.filter((r) => r.code === 200);
    const conflicted = results.filter((r) => r.code === 409);
    const unavailable = results.filter((r) => r.code === 503);
    const onDisk = JSON.parse(readFileSync(store, 'utf8'));

    console.log(`  [cra-products] ${WRITERS} writers · 200:${landed.length} 409:${conflicted.length} 503:${unavailable.length}`
      + ` · solo POST ${soloMs}ms · arrival spread ${Math.max(...results.map((r) => r.t0 || 0)) - Math.min(...results.map((r) => r.t0 || Infinity))}ms`
      + ` · on disk: ${onDisk.note}`);

    // 0. Pin the denominator twice over. An empty success set satisfies "at most one" vacuously, and
    //    a child that failed to parse a result would be counted as neither 200 nor 409.
    assert.equal(results.filter((r) => r.code === null).length, 0,
      `a writer produced no usable result: ${results.filter((r) => r.code === null).map((r) => r.error).join(' | ')}`);
    assert.equal(landed.length + conflicted.length + unavailable.length, WRITERS,
      `every writer must land, conflict or report the store unavailable; got ${JSON.stringify(results.map((r) => r.code))}`);
    assert.ok(landed.length >= 1, 'at least one writer must be allowed through, or the CAS has become a deadlock');

    // 1. One baseHash, one success.
    assert.equal(landed.length, 1,
      `${landed.length} writers were told 200 against the same baseHash (${landed.map((r) => r.marker).join(', ')}), `
      + `and ${landed.filter((r) => r.marker !== onDisk.note).length} of those documents are not on disk — `
      + 'the compare and the swap have to be one critical section, or 409 is advice rather than a guarantee');

    // 2. Apart from (1): a hash read back outside the lock passes (1) and still describes a peer's
    //    bytes, which the next save then overwrites.
    assert.equal(onDisk.note, landed[0].marker, 'the document on disk must be the one the winner posted');
    assert.equal(landed[0].hash, sha256(readFileSync(store, 'utf8')),
      'the hash handed back must be of the bytes on disk — it is the baseHash the wizard saves against next');

    // 3. (1) and (2) also pass when the writers never overlapped. The timed call includes the lock
    //    wait, so contention shows as overlapping intervals.
    const overlaps = overlapCount(results);
    assert.ok(overlaps >= 2,
      `only ${overlaps} of ${WRITERS} writers overlapped another in time (solo POST ${soloMs}ms), so the writers `
      + 'ran one after another and the assertions above proved nothing about contention. Raise PRODUCTS or '
      + 'the barrier delay until they collide.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A run that never contended must read as zero, or (3) certifies an uncontended run.
test('the contention witness reports nothing on writers that never overlapped', () => {
  assert.equal(overlapCount([{ t0: 0, t1: 10 }, { t0: 10, t1: 20 }, { t0: 20, t1: 30 }]), 0);
  assert.equal(overlapCount([{ t0: 0, t1: 10 }, { t0: 5, t1: 20 }, { t0: 30, t1: 40 }]), 2);
});

test('a writer refused for contention changed nothing and said which store it could not take', async () => {
  const { dir, store, body, child, baseHash } = stage();
  // Held for the child's whole life: the retry budget's wall-clock cost varies by machine, so a hold
  // timed against it is a coin flip. Taken through the route's own primitive, not a lookalike.
  const got = acquireLock(`${store}.lock`, { label: 'test-holder', attempts: 1 });
  assert.ok(got.ok, 'the test must be able to take the products lock first');
  try {
    const env = envFor(dir, store, body);
    const blocked = parse(await run([child, 'blocked', '0', baseHash], env));

    assert.equal(blocked.code, 503,
      `a write that could not take the lock must report the store unavailable, never 200 and never a `
      + `409 that blames the operator for a conflict that did not happen: ${JSON.stringify(blocked)}`);
    assert.match(String(blocked.error), /lock|writer/i, 'the refusal must say what it could not take');
    assert.equal(JSON.parse(readFileSync(store, 'utf8')).note, 'baseline',
      'a refused writer must leave the store exactly as it found it');
  } finally {
    got.release();
    rmSync(dir, { recursive: true, force: true });
  }
});
