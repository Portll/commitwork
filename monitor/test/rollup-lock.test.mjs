// monitor/test/rollup-lock.test.mjs — the stale-break lock race, proved cross-process: each fix is
// paired with a CONTROL running the pre-C2 algorithm, asserted to fail the way the fix prevents.
// Children are real node processes released together by a filesystem barrier.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const LOCKFILE = new URL('../lockfile.mjs', import.meta.url).href;
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');

const STALE_MS = 10 * 60 * 1000;   // monitor/rollup.mjs's own threshold, so these are shipping numbers
const OWNER = 'owner.json';
const RACERS = 8;

const scratch = (tag) => mkdtempSync(join(tmpdir(), `cw-rlock-${tag}-`));

// a crashed holder's leavings: token AND mtime both backdated — refreshing only one must not pass
function plantStaleLock(lockPath, ageMs = STALE_MS * 2, { tokenless = false } = {}) {
  mkdirSync(lockPath);
  const at = Date.now() - ageMs;
  if (!tokenless) {
    writeFileSync(join(lockPath, OWNER), JSON.stringify({ pid: 999_999, nonce: 'stale-corpse-nonce', at, label: 'crashed' }));
  }
  const s = at / 1000;
  utimesSync(lockPath, s, s);
  return at;
}

const ownerNonceAt = (lockPath) => {
  try { return JSON.parse(readFileSync(join(lockPath, OWNER), 'utf8')).nonce; } catch { return null; }
};

// yield, don't spin — burning a core would distort the race being measured
async function until(pred, { timeoutMs = 30_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pred()) return true;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function spawnChild(script, arg) {
  const k = spawn(process.execPath, [script, String(arg)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  k.stdout.on('data', (d) => { out += d; });
  k.stderr.on('data', (d) => { err += d; });
  k.done = new Promise((res) => k.on('exit', (code) => res({ code, out, err })));
  return k;
}

// children arm with `ready-<i>`, then spin until GO — a race, not sequential runs
const PRELUDE = `
import fs from 'node:fs';
const [DIR, IDX] = [process.env.CW_T_DIR, process.argv[2]];
const LOCK = DIR + '/.rollup.lock', GO = DIR + '/GO', STALE = ${STALE_MS};
const write = (n, v) => fs.writeFileSync(DIR + '/' + n, String(v));
const waitForGo = () => {
  const deadline = Date.now() + 25000;
  while (!fs.existsSync(GO) && Date.now() < deadline) { const u = Date.now() + 2; while (Date.now() < u) { /* spin */ } }
};`;

// Release N barriered children and collect their exits.
async function race(dir, source, count) {
  const script = join(dir, 'child.mjs');
  writeFileSync(script, source);
  process.env.CW_T_DIR = dir;
  const kids = Array.from({ length: count }, (_, i) => spawnChild(script, i));
  try {
    await until(() => readdirSync(dir).filter((f) => f.startsWith('ready-')).length === count,
      { label: `${count} children to arm` });
    writeFileSync(join(dir, 'GO'), '');
    return await Promise.all(kids.map((k) => k.done));
  } finally { delete process.env.CW_T_DIR; }
}

const verdicts = (dir, count) => Array.from({ length: count }, (_, i) => {
  const p = join(dir, `res-${i}`);
  return existsSync(p) ? readFileSync(p, 'utf8') : '<no verdict>';
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — a stale lock must admit exactly ONE taker', () => {
  test(`CONTROL: the pre-C2 rollup algorithm lets ALL ${RACERS} processes take the same stale lock over`, async () => {
    const dir = scratch('ctl-many');
    try {
      plantStaleLock(join(dir, '.rollup.lock'));
      // the pre-C2 algorithm: on EEXIST, proceed if mtime is stale; nothing is touched
      const results = await race(dir, `${PRELUDE}
write('ready-' + IDX, '');
waitForGo();
let proceeded;
try { fs.mkdirSync(LOCK); proceeded = true; }
catch {
  const age = (() => { try { return Date.now() - fs.statSync(LOCK).mtimeMs; } catch { return Infinity; } })();
  proceeded = age >= STALE;   // < STALE => "another rollup is running — aborting" (exit 3)
}
write('res-' + IDX, proceeded ? 'PROCEEDED' : 'aborted');
`, RACERS);
      assert.ok(results.every((r) => r.code === 0), `control children must all run: ${JSON.stringify(results)}`);
      const v = verdicts(dir, RACERS);
      const proceeded = v.filter((s) => s === 'PROCEEDED').length;
      assert.equal(proceeded, RACERS,
        'the pre-C2 defect is that EVERY concurrent rollup reads the same never-refreshed mtime as stale ' +
        `and takes over — if this is no longer ${RACERS}, the control has stopped modelling the bug ` +
        `(verdicts: ${JSON.stringify(v)})`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`the shared lock admits exactly ONE of ${RACERS} processes, and the disk agrees with the winner`, async () => {
    const dir = scratch('fix-many');
    try {
      plantStaleLock(join(dir, '.rollup.lock'));
      const results = await race(dir, `${PRELUDE}
const { acquireLock } = await import(${JSON.stringify(LOCKFILE)});
write('ready-' + IDX, '');
waitForGo();
// releaseOnExit stays false: the child exits still "holding" the lock, which leaves the on-disk
// state identical to a live holder in the middle of its critical section. That is the state the
// next process has to reason about, and the only one it can see.
const got = acquireLock(LOCK, { staleMs: STALE, label: 'racer' + IDX });
write('res-' + IDX, got.ok ? 'HELD ' + got.token.nonce : 'busy');
`, RACERS);
      assert.ok(results.every((r) => r.code === 0), `children must all run: ${JSON.stringify(results)}`);
      const v = verdicts(dir, RACERS);
      const winners = v.filter((s) => s.startsWith('HELD '));
      assert.equal(winners.length, 1,
        `exactly one process may hold a stale lock after the takeover; ${winners.length} did (verdicts: ${JSON.stringify(v)})`);
      assert.equal(ownerNonceAt(join(dir, '.rollup.lock')), winners[0].slice('HELD '.length),
        'the lock left on disk must carry the winner\'s nonce — anything else means a loser overwrote it');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — the stale-break race: one process deleting another\'s freshly acquired lock', () => {
  // choreography: plant stale → LATE observes stale and blocks → WINNER takes over → barrier
  // drops and LATE acts on its stale observation
  async function choreograph(dir, lateSource) {
    const lock = join(dir, '.rollup.lock');
    plantStaleLock(lock);
    const script = join(dir, 'late.mjs');
    writeFileSync(script, lateSource);
    process.env.CW_T_DIR = dir;
    const late = spawnChild(script, 0);
    try {
      await until(() => existsSync(join(dir, 'observed')), { label: 'the late process to observe the stale lock' });
      // the winner is a second process — a genuine three-party situation on disk
      const win = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { acquireLock } = await import(${JSON.stringify(LOCKFILE)});
        const got = acquireLock(${JSON.stringify(lock)}, { staleMs: ${STALE_MS}, label: 'winner' });
        process.stdout.write(got.ok ? got.token.nonce : 'BUSY');
      `], { encoding: 'utf8' });
      assert.equal(win.status, 0, `the winner must run: ${win.stderr}`);
      const winnerNonce = win.stdout.trim();
      assert.notEqual(winnerNonce, 'BUSY', 'the winner must be able to take a stale lock over');
      assert.equal(ownerNonceAt(lock), winnerNonce, 'precondition: the winner holds the lock before the barrier drops');
      writeFileSync(join(dir, 'GO'), '');
      const r = await late.done;
      assert.equal(r.code, 0, `the late process must run: ${r.err}`);
      return { lock, winnerNonce, late: existsSync(join(dir, 'res-0')) ? readFileSync(join(dir, 'res-0'), 'utf8') : '<none>' };
    } finally { delete process.env.CW_T_DIR; }
  }

  test('CONTROL: the pre-C2 stale branch deletes the winner\'s freshly acquired lock', async () => {
    const dir = scratch('ctl-race');
    try {
      // the pre-C2 stale branch: stat, then unconditional rmdir — nothing notices the lock changing hands
      const r = await choreograph(dir, `${PRELUDE}
const observedAge = (() => { try { return Date.now() - fs.statSync(LOCK).mtimeMs; } catch { return Infinity; } })();
write('observed', observedAge);
waitForGo();
let outcome = 'left-alone';
if (observedAge > STALE) {
  try { fs.rmSync(LOCK, { recursive: true }); outcome = 'DELETED-THE-WINNERS-LOCK'; }
  catch (e) { outcome = 'rmdir-failed-' + e.code; }
}
write('res-' + IDX, outcome);
`);
      assert.equal(r.late, 'DELETED-THE-WINNERS-LOCK',
        'the control must reproduce the defect, or it is not a control');
      assert.equal(existsSync(r.lock), false,
        'THE BUG: a second process that merely observed staleness removed a lock the winner was holding — ' +
        'both now believe they hold it and the read-modify-write interleaves anyway');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('the shared lock REFUSES to delete a lock it did not observe as stale', async () => {
    const dir = scratch('fix-race');
    try {
      const r = await choreograph(dir, `${PRELUDE}
const { observeLock, breakStaleLock } = await import(${JSON.stringify(LOCKFILE)});
const observed = observeLock(LOCK);
write('observed', observed.ageMs);
waitForGo();
// Same decision the pre-C2 code made — "this lock is stale, break it" — but carrying WHAT WAS
// OBSERVED, so the removal can be a compare-and-delete instead of an unconditional rmdir.
write('res-' + IDX, breakStaleLock(LOCK, observed));
`);
      assert.equal(r.late, 'moved',
        'the late breaker must report that the lock changed hands, not that it broke one');
      assert.equal(existsSync(r.lock), true,
        'THE FIX: the winner\'s freshly acquired lock must survive a concurrent stale-break');
      assert.equal(ownerNonceAt(r.lock), r.winnerNonce,
        'and it must still be the WINNER\'S lock — not a replacement minted by the late breaker');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — mtime refresh on takeover', () => {
  // a takeover that leaves the directory untouched reads as available to every later process
  const thirdPartyVerdict = (lock) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { inspectLock } = await import(${JSON.stringify(LOCKFILE)});
      const s = inspectLock(${JSON.stringify(lock)}, { staleMs: ${STALE_MS} });
      const fs = await import('node:fs');
      process.stdout.write(JSON.stringify({ ...s, mtimeAgeMs: Date.now() - fs.statSync(${JSON.stringify(lock)}).mtimeMs }));
    `], { encoding: 'utf8' });
    assert.equal(r.status, 0, `the third process must run: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };

  test('CONTROL: the pre-C2 takeover leaves the lock reading STALE to the next process', () => {
    const dir = scratch('ctl-mtime');
    try {
      const lock = join(dir, '.rollup.lock');
      plantStaleLock(lock, STALE_MS * 2, { tokenless: true });   // pre-C2 locks carried no token
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const fs = await import('node:fs');
        const LOCK = ${JSON.stringify(lock)};
        try { fs.mkdirSync(LOCK); } catch {
          const age = Date.now() - fs.statSync(LOCK).mtimeMs;
          if (age < ${STALE_MS}) process.exit(3);
          process.stdout.write('took over');   // ...and touched nothing
        }
      `], { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), 'took over', `the control takeover must happen: ${r.stderr}`);
      const mtimeAgeMs = Date.now() - statSync(lock).mtimeMs;
      assert.ok(mtimeAgeMs >= STALE_MS,
        `THE BUG: after a takeover the lock is still ${Math.round(mtimeAgeMs / 60000)} min old, so the ` +
        'next rollup reads it as stale and takes it over too — and so does the one after that');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('after a takeover a third process reads the lock as FRESH, not stale', () => {
    const dir = scratch('fix-mtime');
    try {
      const lock = join(dir, '.rollup.lock');
      plantStaleLock(lock, STALE_MS * 2);
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { acquireLock } = await import(${JSON.stringify(LOCKFILE)});
        const got = acquireLock(${JSON.stringify(lock)}, { staleMs: ${STALE_MS}, label: 'taker' });
        process.stdout.write(got.ok ? got.token.nonce : 'BUSY');
      `], { encoding: 'utf8' });
      assert.equal(r.status, 0, `the taker must run: ${r.stderr}`);
      const takerNonce = r.stdout.trim();
      assert.notEqual(takerNonce, 'BUSY', 'a stale lock must still be takeable — never wedging the pipeline');

      const seen = thirdPartyVerdict(lock);
      assert.equal(seen.held, true, 'the taken-over lock must be held');
      assert.equal(seen.stale, false,
        `THE FIX: a third process must read the taken-over lock as FRESH; it read ageMs=${seen.ageMs}`);
      assert.ok(seen.ageMs < 60_000, `the token's acquisition stamp must be refreshed, got ageMs=${seen.ageMs}`);
      assert.ok(seen.mtimeAgeMs < 60_000,
        `and the DIRECTORY mtime must be refreshed too — the fallback path reads that, got ${seen.mtimeAgeMs}ms`);
      assert.equal(seen.holder && seen.holder.nonce, takerNonce, 'the holder on disk must be the taker');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — release is identity-checked', () => {
  test('a holder whose lock was taken over does not delete its successor\'s lock on release', async () => {
    // an unconditional exit-handler rmdir lets a displaced run take its successor's lock down
    const dir = scratch('release');
    try {
      const lock = join(dir, '.rollup.lock');
      const { acquireLock } = await import(LOCKFILE);
      const mine = acquireLock(lock, { staleMs: 40, label: 'displaced' });
      assert.equal(mine.ok, true, 'precondition: the first holder acquires');

      await new Promise((r) => setTimeout(r, 90));   // let my own lock go stale

      const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { acquireLock } = await import(${JSON.stringify(LOCKFILE)});
        const got = acquireLock(${JSON.stringify(lock)}, { staleMs: 40, label: 'successor' });
        process.stdout.write(got.ok ? got.token.nonce : 'BUSY');
      `], { encoding: 'utf8' });
      const successor = r.stdout.trim();
      assert.notEqual(successor, 'BUSY', `the successor must take the stale lock over: ${r.stderr}`);
      assert.notEqual(successor, mine.token.nonce, 'the successor must hold a different lock');

      mine.release();   // the displaced holder finishes its work and lets go

      assert.equal(existsSync(lock), true, 'the successor\'s lock must survive the displaced holder\'s release');
      assert.equal(ownerNonceAt(lock), successor, 'and it must still be the successor\'s lock');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe('C2 — monitor/rollup.mjs is wired to the shared lock', () => {
  // runs the real script; an empty batch separates past-the-lock (exit 2/4) from blocked (exit 3)
  const runRollup = (out, batch) => spawnSync(process.execPath, [ROLLUP, batch],
    { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_MONITOR_OUT: out } });

  test('a FRESH lock aborts the rollup with exit 3, and the holder\'s lock is left intact', () => {
    const dir = scratch('e2e-fresh');
    try {
      const out = join(dir, 'out'); const batch = join(dir, 'batch');
      mkdirSync(out); mkdirSync(batch);
      const lock = join(out, '.rollup.lock');
      mkdirSync(lock);
      writeFileSync(join(lock, OWNER), JSON.stringify({ pid: 999_999, nonce: 'live-holder', at: Date.now(), label: 'other-rollup' }));

      const r = runRollup(out, batch);
      assert.equal(r.status, 3, `a held lock must abort with exit 3, got ${r.status}: ${r.stderr}`);
      assert.match(r.stderr, /another rollup is running/, 'and must say so');
      assert.equal(ownerNonceAt(lock), 'live-holder',
        'the refused rollup must not have touched the live holder\'s lock');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a STALE lock is taken over loudly, and the takeover is released afterwards', () => {
    const dir = scratch('e2e-stale');
    try {
      const out = join(dir, 'out'); const batch = join(dir, 'batch');
      mkdirSync(out); mkdirSync(batch);
      const lock = join(out, '.rollup.lock');
      plantStaleLock(lock);

      const r = runRollup(out, batch);
      assert.match(r.stderr, /taking over stale lock/, `the takeover must be announced: ${r.stderr}`);
      // 2 or 4 both prove the run got past the lock; 3 means the lock blocked it
      assert.ok([2, 4].includes(r.status), `the run must proceed past the lock (2 = empty batch, 4 = nothing to roll up), got ${r.status}`);
      assert.notEqual(r.status, 3, 'exit 3 means the lock blocked the run — the takeover did not happen');
      assert.equal(existsSync(lock), false,
        'and the lock must be released on exit — a takeover that leaks the lock re-creates the wedge');
      assert.deepEqual(readdirSync(out).filter((f) => f.startsWith('.rollup.lock')), [],
        'no staging or guard directory may be left behind by the takeover (.break-*, .new-*, .breaking)');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
