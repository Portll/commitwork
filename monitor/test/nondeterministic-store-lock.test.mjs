// node --test monitor/test/nondeterministic-store-lock.test.mjs
//
// The nondeterministic store's read-modify-write under real concurrency (monitor/nondeterministic-store.mjs).
//
// The atomic write was never the question. It stops a TORN file and does nothing about a LOST one:
// two processes that both read the same rows and both write produce a well-formed file missing one
// observation, and no reader afterwards can tell the measurement was ever taken. So the property
// asserted here is CONSERVATION — every observation recorded is in the file — and it is exercised
// with real processes, because a single-threaded loop cannot exhibit the interleaving.
//
// TWO THINGS THIS TEST HAS TO DO THAT ARE EASY TO GET WRONG, both of which make a green run mean
// nothing:
//
//  1. The writers must actually overlap. `spawnSync` in a loop does not overlap — it blocks until
//     each child exits, so twelve "concurrent" writers run one after another and the contention
//     under test never occurs. The writers below are started with async `spawn` AND hold at a
//     shared wall-clock barrier, so the collision is arranged rather than hoped for.
//  2. The counting must be able to fail. A conservation check that cannot catch a loss is
//     decoration, so the control test points the same counting at the unlocked read-modify-write
//     this change replaced, with the interleaving forced: it must lose a row. If the first test
//     fails the lock broke; if the control fails the test stopped being able to see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { holdsRecordLock, read, record, withRecordLock } from '../nondeterministic-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = resolve(HERE, '..', 'nondeterministic-store.mjs');
const STORE_MODULE = pathToFileURL(STORE_PATH).href;
const WRITERS = 8;
const PER_WRITER = 6;
const SUBJECT = 'one-subject';
const DIMENSION = 'conservation';

const scratch = () => mkdtempSync(join(tmpdir(), 'nondet-lock-'));
// A hot depth far above the row count: trimming is a separate property and would mask a loss here.
const storeEnv = (store) => ({ ...process.env, CW_NONDET_STORE: store, CW_NONDET_HOT: '1000' });
const recordPath = (store) => join(store, DIMENSION, `${SUBJECT}.jsonl`);
const rowsIn = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test(`CONSERVATION — ${WRITERS} processes x ${PER_WRITER} observations, each present exactly once`, async () => {
  const dir = scratch();
  try {
    const store = join(dir, 'store');
    const prog = join(dir, 'w.mjs');
    // pathToFileURL is named AT the interpolation, not behind a const: bin/test/esm-specifier-shape.mjs
    // matches this shape by spelling on purpose, because a variable holding `C:\\...` looks identical
    // to one holding a URL and the child rejects the first with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    writeFileSync(prog, `
import { record } from ${JSON.stringify(pathToFileURL(STORE_PATH).href)};
const [writer, n, startAt] = process.argv.slice(2);
while (Date.now() < Number(startAt)) { /* hold at the barrier so every writer arrives together */ }
for (let i = 0; i < Number(n); i++) {
  record({ subject: '${SUBJECT}', dimension: '${DIMENSION}', score: 0.5, detail: { writer: Number(writer), i } });
}
`);
    const startAt = Date.now() + 700;   // enough for every child to boot and reach the barrier
    const kids = Array.from({ length: WRITERS }, (_, w) => new Promise((done, fail) => {
      const kid = spawn(process.execPath, [prog, String(w), String(PER_WRITER), String(startAt)], { env: storeEnv(store), stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      kid.stderr.on('data', (d) => { err += d; });
      kid.on('error', fail);
      kid.on('exit', (code) => (code === 0 ? done() : fail(new Error(`writer ${w} exited ${code}: ${err}`))));
    }));
    await Promise.all(kids);

    const rows = rowsIn(recordPath(store));
    assert.equal(rows.length, WRITERS * PER_WRITER,
      `expected ${WRITERS * PER_WRITER} observations, found ${rows.length} — a short count is a lost update, and the file is well-formed either way`);
    const seen = new Set(rows.map((r) => `${r.detail.writer}:${r.detail.i}`));
    assert.equal(seen.size, WRITERS * PER_WRITER, 'every (writer, i) pair must appear exactly once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the control — the same counting DOES catch the unlocked read-modify-write it replaced', () => {
  const dir = scratch();
  try {
    const p = join(dir, 'unlocked.jsonl');
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, '');
    // Forced rather than raced, so the control cannot flake: both writers read before either
    // writes, which is precisely what two processes do through an unlocked read-modify-write.
    const unlockedRecord = (rows, row) => writeFileSync(p, [...rows, row].map((r) => JSON.stringify(r)).join('\n') + '\n');
    const aSaw = rowsIn(p);
    const bSaw = rowsIn(p);
    unlockedRecord(aSaw, { writer: 'a' });
    unlockedRecord(bSaw, { writer: 'b' });
    assert.equal(rowsIn(p).length, 1, 'the unlocked path loses one of two observations — this is the loss the test above is counting for');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the lock EXCLUDES — a second process is refused while this one holds it', () => {
  const dir = scratch();
  try {
    const store = join(dir, 'store');
    process.env.CW_NONDET_STORE = store;
    process.env.CW_NONDET_HOT = '1000';
    record({ subject: SUBJECT, dimension: DIMENSION, score: 0.1 });   // creates the file and its directory
    const p = recordPath(store);
    const answer = withRecordLock(p, () => {
      const src = `
        const { withRecordLock } = await import(${JSON.stringify(STORE_MODULE)});
        try { withRecordLock(${JSON.stringify(p)}, () => {}, { attempts: 1 }); process.stdout.write('ACQUIRED'); }
        catch { process.stdout.write('REFUSED'); }
      `;
      return execFileSync(process.execPath, ['--input-type=module', '-e', src], { env: storeEnv(store), encoding: 'utf8' });
    });
    assert.equal(answer, 'REFUSED', 'a lock a second process can take while it is held is not a lock');
    assert.equal(read(SUBJECT, DIMENSION).length, 1, 'and the refusal wrote nothing');
  } finally {
    delete process.env.CW_NONDET_STORE;
    delete process.env.CW_NONDET_HOT;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('holdsRecordLock answers about the hold actually held, and the hold ends with the callback', () => {
  const dir = scratch();
  try {
    const p = join(dir, 'store', DIMENSION, `${SUBJECT}.jsonl`);
    mkdirSync(dirname(p), { recursive: true });
    assert.equal(holdsRecordLock(p), false);
    withRecordLock(p, () => assert.equal(holdsRecordLock(p), true, 'inside the critical section the hold must be visible'));
    assert.equal(holdsRecordLock(p), false, 'a hold outliving its callback would let the next writer skip the lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
