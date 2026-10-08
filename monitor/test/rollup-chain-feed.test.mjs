// rollup.mjs feeds the write log and records a batch by its KEY, not its path. Two properties, each
// measured absent on 2026-09-02: (1) every artifact carried the operator's home path as `source`
// (18,703 files); (2) the chain feed had been unwired on 2026-09-01 and every chained area's newest
// row was unrecorded.
//
// ── WHY THE BATCH IS A SHIPPED FIXTURE AND NOT A STORED SWEEP ───────────────────────────────────
// This used to roll whatever `reports/` happened to hold and guard-skip when it held nothing. Since
// `reports/` is gitignored, that meant all six assertions below skipped in every fresh clone, in CI
// and in the public snapshot — and on this host too, where the oldest stored batches have been
// pruned to manifests and roll to exit 4. A skip with a stated reason was the right posture and the
// wrong resting state: it is still a check nobody runs.
//
// Unlike rerollup-identical.test.mjs, this suite gains nothing from a rich batch. Every property
// here is rollup's own bookkeeping — source recorded by KEY, one index row per batch key, the chain
// event, the anchor — and is identical for any batch that rolls at all. So the batch is the shipped
// synthetic one, hermetically, and a batch that fails to roll is a FAILURE rather than a skip: the
// fixture is tracked, so no host condition can excuse it.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChain } from '../history-chain.mjs';
import { reportsRootDir, sourceKey } from '../area.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

let state = { batch: null, root: null, out: null, anchors: null, stamp: null };

// The synthetic batch that ships with the repository — tracked, so present in a public clone.
const FIXTURE_BATCH = join(HERE, 'fixtures', 'sweep-batch', 'sweep-20260101000000-fixture');

function roll() {
  try {
    execFileSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor/rollup.mjs'), state.batch],
      { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_MONITOR_OUT: state.out, CW_CHAIN_ANCHORS: state.anchors } });
    return { code: 0 };
  } catch (e) { return { code: e.status ?? -1, stderr: String(e.stderr || ''), stdout: String(e.stdout || '') }; }
}
const idx = () => JSON.parse(readFileSync(join(state.out, 'history', 'index.json'), 'utf8'));
const chain = () => readFileSync(join(state.out, 'history', 'chain.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

before(() => {
  const batch = FIXTURE_BATCH;
  // Not a skip, by design. See the header: the fixture ships with the repository.
  assert.ok(existsSync(join(batch, 'batch-manifest.json')),
    `the tracked fixture batch is missing at ${batch}; this is a broken checkout, not a host condition`);
  const root = mkdtempSync(join(tmpdir(), 'cw-chainfeed-'));
  mkdirSync(join(root, 'store'));
  state = { ...state, batch, root, out: join(root, 'out'), anchors: join(root, 'store', 'chain-tips.jsonl') };
  const r = roll();
  assert.equal(r.code, 0, `the shipped fixture batch ${basename(batch)} did not roll up (exit ${r.code}) — ${String(r.stderr || '').slice(-300)}`);
  state.stamp = String(idx().at(-1).stamp);
});

// THE KEY IS `sourceKey()`, NOT `basename()`. This read `basename(state.batch)` while the batch was
// always a child of the reports root, where the two agree. The fixture is not, and the three
// artifacts recorded `../monitor/test/fixtures/…/sweep-20260101000000-fixture` — which is what
// sourceKey() is specified to return for a batch outside the root, so nothing was broken: the
// expectation was a coincidence of one batch location being read as the contract. The defect this
// test exists to catch is an ABSOLUTE path (the operator's home) in a published artifact, and that
// is asserted below on its own, without reference to sourceKey — so a bug in sourceKey cannot make
// this test green by agreeing with itself.
test('every artifact records the batch by KEY — no artifact carries an absolute path or the reports root', () => {
  const key = sourceKey(state.batch);
  const row = idx().at(-1);
  const slice = JSON.parse(readFileSync(join(state.out, 'history', row.file), 'utf8'));
  const rollup = JSON.parse(readFileSync(join(state.out, 'rollup.json'), 'utf8'));
  const dash = readFileSync(join(state.out, 'dashboard.html'), 'utf8');
  assert.deepEqual([row.source, slice.source, rollup.source], [key, key, key]);
  assert.ok(dash.includes(`"${key}"`), 'the dashboard names the batch');
  for (const s of [row.source, slice.source, rollup.source]) {
    assert.equal(isAbsolute(s), false, `${s} is absolute — that is how 18,703 artifacts came to carry the operator's home path`);
    assert.equal(s.includes(reportsRootDir()), false, `${s} embeds the reports root`);
  }
  assert.equal(dash.includes(reportsRootDir()), false, 'and never the absolute root that held the operator\'s home path');
});

// The claim the assertion above used to make implicitly, stated directly and without a rollup: for a
// batch under the reports root the key IS the single path segment. Cheap, and it keeps the contract
// pinned now that the suite's own batch no longer lives there.
test('for a batch under the reports root, the key is its name and nothing else', () => {
  const name = 'sweep-20260101000000-keycheck';
  assert.equal(sourceKey(join(reportsRootDir(), name)), name);
  assert.equal(sourceKey(name), name, 'a bare name is already a key and must survive the round trip');
});

test('the write log is FED: the roll appended a slice event and anchored its tip', (t) => {
  const ev = chain();
  assert.equal(ev.at(-1).op, 'slice');
  assert.equal(String(ev.at(-1).stamp), state.stamp);
  const v = verifyChain(join(state.out, 'history'), idx(), { area: basename(state.out), anchorsFile: state.anchors });
  assert.deepEqual([v.verified, v.unrecorded.length, v.drifted.length, v.anchored], [true, 0, 0, true], JSON.stringify(v));
});

test('a re-roll of the same batch dedupes to ONE row, keeps its stamp, and is recorded as a replace', (t) => {
  const r = roll();
  assert.equal(r.code, 0, r.stderr);
  const rows = idx();
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].stamp), state.stamp, 'a fresh stamp would duplicate every ledger entry');
  assert.equal(chain().at(-1).op, 'replace');
});

test('MIGRATION: a row recorded ABSOLUTE (every row before 2026-09-02) still dedupes against the key', (t) => {
  const ip = join(state.out, 'history', 'index.json');
  const rows = idx();
  rows.at(-1).source = state.batch; // the pre-migration shape
  writeFileSync(ip, JSON.stringify(rows, null, 2));
  const r = roll();
  assert.equal(r.code, 0, r.stderr);
  const after = idx();
  assert.equal(after.length, 1, 'the absolute row was matched, not duplicated');
  assert.equal(String(after[0].stamp), state.stamp);
  assert.equal(after[0].source, sourceKey(state.batch), 'and the row now carries the key');
});

test('a SCRATCH rollup with no CW_CHAIN_ANCHORS never writes into the real sidecar store', (t) => {
  // Measured 2026-09-02: one `npm test` wrote 360 fixture anchors (ann-area, primary-area, a1…)
  // into .claude/store/chain-tips.jsonl, because every test that spawns rollup.mjs uses a scratch
  // CW_MONITOR_OUT and none of them named an anchor store. The default must not be reachable from
  // outside the reports root.
  const real = join(CW, '.claude', 'store', 'chain-tips.jsonl');
  const before = existsSync(real) ? readFileSync(real, 'utf8') : null;
  const env = { ...process.env, CW_MONITOR_OUT: state.out }; delete env.CW_CHAIN_ANCHORS;
  const r = (() => { try { return { code: 0, stdout: execFileSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor/rollup.mjs'), state.batch], { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }) }; } catch (e) { return { code: e.status ?? -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }; } })();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /chain extended, tip not anchored — OUT is outside the reports root/, 'the skip is said out loud, with its reason, not silent');
  const after = existsSync(real) ? readFileSync(real, 'utf8') : null;
  assert.equal(after, before, 'the real anchor store must be byte-identical before and after a scratch rollup');
  assert.equal(chain().at(-1).op, 'replace', 'the chain itself was still extended');
});

test('cleanup', () => { if (state.root) rmSync(state.root, { recursive: true, force: true }); });
