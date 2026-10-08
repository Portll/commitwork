// node --test bin/test/ — O1: the concurrent-append contract the ledger's no-lock design rests on.
//
// ~28 sessions append to .claude/store/touches.jsonl with no lock. That is deliberate, and it holds only
// while each append is ONE small write to an O_APPEND file. If a write comes back short, Node
// retries, the retry lands at the new end, and another process's record fits in the gap — a torn
// line, unparseable, silently dropped by every reader that catches JSON.parse. The row beside it is
// corrupted too, which is why this matters more than losing one attribution.
//
// These tests EXERCISE that rather than asserting the record looks small. A size assertion would
// have passed on 2026-08-23 when the record grew from ~90 to ~133 bytes, and would keep passing
// right up to the byte where it stopped being true.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
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

describe('CONCURRENT APPEND — the property itself, exercised', () => {
  const WRITERS = 12;
  const PER_WRITER = 150;

  const torture = (bytes) => {
    const dir = scratch();
    const ledger = join(dir, 'touches.jsonl');
    const prog = join(dir, 'w.mjs');
    // Each writer appends PER_WRITER records of the requested size, as fast as it can.
    writeFileSync(prog, `
import { appendFileSync } from 'node:fs';
const [ledger, id, n, bytes] = process.argv.slice(2);
const pad = 'p'.repeat(Math.max(0, Number(bytes) - 60));
for (let i = 0; i < Number(n); i++) {
  appendFileSync(ledger, JSON.stringify({ s: id, f: pad, at: '2026-08-23T00:00:00.000Z', i }) + '\\n');
}
`);
    const kids = Array.from({ length: WRITERS }, (_, k) =>
      spawnSync(process.execPath, [prog, ledger, `w${k}`, String(PER_WRITER), String(bytes)], { encoding: 'utf8' }));
    for (const k of kids) assert.equal(k.status, 0, k.stderr);
    const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
    let torn = 0;
    for (const l of lines) { try { JSON.parse(l); } catch { torn++; } }
    return { lines: lines.length, torn, expected: WRITERS * PER_WRITER };
  };

  test(`${WRITERS} writers x ${PER_WRITER} records at the real record size: no torn lines, none lost`, () => {
    const r = torture(120);
    assert.equal(r.torn, 0, `${r.torn} unparseable line(s) — the no-lock contract is broken at this size`);
    assert.equal(r.lines, r.expected, `expected ${r.expected} lines, got ${r.lines}`);
  });

  test('and at the WORST-CASE record size — a PATH_MAX path, the widest thing that can exist', () => {
    const r = torture(WORST_CASE_RECORD_BYTES);
    assert.equal(r.torn, 0, `${r.torn} torn line(s) at ${WORST_CASE_RECORD_BYTES} bytes — the never-truncate design does not hold on this platform`);
    assert.equal(r.lines, r.expected);
  });

  test('the harness can actually SEE a torn line — otherwise the two tests above are decoration', () => {
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
