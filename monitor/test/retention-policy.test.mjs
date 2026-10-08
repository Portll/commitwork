// node --test monitor/test/ — per-area retention policy. This module decides what a DELETING tool
// is allowed to touch, so every case here is one where a wrong answer removes evidence: the axes
// must union rather than intersect, an unreadable age must protect rather than prune, and a
// per-area declaration must actually beat the global instead of being quietly ignored.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { batchStampMs, retentionFor, planProtection, DEFAULT_KEEP_FULL_SWEEPS } from '../retention.mjs';
import { validateRegistry } from '../registry.mjs';
import { registryPathFor } from '../store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read through the resolver compact-reports.mjs reads with. The literal monitor/projects.json this
// replaced is the pre-move path, which a checkout that still has one keeps as a stale copy nobody reads.
// A clean checkout has no private registry: only ENOENT, with no CW_REGISTRY naming it, skips.
const LIVE_PATH = registryPathFor(join(HERE, '..', '..'));
const LIVE = (() => {
  try { return JSON.parse(readFileSync(LIVE_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_REGISTRY) return null; throw e; }
})();
const NO_LIVE = LIVE ? undefined
  : `private registry absent: ${LIVE_PATH} does not exist, so the live retention declarations are not measured`;
const NOW = Date.UTC(2026, 7, 22, 0, 0, 0); // 2026-08-22
const day = 86400000;
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const batchAt = (daysAgo, area) => `sweep-${stampOf(NOW - daysAgo * day)}${area ? `-${area}` : ''}`;

describe('batch age comes from the name, not the filesystem', () => {
  test('the UTC stamp round-trips exactly, in both the bare and per-area forms', () => {
    assert.equal(batchStampMs('sweep-20260820120254'), Date.UTC(2026, 7, 20, 12, 2, 54));
    assert.equal(batchStampMs('sweep-20260820120254-100randomrepos'), Date.UTC(2026, 7, 20, 12, 2, 54));
    assert.equal(batchStampMs('sweep-20260820120254.'), Date.UTC(2026, 7, 20, 12, 2, 54));
  });

  test('a non-batch or rolled-over stamp is null, never a plausible-looking instant', () => {
    for (const n of ['sweep-latest.log', 'runtime-latest', 'guests-20260802', 'sweep-2026082012025', '']) {
      assert.equal(batchStampMs(n), null, `${n} must not parse as a batch stamp`);
    }
    // Date.UTC absorbs month 13 / day 99 silently; ageing a batch against an instant nobody
    // stamped is worse than refusing to age it.
    assert.equal(batchStampMs('sweep-20261399120254'), null);
    assert.equal(batchStampMs('sweep-20260232120254'), null);
  });
});

describe('policy resolution', () => {
  const reg = {
    retention: { keepFullSweeps: 1 },
    areas: [
      { slug: 'commitwork-admin', retention: { keepDays: 90 } },
      { slug: 'corpus', retention: { keepFullSweeps: 0 } },
      { slug: 'plain' },
    ],
  };

  test("an area's own declaration beats the global, and says so", () => {
    const cw = retentionFor('commitwork-admin', reg);
    assert.equal(cw.keepFullSweeps, 1);
    assert.equal(cw.keepDays, 90);
    assert.equal(cw.keepDaysFrom, "area 'commitwork-admin'");

    const corpus = retentionFor('corpus', reg);
    assert.equal(corpus.keepFullSweeps, 0, 'a per-area REDUCTION to 0 must be expressible');
    assert.equal(corpus.keepFrom, "area 'corpus'");
    assert.equal(corpus.keepDays, null, 'an area with no floor must not inherit another area\'s');
  });

  test('an undeclared area falls through to global, then to the built-in default', () => {
    assert.equal(retentionFor('plain', reg).keepFullSweeps, 1);
    assert.equal(retentionFor('plain', reg).keepFrom, 'global');
    assert.equal(retentionFor('plain', {}).keepFullSweeps, DEFAULT_KEEP_FULL_SWEEPS);
    assert.equal(retentionFor('no-such-area', reg).keepFullSweeps, 1);
  });

  test('a nonsense value is ignored rather than obeyed — no NaN floor, no negative quota', () => {
    const bad = { retention: { keepFullSweeps: 2 }, areas: [{ slug: 'a', retention: { keepFullSweeps: -1, keepDays: 0 } }] };
    assert.equal(retentionFor('a', bad).keepFullSweeps, 2);
    assert.equal(retentionFor('a', bad).keepDays, null);
  });
});

describe('what survives', () => {
  const reg = {
    retention: { keepFullSweeps: 1 },
    areas: [{ slug: 'cw', retention: { keepDays: 90 } }, { slug: 'corpus' }],
  };
  const batches = [
    { name: batchAt(200, 'cw'), area: 'cw' },
    { name: batchAt(100, 'cw'), area: 'cw' },
    { name: batchAt(30, 'cw'), area: 'cw' },
    { name: batchAt(1, 'cw'), area: 'cw' },
    { name: batchAt(200, 'corpus'), area: 'corpus' },
    { name: batchAt(1, 'corpus'), area: 'corpus' },
  ];

  test('the axes UNION — inside the floor survives even when it is not the newest', () => {
    const { protect } = planProtection(batches, { reg, now: NOW });
    assert.ok(protect.has(batchAt(30, 'cw')), '30d old is inside a 90d floor and must survive keepFullSweeps:1');
    assert.ok(protect.has(batchAt(1, 'cw')));
    assert.equal(protect.has(batchAt(200, 'cw')), false, '200d is outside the floor and not the newest');
    assert.equal(protect.has(batchAt(100, 'cw')), false);
  });

  test('the floor is scoped to its area and does not leak to the fleet', () => {
    const { protect } = planProtection(batches, { reg, now: NOW });
    assert.ok(protect.has(batchAt(1, 'corpus')), 'newest of an undeclared area is still kept');
    assert.equal(protect.has(batchAt(200, 'corpus')), false,
      'corpus declares no floor — giving it one would put the 13G back');
  });

  test('a batch whose age cannot be read is PROTECTED, not assumed old', () => {
    // explicit uncertainty, and here it is not red either: unknown age must not be spent as
    // permission to delete.
    const odd = [{ name: 'sweep-20261399120254-cw', area: 'cw' }, { name: batchAt(1, 'cw'), area: 'cw' }];
    const { protect, why } = planProtection(odd, { reg, now: NOW });
    assert.ok(protect.has('sweep-20261399120254-cw'));
    assert.match(why.get('sweep-20261399120254-cw'), /age unreadable/);

    // ...and it must not SPEND the quota slot. `sweep-20261399…` sorts after every real stamp, so
    // a name-ordered newest-N would hand it the only slot and leave the genuine newest batch
    // prunable — protected-and-displacing is a worse bug than unprotected.
    const noFloor = { retention: { keepFullSweeps: 1 }, areas: [{ slug: 'cw' }] };
    const { protect: p2, why: w2 } = planProtection(odd, { reg: noFloor, now: NOW });
    assert.ok(p2.has(batchAt(1, 'cw')), 'the real newest batch lost its quota slot to an undateable name');
    assert.match(w2.get(batchAt(1, 'cw')), /newest 1/);
  });

  test('an unscoped batch is its own bucket, not a free slot in a declared area', () => {
    const mixed = [{ name: batchAt(5), area: null }, { name: batchAt(200), area: undefined }];
    const { protect, byArea } = planProtection(mixed, { reg, now: NOW });
    assert.ok(byArea.has('(unscoped)'));
    assert.ok(protect.has(batchAt(5)), 'newest unscoped survives');
    assert.equal(protect.has(batchAt(200)), false, 'unscoped inherits no floor from cw');
  });

  test('keepFullSweeps:0 with no floor protects nothing — the reduction is real', () => {
    const r = { retention: { keepFullSweeps: 1 }, areas: [{ slug: 'corpus', retention: { keepFullSweeps: 0 } }] };
    const { protect } = planProtection([{ name: batchAt(1, 'corpus'), area: 'corpus' }], { reg: r, now: NOW });
    assert.equal(protect.size, 0);
  });

  test('CW_NOW drives the floor, so the same tree compacts identically anywhere', () => {
    const prev = process.env.CW_NOW;
    process.env.CW_NOW = '2026-08-22T00:00:00Z';
    try {
      const a = planProtection(batches, { reg });
      assert.deepEqual([...a.protect].sort(), [...planProtection(batches, { reg, now: NOW }).protect].sort());
    } finally {
      if (prev === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prev;
    }
  });
});

describe('the live registry', { skip: NO_LIVE }, () => {
  const reg = LIVE;

  test('validates with the new key — an unregistered area key would only warn', () => {
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings.filter((w) => /retention/.test(w)), []);
  });

  test('commitwork-admin carries the 90d floor the operator ruled', () => {
    const p = retentionFor('commitwork-admin', reg);
    assert.equal(p.keepDays, 90);
    assert.equal(p.keepDaysFrom, "area 'commitwork-admin'");
  });

  test('the corpus area has NOT been given a floor — that is where the 13G lives', () => {
    assert.equal(retentionFor('100randomrepos', reg).keepDays, null);
  });

  test('an unknown retention key is an ERROR, so a typo cannot silently restore the global', () => {
    const bent = structuredClone(reg);
    bent.areas.find((a) => a.slug === 'commitwork-admin').retention = { keepDay: 90 };
    assert.ok(validateRegistry(bent).errors.some((e) => /unknown retention key keepDay/.test(e)));
  });
});
