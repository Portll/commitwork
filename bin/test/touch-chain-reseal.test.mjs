// node --test bin/test/ — re-linking a ledger whose CONTENT was rewritten underneath it.
//
// The incident these were written from: on 2026-09-02 a PII scrub rewrote /Users/<a>/ to /Users/<b>/
// inside verdicts/liveness.jsonl. Its stated success criterion was that the line count matched
// before and after — which a content rewrite preserves exactly, so the check could not have moved.
// 47 successors were orphaned and the panel published "records were edited or removed" at top
// severity: true of a scrub, and indistinguishable to a reader from forgery.
//
// A reseal is the dangerous direction. Rewriting `prev` is what a forger does, so these hold the
// property that matters more than "it works": a reseal must be IMPOSSIBLE without a witness that
// independently proves each break was caused by the rewrite, and must still be tamper-evident
// afterwards.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainedAppend, verifyLedgerChain, resealChain, lineHash } from '../lib/touch-chain.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-reseal-')); dirs.push(d); return d; };
const rows = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const parsed = (p) => rows(p).map((l) => JSON.parse(l));

/** A sound ledger, a witness copy of it, then a scrub applied to the ledger only. */
function scrubbed({ n = 8, hit = 3 } = {}) {
  const d = scratch();
  const l = join(d, 'liveness.jsonl');
  for (let i = 0; i < n; i++) chainedAppend(l, { gate: 'liveness', at: `t${i}`, src: `/work/alpha/run-${i}` });
  const witness = join(d, 'witness.jsonl');
  writeFileSync(witness, readFileSync(l));            // pre-scrub copy
  assert.equal(verifyLedgerChain(l).state, 'ok', 'sound before the scrub');
  // Rewrite content in place on SOME rows — line count preserved, hashes changed.
  const all = rows(l);
  all[hit] = all[hit].replace('/work/alpha/', '/work/beta/');
  writeFileSync(l, all.join('\n') + '\n');
  return { l, witness, d, n };
}

describe('the scrub, and why its own check could not see it', () => {
  test('an in-place content rewrite preserves the line count and breaks the chain at the successor', () => {
    const { l, witness } = scrubbed();
    assert.equal(rows(l).length, rows(witness).length, 'THE TRAP: line count is identical — a count check cannot move');
    const v = verifyLedgerChain(l);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'chain-broken');
    assert.equal(v.totals.broken, 1, 'exactly the rewritten row’s successor');
  });
});

describe('a reseal is refused unless a witness proves the cause', () => {
  test('NO witness — refused outright, and the file is not touched', () => {
    const { l } = scrubbed();
    const before = readFileSync(l, 'utf8');
    const r = resealChain(l, { from: 'scrub' });
    assert.equal(r.ok, false);
    assert.match(r.refused, /no witness/i);
    assert.equal(readFileSync(l, 'utf8'), before, 'byte-identical — a refusal costs the file nothing');
  });

  test('THE GUARD: a break the witness cannot account for refuses the WHOLE reseal', () => {
    const { l, witness } = scrubbed();
    // A second break that is NOT scrub-caused — the tamper this must never quietly repair.
    const all = rows(l);
    all[6] = JSON.stringify({ ...JSON.parse(all[6]), prev: lineHash('a line that never existed') });
    writeFileSync(l, all.join('\n') + '\n');
    const before = readFileSync(l, 'utf8');

    const r = resealChain(l, { witness, from: 'scrub' });
    assert.equal(r.ok, false, 'refused');
    assert.match(r.refused, /absent from the witness/);
    assert.equal(r.resealed, 0);
    assert.equal(readFileSync(l, 'utf8'), before,
      'NOTHING was rewritten — partial credit would leave a file that verifies with the tamper skipped');
    assert.equal(verifyLedgerChain(l).state, 'chain-broken', 'and the break still alarms');
  });

  test('an empty or unreadable witness proves nothing and is refused', () => {
    const { l, d } = scrubbed();
    const empty = join(d, 'empty.jsonl'); writeFileSync(empty, '');
    assert.match(resealChain(l, { witness: empty }).refused, /empty/);
    assert.match(resealChain(l, { witness: join(d, 'nope.jsonl') }).refused, /unreadable/);
  });
});

describe('a proven reseal restores the links and says so on every row it touched', () => {
  test('the chain verifies afterwards, and payloads are untouched', () => {
    const { l, witness, n } = scrubbed();
    const payloadsBefore = parsed(l).map((r) => `${r.at}|${r.src}`);

    const r = resealChain(l, { witness, from: 'pii-scrub-2026-09-02', at: '2026-09-07T00:00:00.000Z' });
    assert.equal(r.ok, true, r.refused);
    assert.equal(r.proven, 1, 'one break, proven against the witness');
    assert.ok(r.resealed >= 1);

    const v = verifyLedgerChain(l);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'ok', 'the chain verifies');
    assert.equal(v.totals.broken, 0);
    assert.equal(rows(l).length, n, 'no row added, none dropped');
    assert.deepEqual(parsed(l).map((x) => `${x.at}|${x.src}`), payloadsBefore,
      'payloads byte-for-byte unchanged — the redaction stands, only links moved');
  });

  test('THE CASCADE IS MARKED: every row whose link was rewritten declares it, downstream ones included', () => {
    const { l, witness } = scrubbed({ n: 8, hit: 2 });
    resealChain(l, { witness, from: 'pii-scrub-2026-09-02', at: '2026-09-07T00:00:00.000Z' });
    const marked = parsed(l).filter((x) => x.resealed);
    assert.ok(marked.length >= 2, `the break AND its downstream rows are marked (got ${marked.length})`);
    for (const m of marked) {
      assert.equal(m.resealed.from, 'pii-scrub-2026-09-02');
      assert.equal(m.resealed.at, '2026-09-07T00:00:00.000Z');
      assert.ok('was' in m.resealed, 'the link it carried before is preserved');
      assert.notEqual(m.resealed.was, m.prev, 'and it genuinely differs from the new one');
    }
  });

  test('THE POINT: tamper evidence survives the reseal — editing a resealed row still breaks the chain', () => {
    const { l, witness } = scrubbed();
    resealChain(l, { witness, from: 'scrub' });
    assert.equal(verifyLedgerChain(l).state, 'ok', 'positive control: sound after the reseal');

    const all = rows(l);
    const i = all.findIndex((x) => x.includes('"resealed"'));
    assert.ok(i >= 0 && i < all.length - 1, 'a resealed row with a successor');
    all[i] = all[i].replace('/work/', '/work/x');
    writeFileSync(l, all.join('\n') + '\n');

    const v = verifyLedgerChain(l);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'chain-broken', 'a resealed row is no less tamper-evident than an untouched one');
  });

  test('a second reseal is a no-op — nothing left unproven, nothing rewritten twice', () => {
    const { l, witness } = scrubbed();
    resealChain(l, { witness, from: 'scrub' });
    const after1 = readFileSync(l, 'utf8');
    const r = resealChain(l, { witness, from: 'scrub' });
    assert.equal(r.ok, true, r.refused);
    assert.equal(r.resealed, 0, 'no breaks remain to reseal');
    assert.equal(readFileSync(l, 'utf8'), after1, 'byte-identical on the second pass');
  });

  test('a sound ledger is left alone entirely', () => {
    const { witness } = scrubbed();
    const r = resealChain(witness, { witness, from: 'scrub' });
    assert.equal(r.ok, true);
    assert.equal(r.resealed, 0);
  });
});
