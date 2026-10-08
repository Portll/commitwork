// node --test cra/test/ — one clock vocabulary, asserted against what computeClocks actually emits.
//
// THE DIRECTION MATTERS. This walks real `watch.mjs` output and checks the spec covers it. Writing
// it the other way — spec against itself, or a schema authored FROM the spec — would let a wrong
// spec certify its own blind spot: both sides would agree, and the clock computeClocks emits under
// a key nobody listed would still render nowhere, page nowhere and never flag overdue.
// Source: evaluations/REMEDIATION-schema-derivation-2026-08-22.md R3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const NOW = '2026-07-20T00:00:00.000Z';

const { CLOCK_SPEC, clockSpecFor } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);

// Non-clock keys computeClocks returns: prose and provenance, deliberately not deadlines.
const NON_CLOCK = new Set(['track', 'regime', 'basis', 'basisAt', 'finalBasis', 'remediateBasis']);

function runWatch(extraEnv = {}) {
  const T = mkdtempSync(join(tmpdir(), 'clockspec-'));
  cpSync(join(REPO, 'cra', 'controls.json'), join(T, 'cra', 'controls.json'), { recursive: false, force: true, errorOnExist: false, mode: 0 })
    ; // best effort; watch does not need it
  const env = {
    ...process.env,
    CW_CRA_ROOT: T, CW_ROLLUP: join(FIX, 'rollup.json'), CW_KEV: join(FIX, 'kev.json'),
    CW_EPSS: join(FIX, 'epss.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_LEDGER: join(FIX, 'ledger.json'), CW_ANNOTATIONS: join(FIX, 'annotations.json'),
    CW_CASES: join(T, 'cases.json'), CW_CRA_OUT: join(T, 'out'), CW_CRA_NOW: NOW,
    CW_ESCALATE: '0', ...extraEnv,
  };
  execFileSync('node', [join(REPO, 'cra', 'watch.mjs')], { env, encoding: 'utf8' });
  const doc = JSON.parse(execFileSync('node', [join(REPO, 'cra', 'watch.mjs'), 'list', '--json'], { env, encoding: 'utf8' }));
  rmSync(T, { recursive: true, force: true });
  return doc;
}

test('every clock key computeClocks emits is declared in CLOCK_SPEC for that track', () => {
  const doc = runWatch();
  const cases = [...(doc.open || []), ...(doc.bestpractice || []), ...(doc.internal || [])];
  assert.ok(cases.length >= 2, 'a vacuous pass would prove nothing');

  let checked = 0;
  for (const k of cases) {
    const declared = new Set(clockSpecFor(k.clocks.track).map((c) => c.key));
    for (const key of Object.keys(k.clocks)) {
      if (NON_CLOCK.has(key)) continue;
      checked++;
      assert.ok(declared.has(key),
        `${k.caseId} (track ${k.clocks.track}) emits clock "${key}", which CLOCK_SPEC does not declare — `
        + 'it would render nowhere, page nowhere, and never flag overdue');
    }
  }
  assert.ok(checked >= 5, 'expected several clocks across the tracks');
});

test('the spec declares no clock computeClocks never emits', () => {
  const doc = runWatch();
  const seen = { article14: new Set(), bestpractice: new Set(), internal: new Set() };
  for (const k of [...(doc.open || []), ...(doc.bestpractice || []), ...(doc.internal || [])]) {
    for (const key of Object.keys(k.clocks)) if (!NON_CLOCK.has(key)) seen[k.clocks.track]?.add(key);
  }
  // article14 and bestpractice run the same timeline, so either populating a key vindicates it.
  const reportable = new Set([...seen.article14, ...seen.bestpractice]);
  for (const c of CLOCK_SPEC.article14) {
    assert.ok(reportable.has(c.key), `CLOCK_SPEC declares "${c.key}" but no reportable case emits it`);
  }
  for (const c of CLOCK_SPEC.internal) {
    assert.ok(seen.internal.has(c.key), `CLOCK_SPEC declares internal "${c.key}" but no internal case emits it`);
  }
});

test('bestpractice shares the ARRAY with article14 — they cannot drift apart', () => {
  assert.equal(clockSpecFor('bestpractice'), CLOCK_SPEC.article14, 'same reference, not a copy');
  assert.equal(clockSpecFor('unknown'), CLOCK_SPEC.article14, 'a pre-split case was written with Art. 14 keys');
  assert.notEqual(clockSpecFor('internal'), CLOCK_SPEC.article14);
});

test('escalation ids are LEDGER IDENTITY and are pinned', () => {
  // The de-dup key of a chain-covered `paged` event is {caseId, clock, due}. Renaming one of these
  // re-arms every page ever sent, so they are pinned literally rather than derived.
  assert.deepEqual(CLOCK_SPEC.article14.map((c) => c.escalationId),
    ['early-warning-24h', 'notification-72h', 'final-report']);
  assert.deepEqual(CLOCK_SPEC.internal.map((c) => c.escalationId),
    ['internal-triage', 'internal-remediate']);
});

test('no consumer re-lists a clock key outside the spec', async () => {
  const { readFileSync } = await import('node:fs');
  const keys = [...CLOCK_SPEC.article14, ...CLOCK_SPEC.internal].map((c) => c.key);
  assert.ok(keys.length > 0, 'CLOCK_SPEC declares no clock keys — the hard-coding check below would pass having searched for nothing');
  // computeClocks BUILDS them, and lib.mjs DECLARES them; everyone else must import.
  for (const rel of ['cra/escalate.mjs', 'admin/routes/cra.mjs']) {
    const src = readFileSync(join(REPO, rel), 'utf8');
    for (const k of keys) {
      assert.ok(!src.includes(k), `${rel} hard-codes clock key "${k}" — import it from CLOCK_SPEC instead`);
    }
  }
});
