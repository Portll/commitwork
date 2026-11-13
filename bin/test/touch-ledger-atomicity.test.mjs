// node --test bin/test/ — O1: the concurrent-append contract the ledger's no-lock design rests on.
//
// Every session appends to .claude/store/touches.jsonl with no lock. That is deliberate, and it
// holds only while each append is ONE small write to an O_APPEND file. If a write comes back short,
// Node retries, the retry lands at the new end, and another process's record fits in the gap — a
// torn line, unparseable, silently dropped by every reader that catches JSON.parse. The row beside
// it is corrupted too, which is why this matters more than losing one attribution.
//
// These tests EXERCISE that rather than asserting the record looks small. A size assertion keeps
// passing as the record grows, right up to the byte where it stops being true.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitRecord, MAX_RECORD_BYTES, WORST_CASE_RECORD_BYTES } from '../lib/touch-ledger-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-atom-')); dirs.push(d); return d; };

describe('nothing is ever truncated — PATH_MAX bounds the only unbounded field', () => {
  test('the widest record this hook can physically build is under the bound, with margin', () => {
    // macOS fixes PATH_MAX at 1024 (sys/syslimits.h), so this is not a guess about typical paths —
    // it is the widest record the filesystem permits to exist.
    const widest = { s: 'abcd1234', f: 'x'.repeat(1024), at: '2026-08-23T00:00:00.000Z', via: 'commit', sha: 'a'.repeat(40) };
    const { bytes, exceeds } = fitRecord(widest);
    assert.equal(bytes, WORST_CASE_RECORD_BYTES, 'the documented worst case must match the computed one');
    assert.equal(exceeds, false);
    assert.ok(bytes * 3 < MAX_RECORD_BYTES, `${bytes} should have ample margin under ${MAX_RECORD_BYTES}`);
  });

  test('a PATH_MAX path survives WHOLE — a trimmed path is a wrong path', () => {
    const f = `${'deep/'.repeat(200)}file.mjs`.slice(0, 1024);
    const { line } = fitRecord({ s: 'abcd1234', f, at: '2026-08-23T00:00:00.000Z' });
    assert.equal(JSON.parse(line).f, f, 'the path must round-trip byte for byte');
    assert.equal(JSON.parse(line).cut, undefined, 'no truncation marker, because no truncation');
  });

  test('fitRecord never returns null and never shortens — even absurd input comes back whole', () => {
    const rec = { s: 'a'.repeat(500), f: 'y'.repeat(5000), at: 'n' };
    const { line, exceeds } = fitRecord(rec);
    assert.equal(JSON.parse(line).f, rec.f, 'oversize input is reported, never trimmed');
    assert.equal(exceeds, true, 'and it is flagged so a caller can log the impossible');
  });

  test('PIPE_BUF is NOT the bound — adopting it would have trimmed real paths for nothing', () => {
    // Recorded because it was nearly the design: PIPE_BUF is 512 on darwin and governs PIPES.
    // This is a regular file. A 512 ceiling would trim any path over ~440 bytes.
    assert.ok(MAX_RECORD_BYTES > 512 * 2, 'the bound must not be PIPE_BUF-derived');
    assert.ok(WORST_CASE_RECORD_BYTES > 512, 'and the real worst case exceeds PIPE_BUF, which is the point');
  });
});

// The writers here must OVERLAP, and that is the whole difficulty. `spawnSync` in a loop does not:
// it blocks until each child exits, so twelve "concurrent" writers run one after another and the
// contention under test never happens. Measured on the version of this file that did exactly that —
// 0 of 66 writer pairs overlapped, and the ledger carried 11 author switches across 1,799 line
// boundaries, i.e. twelve contiguous blocks, one per writer. Its green said the append is atomic
// against itself one process at a time, which was never the question.
//
// So each writer below is started with async `spawn`, reports ready, and holds until a deadline the
// parent publishes once every one of them has arrived. Two things then have to be asserted that the
// torn-line count alone cannot establish, because without them a green run means nothing:
//
//  1. CONTENTION HAPPENED. Two witnesses with no shared failure mode — the writers' own clocks
//     (did any two spans overlap) and the file's byte order (how often does the author change from
//     one line to the next). A barrier that silently failed shows up in both, and a bug in either
//     witness is still caught by the other.
//  2. THE HARNESS CAN TEAR. A control writer that splits one record across two appends must produce
//     torn lines under the same barrier. If it does not, the harness is not contending and the two
//     clean runs are decoration.
//
// Those two are the false-positive direction. The false-negative direction is the one that lies, so
// it is asserted separately: `serial` runs this same harness the broken way on purpose, and the
// witnesses have to report the run as uncontended. A witness that cannot say "not contended" turns
// every clean run above into an unmeasured pass.
describe('CONCURRENT APPEND — the property itself, exercised', () => {
  const WRITERS = 12;
  const PER_WRITER = 150;
  const BARRIER_MS = 50;      // from "all writers ready" to the release, ample for a child's spin to see it

  const torture = async (bytes, { split = false, serial = false, writers = WRITERS, perWriter = PER_WRITER } = {}) => {
    const dir = scratch();
    const ledger = join(dir, 'touches.jsonl');
    const ready = join(dir, 'ready');
    const spans = join(dir, 'spans');
    const go = join(dir, 'GO');
    const prog = join(dir, 'w.mjs');
    mkdirSync(ready);
    mkdirSync(spans);
    // Each writer appends perWriter records of the requested size, as fast as it can, in ONE
    // appendFileSync per record — which is what bin/lib/touch-chain.mjs does in production. The
    // split mode is the control, and the only difference is that it takes two writes to say it.
    writeFileSync(prog, `
import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const [ledger, id, n, bytes, ready, go, spans, split] = process.argv.slice(2);
const pad = 'p'.repeat(Math.max(0, Number(bytes) - 60));
writeFileSync(ready + '/' + id, '');
// A deadline, not a hang: a child released alone fails the contention assertions, which is the
// honest answer, where waiting forever would take the suite down with it. It is longer than the
// parent's own patience so that starting alone means the parent failed, not that this child blinked.
const giveUp = Date.now() + 45000;
while (!existsSync(go) && Date.now() < giveUp) { /* every writer waits here for the last one */ }
const at = Number(readFileSync(go, 'utf8'));
if (!Number.isFinite(at)) throw new Error('unreadable barrier deadline');   // never start unsynchronised
while (Date.now() < at) { /* and they all leave on the same wall clock */ }
const t0 = Date.now();
for (let i = 0; i < Number(n); i++) {
  const line = JSON.stringify({ s: id, f: pad, at: '2026-08-23T00:00:00.000Z', i }) + '\\n';
  if (split === '1') { appendFileSync(ledger, line.slice(0, 24)); appendFileSync(ledger, line.slice(24)); }
  else appendFileSync(ledger, line);
}
writeFileSync(spans + '/' + id, JSON.stringify({ id, t0, t1: Date.now() }));
`);
    const launch = (k) => new Promise((done, fail) => {
      const argv = [prog, ledger, `w${k}`, String(perWriter), String(bytes), ready, go, spans, split ? '1' : '0'];
      const kid = spawn(process.execPath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      kid.stderr.on('data', (d) => { err += d; });
      kid.on('error', fail);
      kid.on('exit', (code) => (code === 0 ? done() : fail(new Error(`writer w${k} exited ${code}: ${err}`))));
    });
    const release = (at) => {
      const tmp = `${go}.tmp`;
      writeFileSync(tmp, String(at));
      renameSync(tmp, go);      // atomic, so no child can read a half-written deadline
    };
    if (serial) {
      release(Date.now());      // already past, so each child walks straight through the barrier
      for (let k = 0; k < writers; k++) await launch(k);
    } else {
      const kids = Array.from({ length: writers }, (_, k) => launch(k));
      // Released on readiness rather than on a guessed boot time: a child that was still loading
      // when the clock ran out would write alone, and the run would prove nothing it claimed to.
      const bootedBy = Date.now() + 30000;
      while (readdirSync(ready).length < writers && Date.now() < bootedBy) {
        await new Promise((r) => setTimeout(r, 5));
      }
      release(Date.now() + BARRIER_MS);
      await Promise.all(kids);
    }

    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
    let torn = 0;
    const authors = [];
    for (const l of lines) {
      try { authors.push(JSON.parse(l).s); } catch { torn++; authors.push(null); }
    }
    // Witness 1 — the writers' own clocks. Witness 2 — how often the author changes between
    // adjacent lines, which serial execution pins at exactly writers - 1.
    //
    // Both are counted over the RUN and not per writer. A per-writer form ("every writer overlapped
    // somebody") flaked on this machine: eleven test files run in parallel and a peer session on top
    // of them can starve one child long enough to do its whole 150 appends after the others have
    // exited, and a run where eleven writers collided is a contended run. The floors below are
    // instead set where a serial run cannot reach them at all.
    const seen = readdirSync(spans).map((f) => JSON.parse(readFileSync(join(spans, f), 'utf8')));
    let overlapPairs = 0;
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        if (seen[i].t0 < seen[j].t1 && seen[j].t0 < seen[i].t1) overlapPairs++;
      }
    }
    let switches = 0;
    for (let i = 1; i < authors.length; i++) if (authors[i] !== authors[i - 1]) switches++;
    return { lines: lines.length, torn, expected: writers * perWriter, reported: seen.length, overlapPairs, switches };
  };

  // Called on the runs whose cleanliness is the claim — a contention check on a separate run would
  // say nothing about the run that reported no tears.
  const assertContended = (r, writers = WRITERS) => {
    assert.equal(r.reported, writers, `${r.reported} of ${writers} writers reported a span`);
    // Serial gives 0 overlapping pairs of the 66 twelve writers can make, so any floor at all
    // separates the two cases. Measured 30 to 66 with the machine deliberately loaded (16 then 40
    // spinning processes on 18 cores, alongside ten neighbouring test files, 2026-10-20) — load
    // raises the count rather than lowering it, because a slower writer is a wider span.
    assert.ok(r.overlapPairs >= writers,
      `${r.overlapPairs} overlapping writer pairs — a serial run gives 0, so the barrier did not hold`);
    // A serial run produces EXACTLY writers - 1 switches and cannot produce more, so a floor a few
    // multiples up is unreachable by one. Kept far below the contended measurement (459 at worst
    // under that same load, 1,756 idle, of 1,799 boundaries) because on a single-core runner the
    // interleaving is bounded by the scheduler quantum and not by the appends — the overlap above
    // says the writers ran together, and this says their writes actually interleaved.
    assert.ok(r.switches > (writers - 1) * 3,
      `${r.switches} author switches across ${r.lines} lines — serial execution gives exactly ${writers - 1}, so this run was not contended`);
  };

  test(`${WRITERS} writers x ${PER_WRITER} records at the real record size: no torn lines, none lost`, async () => {
    const r = await torture(120);
    assertContended(r);
    assert.equal(r.torn, 0, `${r.torn} unparseable line(s) — the no-lock contract is broken at this size`);
    assert.equal(r.lines, r.expected, `expected ${r.expected} lines, got ${r.lines}`);
  });

  test('and at the WORST-CASE record size — a PATH_MAX path, the widest thing that can exist', async () => {
    const r = await torture(WORST_CASE_RECORD_BYTES);
    assertContended(r);
    assert.equal(r.torn, 0, `${r.torn} torn line(s) at ${WORST_CASE_RECORD_BYTES} bytes — the never-truncate design does not hold on this platform`);
    assert.equal(r.lines, r.expected);
  });

  test('the control — two appends per record DOES tear under this same harness', async () => {
    // The one-write append is the entire contract, so the control is the same run with the write
    // split in two. A harness that cannot make THIS tear cannot certify the runs above.
    const r = await torture(120, { split: true });
    assertContended(r);
    assert.ok(r.torn > 0, 'a record split across two appends came through intact — the writers are not overlapping');
  });

  test('the OTHER control — run the same harness serially and both witnesses must call it uncontended', async () => {
    // The false-negative direction, asserted on its own, because it is the one that lies: a
    // contention witness that cannot report an uncontended run would have passed this file's
    // previous spawnSync shape, which never overlapped once. Three writers rather than twelve
    // because serial costs a node boot each and the serial numbers do not depend on the count.
    const r = await torture(120, { writers: 3, perWriter: 5, serial: true });
    assert.equal(r.overlapPairs, 0, 'nothing overlapped, and the clock witness has to say so');
    assert.equal(r.switches, 2, 'one contiguous block per writer — exactly writers - 1 author switches');
    assert.equal(r.torn, 0, 'and serial appends do not tear, which is why no-tear alone proves nothing');
    assert.throws(() => assertContended(r, 3), /a serial run gives 0/, 'the guard must refuse a run like this');
  });

  test('the harness can actually SEE a torn line — otherwise the clean runs above are decoration', () => {
    // Non-vacuity: plant a deliberate tear and prove the detector fires. Without this, a torture
    // test that never tears and a torture test that cannot detect tearing look identical.
    const dir = scratch();
    const l = join(dir, 'x.jsonl');
    appendFileSync(l, `${JSON.stringify({ s: 'ok', f: 'a' })}\n`);
    appendFileSync(l, '{"s":"torn","f":"b"\n');           // truncated mid-object
    const lines = readFileSync(l, 'utf8').split('\n').filter(Boolean);
    let torn = 0;
    for (const x of lines) { try { JSON.parse(x); } catch { torn++; } }
    assert.equal(torn, 1, 'the tear detector must fire on a known-bad line');
  });
});

describe('the live ledger is within the contract', () => {
  test('no record in the real ledger exceeds the bound, and none is torn', () => {
    let text;
    try { text = readFileSync(join(REPO, '.claude', 'touches.jsonl'), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return; throw e; }   // absent is legitimately absent
    const lines = text.split('\n').filter(Boolean);
    const over = lines.filter((l) => Buffer.byteLength(l) + 1 > MAX_RECORD_BYTES);
    assert.deepEqual(over.map((l) => l.slice(0, 60)), [], `${over.length} live record(s) exceed ${MAX_RECORD_BYTES} bytes`);
    let torn = 0;
    for (const l of lines) { try { JSON.parse(l); } catch { torn++; } }
    assert.equal(torn, 0, `${torn} torn line(s) in the live ledger — the no-lock contract has already failed in production`);
  });
});
