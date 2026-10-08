// node --test bin/test/ — weaving a divergent copy of a ledger back onto the live tip.
//
// The gap these cover was found by falling into it. On 2026-09-06 the sidecar's
// store/touches.jsonl existed in two independently-appended copies; they were merged by sorting
// both together, which broke 171 chain links in a file that verified `ok` on BOTH sides beforehand.
// The union did not discover a problem, it created one — and the file it produced still looked like
// a ledger, which is the part that matters.
//
// So these tests hold two directions at once, and the second is the one that lies to you: that a
// weave RESTORES verifiability, and that it does not become a way to LAUNDER an edit. Relinking is
// the forger's move. A weave that erased the original links would leave the store verifying `ok`
// with no record that anything had been rewritten — a green that ends the enquiry instead of
// inviting it. Hence `woven.was`, and hence the tamper test below, which is the real subject here:
// tamper evidence must survive the repair, or the repair is a hole.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainedAppend, verifyLedgerChain, weaveLedgerRows, lineHash } from '../lib/touch-chain.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-weave-')); dirs.push(d); return d; };
const rows = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const parsed = (p) => rows(p).map((l) => JSON.parse(l));

/** Two ledgers that share a history and then diverge — the merge case, built honestly. */
function diverged() {
  const d = scratch();
  const a = join(d, 'a.jsonl');
  const b = join(d, 'b.jsonl');
  chainedAppend(a, { s: 'shared01', f: 'common-1.mjs' });
  chainedAppend(a, { s: 'shared01', f: 'common-2.mjs' });
  writeFileSync(b, readFileSync(a));            // b forks from a's history
  chainedAppend(a, { s: 'boxaaa01', f: 'only-on-a.mjs' });
  chainedAppend(b, { s: 'boxbbb01', f: 'only-on-b-1.mjs' });
  chainedAppend(b, { s: 'boxbbb01', f: 'only-on-b-2.mjs' });
  return { a, b };
}

describe('the union that started this — the failure mode being replaced', () => {
  test('NEGATIVE CONTROL: sorting two divergent copies together breaks the chain, though each verifies alone', () => {
    const { a, b } = diverged();
    assert.equal(verifyLedgerChain(a).state, 'ok', 'side A is sound before the merge');
    assert.equal(verifyLedgerChain(b).state, 'ok', 'side B is sound before the merge');

    const union = join(scratch(), 'union.jsonl');
    writeFileSync(union, [...new Set([...rows(a), ...rows(b)])].sort().join('\n') + '\n');

    const v = verifyLedgerChain(union);
    assert.ok(v.totals.examined > 0, 'the verifier must actually have read rows for this to mean anything');
    assert.equal(v.state, 'chain-broken', 'a sorted union of two sound ledgers is NOT a sound ledger');
    assert.ok(v.totals.broken > 0, `the union breaks links (broke ${v.totals.broken})`);
  });
});

describe('weaving restores a checkable chain without erasing what it repaired', () => {
  test('the woven ledger verifies, and every row that was woven in is still there', () => {
    const { a, b } = diverged();
    const onlyB = parsed(b).filter((r) => r.s === 'boxbbb01');
    const before = rows(a).length;

    const res = weaveLedgerRows(a, onlyB, { source: 'box-b', at: '2026-09-06T00:00:00.000Z' });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.woven, 2);
    assert.equal(res.skipped, 0);

    const v = verifyLedgerChain(a);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS: the verifier read rows');
    assert.equal(v.state, 'ok', 'the woven chain verifies');
    assert.equal(v.totals.broken, 0);
    assert.equal(rows(a).length, before + 2, 'nothing displaced, nothing dropped');

    const files = parsed(a).map((r) => r.f);
    for (const f of ['common-1.mjs', 'common-2.mjs', 'only-on-a.mjs', 'only-on-b-1.mjs', 'only-on-b-2.mjs']) {
      assert.ok(files.includes(f), `${f} survived the weave`);
    }
  });

  test('a woven row DECLARES itself and keeps the link it arrived with — a weave is never silent', () => {
    const { a, b } = diverged();
    const onlyB = parsed(b).filter((r) => r.s === 'boxbbb01');
    const arrivedWith = onlyB.map((r) => r.prev);
    weaveLedgerRows(a, onlyB, { source: 'box-b', at: '2026-09-06T00:00:00.000Z' });

    const woven = parsed(a).filter((r) => r.woven);
    assert.equal(woven.length, 2, 'both woven rows are marked as such');
    for (const r of woven) {
      assert.equal(r.woven.from, 'box-b', 'the copy it came from is named');
      assert.equal(r.woven.at, '2026-09-06T00:00:00.000Z', 'deterministic stamp, honoured from the caller');
      assert.ok(arrivedWith.includes(r.woven.was), 'the ORIGINAL prev is preserved, not overwritten');
      assert.notEqual(r.prev, r.woven.was, 'and the live link genuinely differs — this row was relinked');
    }
    // The payload is the thing that must not move.
    const bFiles = woven.map((r) => r.f).sort();
    assert.deepEqual(bFiles, ['only-on-b-1.mjs', 'only-on-b-2.mjs']);
  });

  test('THE POINT: tamper evidence survives the weave — editing a woven row still breaks the chain', () => {
    const { a, b } = diverged();
    weaveLedgerRows(a, parsed(b).filter((r) => r.s === 'boxbbb01'), { source: 'box-b' });
    assert.equal(verifyLedgerChain(a).state, 'ok', 'positive control: sound before the tamper');

    // Rewrite a woven row's payload in place, leaving its links alone — the edit a forger makes.
    const all = rows(a);
    const idx = all.findIndex((l) => l.includes('only-on-b-1.mjs'));
    assert.ok(idx >= 0 && idx < all.length - 1, 'the tampered row must have a successor to break');
    all[idx] = all[idx].replace('only-on-b-1.mjs', 'innocent.mjs');
    writeFileSync(a, all.join('\n') + '\n');

    const v = verifyLedgerChain(a);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'chain-broken', 'a woven row is no less tamper-evident than an appended one');
    assert.ok(v.breaks.some((brk) => brk.line === idx + 2),
      `the break lands at the tampered row's successor (line ${idx + 2}), got ${JSON.stringify(v.breaks.map((x) => x.line))}`);
  });

  test('weaving is idempotent — a second pass over the same rows adds nothing', () => {
    const { a, b } = diverged();
    const onlyB = parsed(b).filter((r) => r.s === 'boxbbb01');
    weaveLedgerRows(a, onlyB, { source: 'box-b' });
    const after1 = rows(a).length;

    const res = weaveLedgerRows(a, onlyB, { source: 'box-b' });
    assert.equal(res.woven, 0, 'nothing new to weave');
    assert.equal(res.skipped, 2, 'and it SAYS it skipped them rather than reporting success over a no-op');
    assert.equal(rows(a).length, after1, 'the file did not grow');
    assert.equal(verifyLedgerChain(a).state, 'ok');
  });

  test('identity ignores the link, so a row handed back under a different prev is not duplicated', () => {
    const { a, b } = diverged();
    const onlyB = parsed(b).filter((r) => r.s === 'boxbbb01');
    weaveLedgerRows(a, onlyB, { source: 'box-b' });
    // Same payloads, arriving with different links — as they would from a third copy.
    const relinked = onlyB.map((r) => ({ ...r, prev: lineHash('something else entirely') }));
    const res = weaveLedgerRows(a, relinked, { source: 'box-c' });
    assert.equal(res.woven, 0, 'the same record under a new link is still the same record');
    assert.equal(res.skipped, 2);
  });

  test('rows differing ONLY inside a nested object are DISTINCT — the replacer-array bug', () => {
    // Regression, measured 2026-09-06. Identity was `JSON.stringify(payload, keys.sort())`, and a
    // replacer ARRAY filters keys at every level: nested keys whose names did not also appear at the
    // top level vanished from the identity, so these two rows hashed alike and the second was
    // dropped as a duplicate. On the real liveness journal that skipped 48 rows an independent
    // payload comparison could see — a silent filter inside the function whose job is losing nothing.
    const l = join(scratch(), 'nested.jsonl');
    chainedAppend(l, { gate: 'liveness', at: 't0' });
    const a = { gate: 'liveness', at: 't1', measured: { source: 'artifact:/a', ok: true }, pulse: { state: 'fresh' } };
    const b = { gate: 'liveness', at: 't1', measured: { source: 'artifact:/b', ok: false }, pulse: { state: 'gap' } };
    const res = weaveLedgerRows(l, [a, b], { source: 'box-b' });
    assert.equal(res.woven, 2, 'both rows are kept — they differ, only not at the top level');
    assert.equal(res.skipped, 0);
    const v = verifyLedgerChain(l);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'ok');
    const sources = parsed(l).filter((r) => r.measured).map((r) => r.measured.source).sort();
    assert.deepEqual(sources, ['artifact:/a', 'artifact:/b'], 'the nested payloads survived intact');
  });

  test('array order inside a payload is part of its identity, not normalised away', () => {
    const l = join(scratch(), 'arr.jsonl');
    const res = weaveLedgerRows(l, [{ k: [1, 2] }, { k: [2, 1] }], { source: 's' });
    assert.equal(res.woven, 2, '[1,2] and [2,1] are different records');
  });

  test('a weave onto an absent ledger starts at genesis rather than dangling', () => {
    const { b } = diverged();
    const fresh = join(scratch(), 'fresh.jsonl');
    const res = weaveLedgerRows(fresh, parsed(b), { source: 'box-b' });
    assert.equal(res.ok, true, res.error);
    assert.equal(parsed(fresh)[0].prev, 'genesis');
    const v = verifyLedgerChain(fresh);
    assert.ok(v.totals.examined > 0, 'NOT VACUOUS');
    assert.equal(v.state, 'ok');
  });

  test('rows must be an array, and a refusal is reported rather than written', () => {
    const l = join(scratch(), 'x.jsonl');
    const res = weaveLedgerRows(l, null, { source: 's' });
    assert.equal(res.ok, false);
    assert.equal(res.mode, 'refused');
    assert.equal(weaveLedgerRows(l, [], { source: 's' }).mode, 'noop');
  });
});

describe('an unread ledger must never read as a clean one', () => {
  test('THE 2026-09-06 MISTAKE: an absent path reports examined=0 and state absent, not a pass', () => {
    const v = verifyLedgerChain(join(scratch(), 'does-not-exist.jsonl'));
    assert.equal(v.state, 'absent');
    assert.equal(v.totals.examined, 0,
      'examined is what separates "0 breaks in 19941 rows" from "0 breaks because I opened nothing"');
    assert.equal(v.breaks.length, 0, 'and breaks is ALSO 0 here — which is exactly why breaks alone cannot be the test');
  });

  test('a populated ledger reports a non-zero examined — the field is load-bearing, not decorative', () => {
    const l = join(scratch(), 'touches.jsonl');
    chainedAppend(l, { s: 'aaaa0001', f: 'x.mjs' });
    chainedAppend(l, { s: 'aaaa0001', f: 'y.mjs' });
    const v = verifyLedgerChain(l);
    assert.equal(v.totals.examined, 2);
    assert.equal(v.state, 'ok');
  });
});
