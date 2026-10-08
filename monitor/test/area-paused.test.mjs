// A paused area is declared OUT of every automatic sweep. The failure this guards is not "it got
// swept anyway" — it is the quieter one: a paused area that reads FRESH (nothing scanned it, so
// there is nothing to be fresh about) or reads EXPIRED forever (a red nobody can clear, which is
// how a whole signal gets ignored — install-agents.mjs states that hazard for cadenceMs).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fleetAreaSlugs, pausedAreas, resolveExcludedAreas } from '../sweep-scope.mjs';
import { classifyFreshness, freshnessSummary, DAY_MS } from '../freshness.mjs';
import { validateRegistry, loadRegistry, isExampleRegistry, registryPath } from '../registry.mjs';

// A checkout without the private registry loads the example one; the live blocks then skip and say so.
const LIVE_SKIP = isExampleRegistry(registryPath()) ? `private registry absent: ${registryPath()} is the example registry, so the live pause is not measured` : false;

const reg = (areas) => ({ areas });
const PAUSE = { since: '2026-08-26', reason: 'measured 10h+ run' };

describe('a paused area leaves the fan-out', () => {
  test('fleetAreaSlugs drops it, and keeps everything else', () => {
    const r = reg([{ slug: 'a' }, { slug: 'b', paused: PAUSE }, { slug: 'c' }]);
    assert.deepEqual(fleetAreaSlugs(r), ['a', 'c']);
  });

  test('pausedAreas reports it as data — a silent skip is the thing being avoided', () => {
    const r = reg([{ slug: 'a' }, { slug: 'b', paused: PAUSE }]);
    assert.deepEqual(pausedAreas(r), [{ slug: 'b', since: '2026-08-26', reason: 'measured 10h+ run' }]);
  });

  test('pause and --exclude compose; neither cancels the other', () => {
    const r = reg([{ slug: 'a' }, { slug: 'b', paused: PAUSE }, { slug: 'c' }]);
    const { areas } = resolveExcludedAreas(['c'], r);
    assert.deepEqual(fleetAreaSlugs(r, areas), ['a']);
  });

  test('no pause declared leaves the list untouched — non-vacuity for every case above', () => {
    const r = reg([{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]);
    assert.deepEqual(fleetAreaSlugs(r), ['a', 'b', 'c']);
    assert.deepEqual(pausedAreas(r), []);
  });
});

describe('a pause must state itself or it is an oversight', () => {
  const errs = (a) => validateRegistry(reg([a])).errors.filter((e) => /paused/.test(e));
  test('since and reason are both required', () => {
    assert.ok(errs({ slug: 'a', paused: {} }).length >= 2);
    assert.ok(errs({ slug: 'a', paused: { since: '2026-08-26' } }).length === 1, 'a reason is required');
    assert.ok(errs({ slug: 'a', paused: { reason: 'x' } }).length === 1, 'a date is required');
  });

  test('a bare boolean is refused — half a fact', () => {
    assert.ok(errs({ slug: 'a', paused: true }).length, 'paused:true says neither when nor why');
  });

  test('an empty reason is not a reason', () => {
    assert.ok(errs({ slug: 'a', paused: { since: '2026-08-26', reason: '   ' } }).length);
  });

  test('a malformed date is refused, and an unknown key with it', () => {
    assert.ok(errs({ slug: 'a', paused: { since: 'yesterday', reason: 'x' } }).length);
    assert.ok(errs({ slug: 'a', paused: { ...PAUSE, until: '2026-09-01' } }).length);
  });

  test('a well-formed pause raises nothing — or every case above proves only that it errors', () => {
    assert.deepEqual(errs({ slug: 'a', paused: PAUSE }), []);
  });
});

describe('paused is its own freshness state — never fresh, never a permanent red', () => {
  const OLD = '2026-08-01T00:00:00.000Z';
  const NOW = Date.parse('2026-08-26T00:00:00.000Z');

  test('an area that would read EXPIRED reads PAUSED instead', () => {
    assert.equal(classifyFreshness(OLD, NOW, { cadenceMs: DAY_MS }).state, 'expired');
    assert.equal(classifyFreshness(OLD, NOW, { cadenceMs: DAY_MS, paused: true }).state, 'paused');
  });

  test('and one that would read FRESH does NOT — nothing scanned it', () => {
    const recent = new Date(NOW - 3.6e6).toISOString();
    assert.equal(classifyFreshness(recent, NOW, { cadenceMs: DAY_MS }).state, 'fresh');
    assert.equal(classifyFreshness(recent, NOW, { cadenceMs: DAY_MS, paused: true }).state, 'paused',
      'a paused area reading fresh is the explicit uncertainty rule broken by the pause itself');
  });

  test('the age still travels — how long it has been paused is the reader\'s question', () => {
    const f = classifyFreshness(OLD, NOW, { cadenceMs: DAY_MS, paused: true });
    assert.equal(f.ageHours, 600);
    assert.equal(f.generated, OLD, 'the evidence must not be erased by the state');
  });

  test('paused explains an unreadable timestamp rather than dressing it up', () => {
    assert.equal(classifyFreshness(null, NOW, { sliceId: 'not-a-slice' }).state, 'unknown');
    const f = classifyFreshness(null, NOW, { sliceId: 'not-a-slice', paused: true });
    assert.equal(f.state, 'paused');
    assert.equal(f.scanTime, null, 'the missing stamp must stay visible past the state');
  });

  test('the summary says PAUSED — it used to fall through to the EXPIRED sentence', () => {
    const s = freshnessSummary(classifyFreshness(OLD, NOW, { cadenceMs: DAY_MS, paused: true }));
    assert.match(s, /^PAUSED/);
    assert.doesNotMatch(s, /EXPIRED|fresh/, 'a reader acts on this sentence');
  });
});

// The fleet area is found by shape (several members, prefixes, an out dir distinct from its slug),
// never by name: the private registry keeps the real slug and the tracked tree the pseudonym, and the
// paused set has grown since this was pinned to one name (three areas paused on 2026-09-18).
test('the live registry: the fleet area is paused, and the one primary is not', { skip: LIVE_SKIP }, () => {
  // The pause is worthless if a bare `sweep.mjs` still resolves to the paused area.
  const live = loadRegistry();
  const fleet = (live.areas || []).filter((a) => (a.prefixes || []).length > 0 && (a.members || []).length > 1 && a.out && a.out !== a.slug);
  assert.equal(fleet.length, 1, `one fleet-shaped area expected, found ${fleet.map((a) => a.slug).join(', ') || 'none'}`);
  const paused = pausedAreas(live).map((p) => p.slug);
  assert.ok(paused.includes(fleet[0].slug), 'the fleet area is paused');
  const primary = live.areas.filter((a) => a.primary).map((a) => a.slug);
  assert.equal(primary.length, 1, 'exactly one primary area');
  assert.ok(!paused.includes(primary[0]), `primary area ${primary[0]} is paused — a bare sweep would target it`);
  for (const slug of paused) assert.ok(!fleetAreaSlugs(live).includes(slug), `paused area ${slug} still in the fan-out`);
});

test('every multi-member area rolls newest-full — a narrowed batch must not publish as the whole', { skip: LIVE_SKIP }, () => {
  // commitwork-admin published 1 of 5 repos this way on 2026-08-26; client-a published 1 of 34.
  const live = loadRegistry();
  const multi = live.areas.filter((a) => Array.isArray(a.members) && a.members.length > 1);
  assert.ok(multi.length >= 2, `only ${multi.length} multi-member areas — the subject is too small to prove anything`);
  const unguarded = multi.filter((a) => a.rollupBatch !== 'newest-full').map((a) => a.slug);
  assert.deepEqual(unguarded, [], 'a multi-member area on rollupBatch:newest can publish one repo as all of them');
});
