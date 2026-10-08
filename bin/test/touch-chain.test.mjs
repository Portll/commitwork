// node --test bin/test/ — the touch ledger's hash chain. The attribution log decides whose work is
// whose; until 2026-08-27 it was a plain append anyone could rewrite without a trace. These tests
// prove the chain in BOTH directions — a good ledger verifies, a tampered one breaks — because only
// one of those directions lies to you (the guard-needs-a-second-witness rule: a verifier that
// cannot fire is decoration).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chainedAppend, verifyLedgerChain, lineHash, readTailLine } from '../lib/touch-chain.mjs';
import { acquireLock } from '../../monitor/lockfile.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO, 'bin', 'touch-ledger.mjs');
const CLI = join(REPO, 'bin', 'touch-chain.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-chain-')); dirs.push(d); return d; };

const rows = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const parsed = (p) => rows(p).map((l) => JSON.parse(l));

describe('the chain writes', () => {
  test('a fresh ledger starts at genesis and every append links to its predecessor', () => {
    const l = join(scratch(), 'touches.jsonl');
    assert.equal(chainedAppend(l, { s: 'aaaa0001', f: 'x.mjs' }).mode, 'chained');
    assert.equal(chainedAppend(l, { s: 'aaaa0001', f: 'y.mjs' }).mode, 'chained');
    const [a, b] = parsed(l);
    assert.equal(a.prev, 'genesis');
    assert.equal(b.prev, lineHash(rows(l)[0]));
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'ok');
    assert.equal(v.totals.verified, 2);
    assert.equal(v.totals.broken, 0);
  });

  test('a legacy (pre-chain) ledger is extended, not restarted — the first chained record links to the last legacy line', () => {
    const l = join(scratch(), 'touches.jsonl');
    appendFileSync(l, `${JSON.stringify({ s: 'old00001', f: 'a.mjs' })}\n`);
    appendFileSync(l, `${JSON.stringify({ s: 'old00001', f: 'b.mjs' })}\n`);
    chainedAppend(l, { s: 'new00001', f: 'c.mjs' });
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'ok');
    assert.equal(v.totals.unchained, 2, 'legacy records are their own counted state — grey, not broken');
    assert.equal(v.totals.verified, 1, 'the chained record verifies against the legacy tail');
  });

  test('lock contention degrades to a marked unlinked append — the record is never dropped and never fake-linked', () => {
    const dir = scratch();
    const l = join(dir, 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'x.mjs' });
    const held = acquireLock(`${l}.lock`, { label: 'test holder' });
    assert.equal(held.ok, true);
    try {
      const r = chainedAppend(l, { s: 'bbbb0002', f: 'y.mjs' }, { lockAttempts: 2, lockSpinMs: 1 });
      assert.equal(r.ok, true);
      assert.equal(r.mode, 'unlinked');
    } finally { held.release(); }
    assert.equal(parsed(l)[1].prev, 'unlinked');
    // The chain continues OVER the unlinked line: the next locked append links to its hash.
    chainedAppend(l, { s: 'aaaa0001', f: 'z.mjs' });
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'ok');
    assert.deepEqual(
      { verified: v.totals.verified, unlinked: v.totals.unlinked, broken: v.totals.broken },
      { verified: 2, unlinked: 1, broken: 0 },
    );
  });
});

describe('the chain catches tampering — the direction that matters', () => {
  const build = () => {
    const l = join(scratch(), 'touches.jsonl');
    for (const f of ['a.mjs', 'b.mjs', 'c.mjs']) chainedAppend(l, { s: 'aaaa0001', f });
    assert.equal(verifyLedgerChain(l).state, 'ok', 'positive control: untouched ledger verifies');
    return l;
  };

  test('editing an interior record breaks the chain at its successor', () => {
    const l = build();
    const lines = rows(l);
    lines[1] = lines[1].replace('b.mjs', 'B.mjs');   // still valid JSON — a quiet rewrite
    writeFileSync(l, `${lines.join('\n')}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'chain-broken');
    assert.equal(v.totals.broken, 1);
    assert.equal(v.breaks[0].line, 3, 'the edit is detected at the record that chained over the original');
  });

  test('deleting an interior record breaks the chain', () => {
    const l = build();
    const lines = rows(l);
    lines.splice(1, 1);
    writeFileSync(l, `${lines.join('\n')}\n`);
    assert.equal(verifyLedgerChain(l).state, 'chain-broken');
  });

  test('truncate-and-restart reads as broken — the kept record dangles off the erased history', () => {
    // A full rewrite-from-genesis is indistinguishable from a fresh ledger by the chain alone
    // (that bound is the anchor machinery's); what the chain DOES catch is any surviving record
    // that still links into the erased history.
    const l = build();
    const kept = rows(l)[2];
    writeFileSync(l, `${JSON.stringify({ s: 'aaaa0001', f: 'a.mjs', prev: 'genesis' })}\n${kept}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'chain-broken');
    assert.ok(v.breaks.some((b) => /matches no line/.test(b.why)));
  });

  test('a genesis anywhere but the very start is the restart signature', () => {
    const l = build();
    appendFileSync(l, `${JSON.stringify({ s: 'aaaa0001', f: 'd.mjs', prev: 'genesis' })}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'chain-broken');
    assert.ok(v.breaks.some((b) => /genesis mid-file/.test(b.why)));
  });

  test('a live file reborn at genesis while an archive survives is broken, not fresh', () => {
    const dir = scratch();
    const l = join(dir, 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'a.mjs' });
    writeFileSync(`${l}.1`, readFileSync(l));                     // an archived generation exists
    writeFileSync(l, `${JSON.stringify({ s: 'aaaa0001', f: 'x.mjs', prev: 'genesis' })}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'chain-broken');
    assert.ok(v.breaks.some((b) => /genesis after an earlier generation/.test(b.why)));
  });

  test('a torn line is counted, never silently skipped — and the chain stays consistent around it', () => {
    const l = build();
    appendFileSync(l, '{"s":"torn","f":"x"\n');
    chainedAppend(l, { s: 'aaaa0001', f: 'd.mjs' });   // links over the torn line's hash
    const v = verifyLedgerChain(l);
    assert.equal(v.totals.torn, 1);
    assert.equal(v.totals.broken, 0, 'torn is a crash artifact, not an edit — its own state');
    assert.equal(v.state, 'torn');
  });

  test('a benign overlap (two writers naming one prev) reads as raced, never as an edit', () => {
    const l = join(scratch(), 'touches.jsonl');
    const l1 = JSON.stringify({ s: 'a', f: '1', prev: 'genesis' });
    const l2 = JSON.stringify({ s: 'b', f: '2', prev: lineHash(l1) });
    const l3 = JSON.stringify({ s: 'c', f: '3', prev: lineHash(l1) });   // read the same tail as l2
    writeFileSync(l, `${l1}\n${l2}\n${l3}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'ok');
    assert.deepEqual({ raced: v.totals.raced, broken: v.totals.broken }, { raced: 1, broken: 0 });
  });

  test('an unreadable ledger THROWS — it is never an empty or clean one', () => {
    const dir = scratch();
    const asDir = join(dir, 'touches.jsonl');
    mkdirSync(asDir);
    assert.throws(() => verifyLedgerChain(asDir));
  });

  test('an absent ledger is its own state', () => {
    assert.equal(verifyLedgerChain(join(scratch(), 'touches.jsonl')).state, 'absent');
  });
});

describe('rotation', () => {
  test('the boundary record names the rotated tail, and verification crosses it', () => {
    const l = join(scratch(), 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'a.mjs' }, { maxBytes: 10 });
    const r = chainedAppend(l, { s: 'aaaa0001', f: 'b.mjs' }, { maxBytes: 10 });   // first append over 10 bytes rotates
    assert.equal(r.rotated, true);
    assert.equal(existsSync(`${l}.1`), true);
    assert.equal(parsed(l)[0].prev, `rotation:${lineHash(rows(`${l}.1`).at(-1))}`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'ok');
    assert.equal(v.totals.verified, 2);
  });

  test('editing the archived tail breaks the boundary', () => {
    const l = join(scratch(), 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'a.mjs' }, { maxBytes: 10 });
    chainedAppend(l, { s: 'aaaa0001', f: 'b.mjs' }, { maxBytes: 10 });
    const arch = rows(`${l}.1`);
    arch[arch.length - 1] = arch.at(-1).replace('a.mjs', 'A.mjs');
    writeFileSync(`${l}.1`, `${arch.join('\n')}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.state, 'chain-broken');
    assert.ok(v.breaks.some((b) => /rotation boundary/.test(b.why)));
  });

  test('a racer displaced past the boundary is tolerated — its line lands after the captured tail', () => {
    const l = join(scratch(), 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'a.mjs' }, { maxBytes: 10 });
    chainedAppend(l, { s: 'aaaa0001', f: 'b.mjs' }, { maxBytes: 10 });
    // Simulate the unlinked appender whose write landed in the old inode mid-rename.
    appendFileSync(`${l}.1`, `${JSON.stringify({ s: 'cccc0003', f: 'late.mjs', prev: 'unlinked' })}\n`);
    const v = verifyLedgerChain(l);
    assert.equal(v.totals.broken, 0, 'the boundary matches within its slack window');
    assert.equal(v.totals.unlinked, 1);
  });
});

describe('concurrency — the property, exercised through the real writer', () => {
  test('parallel chained writers lose nothing and break nothing', () => {
    const dir = scratch();
    const l = join(dir, 'touches.jsonl');
    const prog = join(dir, 'w.mjs');
    writeFileSync(prog, `
import { chainedAppend } from ${JSON.stringify(pathToFileURL(join(REPO, 'bin/lib/touch-chain.mjs')).href)};
const [ledger, id, n] = process.argv.slice(2);
for (let i = 0; i < Number(n); i++) {
  const r = chainedAppend(ledger, { s: id, f: 'f' + i + '.mjs', at: '2026-08-27T00:00:00.000Z' });
  if (!r.ok) process.exit(1);
}
`);
    const WRITERS = 6;
    const PER = 20;
    const kids = Array.from({ length: WRITERS }, (_, k) =>
      spawnSync(process.execPath, [prog, l, `w${k}00000`.slice(0, 8), String(PER)], { encoding: 'utf8' }));
    for (const k of kids) assert.equal(k.status, 0, k.stderr);
    const v = verifyLedgerChain(l);
    const total = WRITERS * PER;
    assert.equal(rows(l).length, total, 'every record landed');
    assert.equal(v.totals.torn, 0);
    assert.equal(v.totals.broken, 0, 'contention degrades to unlinked/raced, never to broken');
    assert.equal(v.totals.verified + v.totals.raced + v.totals.unlinked, total);
  });
});

describe('the hook writes chained records', () => {
  const fire = (ledger, payload) => execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CW_TOUCH_LEDGER: ledger },
  });

  test('an Edit through the hook lands with prev, and a second one links to the first', () => {
    const l = join(scratch(), 'touches.jsonl');
    fire(l, { session_id: 'aaaabbbb-1', tool_input: { file_path: join(REPO, 'monitor/retention.mjs') } });
    fire(l, { session_id: 'aaaabbbb-1', tool_input: { file_path: join(REPO, 'monitor/rollup.mjs') } });
    const [a, b] = parsed(l);
    assert.equal(a.prev, 'genesis');
    assert.equal(b.prev, lineHash(rows(l)[0]));
    assert.equal(verifyLedgerChain(l).state, 'ok');
  });

  test('a garbage payload still exits 0 and writes nothing — the unfailing contract survives the chain', () => {
    const l = join(scratch(), 'touches.jsonl');
    execFileSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', env: { ...process.env, CW_TOUCH_LEDGER: l } });
    assert.equal(existsSync(l), false);
  });
});

describe('the CLI', () => {
  const cli = (ledger) => spawnSync(process.execPath, [CLI, '--json'], {
    encoding: 'utf8', env: { ...process.env, CW_TOUCH_LEDGER: ledger },
  });

  test('exit 0 and state ok on a sound ledger; exit 1 on a broken one', () => {
    const l = join(scratch(), 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'a.mjs' });
    chainedAppend(l, { s: 'aaaa0001', f: 'b.mjs' });
    const good = cli(l);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).state, 'ok');

    const lines = rows(l);
    lines.splice(0, 1);
    writeFileSync(l, `${lines.join('\n')}\n`);
    const bad = cli(l);
    assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).state, 'chain-broken');
  });
});

describe('readTailLine', () => {
  test('finds the last line of a file wider than its window, and null on absent/empty', () => {
    const dir = scratch();
    const p = join(dir, 'wide.jsonl');
    const big = 'x'.repeat(9000);
    writeFileSync(p, `${JSON.stringify({ pad: big })}\n${JSON.stringify({ tail: true })}\n`);
    assert.equal(JSON.parse(readTailLine(p)).tail, true);
    assert.equal(readTailLine(join(dir, 'absent.jsonl')), null);
    writeFileSync(join(dir, 'empty.jsonl'), '');
    assert.equal(readTailLine(join(dir, 'empty.jsonl')), null);
    // A last line wider than the window is still returned whole (the widen-to-file fallback).
    writeFileSync(p, `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ pad: big })}\n`);
    assert.equal(JSON.parse(readTailLine(p, 1024)).pad, big);
  });
});

describe('a MISSING generation is reported as its own fact, not as a tamper', () => {
  // Rotation numbers archives `.1` (newest) upward, so the sequence beside a live ledger is dense.
  // A hole means a FILE is gone; a `break` means a ROW was rewritten. Reading the first as the
  // second sends the next reader hunting a tamper that never happened — measured 2026-09-02 on the
  // live store, where `.1` was absent and the orphaned boundary hash matched the last line of `.4`.
  const store = (gens) => {
    const d = mkdtempSync(join(tmpdir(), 'cw-gap-'));
    const live = join(d, 't.jsonl');
    const row = `${JSON.stringify({ s: 'x', at: '2026-01-01T00:00:00Z', f: 'a' })}\n`;
    writeFileSync(live, row);
    for (const n of gens) writeFileSync(`${live}.${n}`, row);
    return { d, live };
  };

  test('a DENSE sequence reports no gap — the guard must not fire on a healthy store', () => {
    const { d, live } = store([1, 2, 3]);
    try { assert.deepEqual(verifyLedgerChain(live).gaps, []); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a hole at .1 is named', () => {
    const { d, live } = store([2, 3, 4]);
    try { assert.deepEqual(verifyLedgerChain(live).gaps, [1]); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('several holes are all named, in order', () => {
    const { d, live } = store([1, 4]);
    try { assert.deepEqual(verifyLedgerChain(live).gaps, [2, 3]); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('no archives at all is not a gap — a fresh store has nothing missing', () => {
    const { d, live } = store([]);
    try { assert.deepEqual(verifyLedgerChain(live).gaps, []); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a RENUMBERED predecessor is the chain holding, not failing', () => {
  // Rotation shifts every archive down one, so a boundary written when its predecessor was `.1`
  // still names that content once it has become `.4`. Matching only the ADJACENT generation reports
  // an intact chain as chain-broken — a fabricated critical on the one store whose entire claim is
  // that nothing has been forged. Measured 2026-09-02: git records this store's
  // `{touches.jsonl.1 => touches.jsonl.4}` as a pure rename, 0 lines changed.
  const row = (n, prev) => JSON.stringify({ s: 'sess1234', at: `2026-01-01T00:00:0${n}Z`, f: `f${n}.mjs`, prev });

  /** oldest .3, then .2, then live — each internally chained, live's boundary set by the caller. */
  const build = (liveBoundaryFrom) => {
    const d = mkdtempSync(join(tmpdir(), 'cw-renum-'));
    const live = join(d, 't.jsonl');
    const g3a = row(1, 'genesis'); const g3b = row(2, lineHash(g3a));
    writeFileSync(`${live}.3`, `${g3a}\n${g3b}\n`);
    const g2a = row(3, `rotation:${lineHash(g3b)}`); const g2b = row(4, lineHash(g2a));
    writeFileSync(`${live}.2`, `${g2a}\n${g2b}\n`);
    const boundary = liveBoundaryFrom === 'adjacent' ? lineHash(g2b)
      : liveBoundaryFrom === 'renumbered' ? lineHash(g3b)
      : lineHash('a line that is in no generation at all');
    writeFileSync(live, `${row(5, `rotation:${boundary}`)}\n`);
    return { d, live };
  };

  test('the ADJACENT generation still verifies — the ordinary case is unchanged', () => {
    const { d, live } = build('adjacent');
    try {
      const r = verifyLedgerChain(live);
      assert.equal(r.totals.broken, 0);
      assert.equal(r.totals.renumbered, 0, 'a normal boundary must not be reported as renumbered');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a predecessor that survives under a LATER number is renumbered, not broken', () => {
    const { d, live } = build('renumbered');
    try {
      const r = verifyLedgerChain(live);
      assert.equal(r.totals.broken, 0, 'an intact chain must not be reported as broken');
      assert.equal(r.totals.renumbered, 1);
      assert.match(r.renumberings[0].foundIn, /\.3$/, 'the report must name WHICH generation carries it');
      assert.notEqual(r.state, 'chain-broken');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  // THE ARM THAT MATTERS. Widening the match must not swallow a real edit: if the boundary names
  // content that is in NO surviving generation, an archive was rewritten and that is still a break.
  // A guard tested only where it forgives cannot tell "forgives the right thing" from "forgives
  // everything", and this one guards the tamper-evidence itself.
  test('a boundary matching NO generation is STILL a break — tamper detection survives', () => {
    const { d, live } = build('nowhere');
    try {
      const r = verifyLedgerChain(live);
      assert.equal(r.totals.broken, 1, 'a real edit must still break the chain');
      assert.equal(r.totals.renumbered, 0);
      assert.equal(r.state, 'chain-broken');
      assert.match(r.breaks[0].why, /ANY surviving generation/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a half-completed rotation says WHICH half', () => {
  // shiftArchives and the rename are two operations; only the pair is a rotation. A shift that
  // succeeds with a failed rename leaves the archives moved down one and NO `.1` — a generation
  // hole indistinguishable, months later, from a deletion nobody can explain. Both used to land in
  // the same silent `unlinked` bucket as ordinary lock contention.
  // darwin-only: `chflags uchg` is the one way to make rename(2) fail for a reason that is not a
  // name collision, and shiftArchives is deliberately collision-proof (it enumerates once and moves
  // highest-first, so a blocked slot is always freed ahead of the move into it). Two earlier
  // attempts proved that the hard way: a directory at `.1` was simply shifted out of the way and
  // the rotation SUCCEEDED, and a read-only store directory blocked the LOCK instead, so no
  // rotation was attempted at all. A guard's test has to actually fail the guard.
  test('a failed RENAME is attributed to the rename, not left as generic contention', { skip: process.platform !== 'darwin' && 'darwin only (chflags)' }, () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-rotfail-'));
    const live = join(d, 't.jsonl');
    try {
      writeFileSync(live, `${'x'.repeat(200)}\n`);
      execFileSync('chflags', ['uchg', live]);
      const r = chainedAppend(live, { s: 'sess1234', f: 'a.mjs' }, { maxBytes: 50 });
      assert.match(r.rotfail ?? '', /^rename:/, `expected a rename-stage failure, got ${JSON.stringify(r)}`);
    } finally {
      try { execFileSync('chflags', ['nouchg', live]); } catch { /* already clear */ }
      rmSync(d, { recursive: true, force: true });
    }
  });

  // The other direction: ordinary contention must NOT be dressed up as a rotation failure, or the
  // marker becomes noise and stops meaning anything.
  test('an unlinked append with no rotation in flight carries NO rotfail', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-rotfail-'));
    try {
      const live = join(d, 't.jsonl');
      const r = chainedAppend(live, { s: 'sess1234', f: 'a.mjs' }, { maxBytes: 1_000_000 });
      assert.equal(r.mode, 'chained', 'precondition: a quiet append chains');
      assert.equal(r.rotfail, undefined);
      assert.doesNotMatch(readFileSync(live, 'utf8'), /rotfail/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('concurrent rotation under PRODUCTION lock settings', () => {
  // ledger-rotate.mjs carried a concurrency claim for years that was reasoning presented as a
  // result; when somebody finally measured it, three producers had taken a 250-row chain to 79.
  // chainedAppend's own claim ("happens only under the lock") had never been measured either, and
  // an earlier reading of mine called it a live defect on the strength of a 40ms-stale run — where
  // half the appends also land unlinked, which is the tell that the CONFIG is pathological.
  // This pins the real configuration so the claim stops being an argument.
  test('six writers rotating together leave the chain intact', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-conc-'));
    try {
      const live = join(d, 't.jsonl');
      const src = join(d, 'w.mjs');
      writeFileSync(src, `
import { chainedAppend } from ${JSON.stringify(pathToFileURL(join(REPO, 'bin/lib/touch-chain.mjs')).href)};
for (let i = 0; i < 120; i++) {
  chainedAppend(process.argv[2], { s: process.pid.toString(36).slice(0,8), f: 'f' + i + '.mjs' }, { maxBytes: 4000 });
}
`);
      // TRULY CONCURRENT. The first version of this test used six spawnSync calls, which BLOCK —
      // the writers ran one after another and the test would have passed forever while asserting
      // nothing about contention. A concurrency test that does not overlap is a marker, not a
      // measurement. `&` + `wait` in one shell is what actually overlaps them.
      const cmd = Array.from({ length: 6 }, () => `"${process.execPath}" "${src}" "${live}" &`).join(' ') + ' wait';
      const sh = spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
      assert.equal(sh.status, 0, sh.stderr);
      const r = verifyLedgerChain(live);
      // The chain, not the row count: rotation is allowed to age rows out, corruption is not.
      assert.equal(r.totals.broken, 0, `concurrent rotation broke the chain: ${JSON.stringify(r.breaks.slice(0, 2))}`);
      assert.deepEqual(r.gaps, [], 'a generation went missing under concurrency');
      assert.notEqual(r.state, 'chain-broken');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
