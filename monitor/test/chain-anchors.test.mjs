// history-chain.mjs — the two checks the chain did not have until 2026-09-02.
//
// DRIFT. verifyChain compared STAMPS only: an index row was `unrecorded` if the chain had no event
// for it, and nothing else. So a slice rewritten together with its index hash — consistently, the
// way a scrub or a backfill does it — left verified:true and unrecorded:[]. The chain's own hashes
// were intact; the store had simply moved out from under them. `drifted` names those rows.
//
// ANCHORS. The chain lives beside the bytes it attests and is written by the same uid, so a rewrite
// from genesis verifies perfectly (done on purpose the same day, with a note). The tip is copied to
// the sidecar store after each append; the verifier checks the newest anchor is a hash IN the chain
// and that the chain is at least as long. `anchored:true` is consistency with the LOCAL anchor —
// the tests below pin that it never upgrades `verified`, and that absence is named, not passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENESIS, chainOf, appendChainEvent, verifyChain, appendAnchor, readAnchors, chainPath, anchorableOut, canon } from '../history-chain.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-anchor-'));
const H = (c) => c.repeat(64);
const ev = (stamp, over = {}) => ({ at: '2026-09-02T10:00:00.000Z', op: 'slice', stamp, sliceId: `sweep-${stamp}`, source: `sweep-${stamp}`, sliceSha256: H('a'), ...over });
const AREA = 'fixarea';

// ── drift ──────────────────────────────────────────────────────────────────────────────────────
test('the harness is live: a matching index verifies with drifted empty', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000'));
  const v = verifyChain(d, [{ stamp: '20260902100000', sliceSha256: H('a') }]);
  assert.deepEqual([v.verified, v.unrecorded.length, v.drifted.length], [true, 0, 0]);
  rmSync(d, { recursive: true, force: true });
});

test('DRIFT: an index row whose hash is not what the chain last recorded is named, and verified goes false', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000'));
  // the store was rewritten consistently: slice bytes changed AND the index row's hash updated
  const v = verifyChain(d, [{ stamp: '20260902100000', sliceSha256: H('b') }]);
  assert.equal(v.brokenAt, null, 'the chain itself is intact — that is exactly why this used to pass');
  assert.equal(v.unrecorded.length, 0, 'the stamp IS recorded — drift is not absence');
  assert.deepEqual(v.drifted, [{ stamp: '20260902100000', index: H('b'), chain: H('a') }]);
  assert.equal(v.verified, false);
  rmSync(d, { recursive: true, force: true });
});

test('drift is judged against the LAST event for a stamp — a recorded replace supersedes the original', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000'));
  appendChainEvent(d, ev('20260902100000', { op: 'replace', sliceSha256: H('b') })); // the rewrite went THROUGH the log
  const v = verifyChain(d, [{ stamp: '20260902100000', sliceSha256: H('b') }]);
  assert.deepEqual([v.verified, v.drifted.length], [true, 0]);
  rmSync(d, { recursive: true, force: true });
});

test('a row or event with no hash cannot drift — absence of a hash is not a mismatch', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000', { sliceSha256: null }));
  appendChainEvent(d, ev('20260902110000'));
  const v = verifyChain(d, [{ stamp: '20260902100000', sliceSha256: H('c') }, { stamp: '20260902110000' }]);
  assert.deepEqual([v.verified, v.drifted.length], [true, 0]);
  rmSync(d, { recursive: true, force: true });
});

// ── anchors ────────────────────────────────────────────────────────────────────────────────────
function anchored() {
  const d = dir();
  const store = join(d, 'store'); mkdirSync(store);
  const file = join(store, 'chain-tips.jsonl');
  appendChainEvent(d, ev('20260902100000'));
  appendChainEvent(d, ev('20260902110000'));
  const a = appendAnchor(d, AREA, '2026-09-02T11:00:00.000Z', file);
  return { d, file, a, idx: [{ stamp: '20260902100000', sliceSha256: H('a') }, { stamp: '20260902110000', sliceSha256: H('a') }] };
}

test('appendAnchor copies the current tip and length; readAnchors returns it by area', () => {
  const { d, file, a } = anchored();
  const last = readFileSync(chainPath(d), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.deepEqual([a.area, a.length, a.tip], [AREA, 2, last.chain]);
  assert.deepEqual(readAnchors(AREA, file).anchors.map((x) => x.tip), [last.chain]);
  assert.deepEqual(readAnchors('other-area', file).anchors, []);
  rmSync(d, { recursive: true, force: true });
});

test('a chain consistent with its anchor is anchored — and the wording claims only local consistency', () => {
  const { d, file, idx } = anchored();
  const v = verifyChain(d, idx, { area: AREA, anchorsFile: file });
  assert.deepEqual([v.verified, v.anchored, v.anchorMissing, v.anchorShrunk], [true, true, false, false]);
  assert.match(v.anchorWhy, /local anchor/);
  assert.doesNotMatch(v.anchorWhy, /tamper/);
  rmSync(d, { recursive: true, force: true });
});

test('REWRITE FROM GENESIS: every hash changes, the chain still self-verifies, and the anchor names it', () => {
  const { d, file, idx } = anchored();
  // re-chain with one field altered — the same act as a scrub re-seal, without the log's consent
  const events = readFileSync(chainPath(d), 'utf8').trim().split('\n').map(JSON.parse);
  let prev = GENESIS;
  const forged = events.map((e) => { const f = { ...e, source: `${e.source}-moved` }; f.prev = prev; f.chain = chainOf(prev, f); prev = f.chain; return f; });
  writeFileSync(chainPath(d), forged.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const v = verifyChain(d, idx, { area: AREA, anchorsFile: file });
  assert.equal(v.brokenAt, null, 'self-consistent — this is the case a chain alone cannot see');
  assert.deepEqual([v.anchored, v.anchorMissing], [false, true]);
  assert.match(v.anchorWhy, /rewritten or replaced/);
  rmSync(d, { recursive: true, force: true });
});

test('TRUNCATION below the anchored length is named as shrunk', () => {
  const { d, file, idx } = anchored();
  const events = readFileSync(chainPath(d), 'utf8').trim().split('\n');
  writeFileSync(chainPath(d), events.slice(0, 1).join('\n') + '\n'); // drop the newest line
  const v = verifyChain(d, idx.slice(0, 1), { area: AREA, anchorsFile: file });
  assert.deepEqual([v.anchored, v.anchorMissing, v.anchorShrunk], [false, true, true]);
  rmSync(d, { recursive: true, force: true });
});

test('NO ANCHOR is anchored:false with the reason named — and verified is untouched by its absence', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000'));
  const idx = [{ stamp: '20260902100000', sliceSha256: H('a') }];
  const none = verifyChain(d, idx, { area: AREA, anchorsFile: join(d, 'no-such-store', 'tips.jsonl') });
  assert.deepEqual([none.verified, none.anchored, none.anchorMissing], [true, false, false]);
  assert.match(none.anchorWhy, /absent/);
  const unnamed = verifyChain(d, idx);
  assert.deepEqual([unnamed.verified, unnamed.anchored], [true, false]);
  assert.match(unnamed.anchorWhy, /no area named/);
  rmSync(d, { recursive: true, force: true });
});

test('appendAnchor refuses to CREATE the store directory — a symlink replaced by a real dir is the sidecar trap', () => {
  const d = dir();
  appendChainEvent(d, ev('20260902100000'));
  assert.throws(() => appendAnchor(d, AREA, '2026-09-02T10:00:00.000Z', join(d, 'missing-store', 'tips.jsonl')), /absent — not creating/);
  rmSync(d, { recursive: true, force: true });
});

test('a torn last anchor line is reported and the intact prefix still anchors', () => {
  const { d, file, idx } = anchored();
  appendFileSync(file, '{"at":"2026-09-02T12:00:00.000Z","area":"fixarea","len');
  const r = readAnchors(AREA, file);
  assert.deepEqual([r.tailTorn, r.anchors.length], [true, 1]);
  const v = verifyChain(d, idx, { area: AREA, anchorsFile: file });
  assert.equal(v.anchored, true);
  assert.match(v.anchorWhy, /torn/);
  rmSync(d, { recursive: true, force: true });
});

// ── who may write the DEFAULT store ────────────────────────────────────────────────────────────
// Two leaks, two refusals: 360 anchors from scratch OUT dirs (2026-09-02), then 642 from tests
// whose fixture registry's own reportsRoot contained their OUT (2026-09-03). Registry is compared
// by PATH: exporting CW_REGISTRY at the real file is the default registry and must still anchor.
test('anchorableOut: the four env/OUT combinations, and the real-registry-by-env case', () => {
  const root = join(tmpdir(), 'cw-anchor-root'); const reg = { reportsRoot: root };
  const inside = join(root, 'some-area'), outside = join(tmpdir(), 'elsewhere', 'out');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.equal(anchorableOut(inside, reg, {}).anchorable, true, 'inside the default root, no env');
  assert.equal(anchorableOut(outside, reg, {}).anchorable, false, 'outside the root');
  assert.match(anchorableOut(outside, reg, {}).why, /outside the reports root/);
  assert.equal(anchorableOut(outside, reg, { CW_CHAIN_ANCHORS: '/tmp/x.jsonl' }).anchorable, true, 'a named store is always writable');
  const fx = anchorableOut(inside, reg, { CW_REGISTRY: join(tmpdir(), 'fixture-projects.json') });
  assert.equal(fx.anchorable, false, 'a FIXTURE registry whose root contains OUT must still refuse — this was the 642-line leak');
  assert.match(fx.why, /fixture registry/);
  // the real registry has three possible homes, all under <repo>/monitor/ — every one keeps anchoring
  for (const real of ['projects.json', 'private/projects.json', 'projects.example.json']) {
    assert.equal(anchorableOut(inside, reg, { CW_REGISTRY: join(CW, 'monitor', real) }).anchorable, true, `CW_REGISTRY=monitor/${real} is the repo's own registry`);
  }
  assert.equal(anchorableOut(inside, reg, { CW_REGISTRY: join(CW, 'monitor-fixtures', 'projects.json') }).anchorable, false, 'a sibling dir that merely starts with "monitor" is not monitor/');
  assert.equal(anchorableOut(undefined, reg, {}).anchorable, false, 'no OUT is not inside anything');
});

// ── chainVersion 2: the whole line is hashed, chosen per line ──────────────────────────────────
// Before: six fields. `note`, `resealedAt`, `preScrubMismatch` were editable without breaking a
// hash — the re-seal of 2026-09-02 wrote its disclosure into exactly those. No re-seal to adopt
// v2: old lines verify under the old body, new lines under the new, and the version field itself
// is bound, so changing it after the fact breaks the line either way.
const v1Line = (dirPath, stamp, prev) => {
  const e = ev(stamp); const line = { ...e, note: 'an old note', prev, chain: chainOf(prev, e) };
  appendFileSync(chainPath(dirPath), JSON.stringify(line) + '\n');
  return line;
};

test('new lines carry chainVersion 2 and their note is BOUND — editing it breaks the line', () => {
  const d = dir();
  appendChainEvent(d, ev('20260906100000', { note: 'sealed after a scrub' }));
  const p = chainPath(d);
  const line = JSON.parse(readFileSync(p, 'utf8').trim());
  assert.equal(line.chainVersion, 2);
  assert.equal(verifyChain(d, []).verified, true);
  line.note = 'sealed after nothing at all';
  writeFileSync(p, JSON.stringify(line) + '\n');
  const v = verifyChain(d, []);
  assert.deepEqual([v.verified, v.brokenAt && v.brokenAt.line], [false, 1], 'a note edit on a v2 line is named');
  rmSync(d, { recursive: true, force: true });
});

test('v1 lines still verify unchanged, and the verdict says how many are unprotected and where protection starts', () => {
  const d = dir();
  const a = v1Line(d, '20260901000000', GENESIS);
  const b = v1Line(d, '20260901010000', a.chain);
  appendChainEvent(d, ev('20260906100000', { note: 'first v2 line' }));
  const v = verifyChain(d, []);
  assert.deepEqual([v.verified, v.length, v.v1Lines, v.protectedFrom], [true, 3, 2, 3], JSON.stringify(v));
  // the old gap, still open on OLD lines by design and by disclosure: a v1 note edit is invisible
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n').map(JSON.parse);
  lines[1].note = 'edited history'; writeFileSync(chainPath(d), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(verifyChain(d, []).verified, true, 'a v1 line does not bind its note — that is what v1Lines reports');
  assert.equal(b.chain, lines[1].chain);
  rmSync(d, { recursive: true, force: true });
});

test('the version field is bound both ways: stripping it from a v2 line, or adding it to a v1 line, breaks the line', () => {
  const d = dir();
  v1Line(d, '20260901000000', GENESIS);
  appendChainEvent(d, ev('20260906100000'));
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n').map(JSON.parse);
  const upgraded = [{ ...lines[0], chainVersion: 2 }, lines[1]];
  writeFileSync(chainPath(d), upgraded.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(verifyChain(d, []).brokenAt.line, 1, 'a v1 line dressed as v2 recomputes under the wrong body');
  const downgraded = [lines[0], (({ chainVersion, ...rest }) => rest)(lines[1])];
  writeFileSync(chainPath(d), downgraded.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(verifyChain(d, []).brokenAt.line, 2, 'a v2 line stripped to v1 recomputes under the wrong body');
  rmSync(d, { recursive: true, force: true });
});

test('canon REFUSES a value it cannot represent, rather than hashing two of them the same', () => {
  // Measured 2026-09-06 on the first cut: every Date canoned to '{}', so two events an hour apart
  // hashed identically — a silent collision inside a hash function. A throw at the call site is the
  // only safe answer; a chain line read back from JSON can only hold JSON types anyway.
  assert.throws(() => canon(new Date(0)), /Date/);
  assert.throws(() => canon({ at: new Date(0) }), /Date/);
  assert.throws(() => canon({ n: NaN }), /non-finite/);
  assert.throws(() => canon({ n: Infinity }), /non-finite/);
  assert.throws(() => canon({ f: () => {} }), /function/);
  assert.throws(() => canon({ m: new Map() }), /Map/);
  // and the JSON types it must accept, including null and nesting
  assert.equal(canon({ b: true, n: 1, s: 'x', z: null, a: [1, 'two', null], o: { k: 'v' } }),
    '{"a":[1,"two",null],"b":true,"n":1,"o":{"k":"v"},"s":"x","z":null}');
});

test('canonical body: key order and undefined never change the hash; a nested object edit does', () => {
  const a = { at: '1', op: 'slice', stamp: '2', sliceId: 's', source: 'x', sliceSha256: 'h', chainVersion: 2, extra: { z: 1, y: [1, 2] } };
  const b = { extra: { y: [1, 2], z: 1 }, chainVersion: 2, sliceSha256: 'h', source: 'x', sliceId: 's', stamp: '2', op: 'slice', at: '1', gone: undefined };
  assert.equal(chainOf(GENESIS, a), chainOf(GENESIS, b));
  assert.notEqual(chainOf(GENESIS, a), chainOf(GENESIS, { ...a, extra: { z: 1, y: [2, 1] } }));
});

test('anchoring never upgrades a broken chain', () => {
  const { d, file, idx } = anchored();
  const lines = readFileSync(chainPath(d), 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]); first.stamp = '20260901000000';
  writeFileSync(chainPath(d), [JSON.stringify(first), lines[1]].join('\n') + '\n');
  const v = verifyChain(d, idx, { area: AREA, anchorsFile: file });
  assert.notEqual(v.brokenAt, null);
  assert.equal(v.verified, false);
  rmSync(d, { recursive: true, force: true });
});
