// bin/test/deps-history.test.mjs — the update-lifecycle history: when each release was found and
// applied, and the page that draws it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory, renderHistoryHtml, median } from '../lib/deps-history.mjs';

const DAY = 86_400_000;
const T0 = Date.parse('2026-08-01T00:00:00Z');
const at = (d) => new Date(T0 + d * DAY).toISOString();
const dep = (name, locked, updates = [], held = []) => ({ name, kind: 'dependencies', locked, skipped: null, updates, held });
const u = (type, version, pub) => ({ type, version, publishedAt: at(pub) });
const audit = (repo, d, deps) => ({ v: 1, at: at(d), event: 'audit', repo, pkgPath: '.', commit: null, deps, advisories: { counts: {}, prod: {}, rows: [] } });

function events() {
  return [
    // a 1.0.1 already out when watching began: backlog, not a late find
    audit('/r/one', 0, [dep('a', '1.0.0', [u('patch', '1.0.1', -30)])]),
    // 1.0.2 published day 2, held on day 5, eligible on day 12
    audit('/r/one', 5, [dep('a', '1.0.0', [u('patch', '1.0.1', -30)], [u('patch', '1.0.2', 2)])]),
    audit('/r/one', 12, [dep('a', '1.0.0', [u('patch', '1.0.2', 2)])]),
    { v: 1, at: at(13), event: 'proposed', repo: '/r/one', pkgPath: '.', proposal: 'p1', changes: [{ name: 'a', path: 'node_modules/a', from: '1.0.0', to: '1.0.2', step: 'direct' }] },
    { v: 1, at: at(14), event: 'merged', repo: '/r/one', pkgPath: '.', proposal: 'p1' },
    audit('/r/one', 19, [dep('a', '1.0.2')]),
    // another project, applied by hand and seen by a later audit; its proposal id collides with /r/one's
    audit('/r/two', 0, [dep('b', '2.0.0')]),
    audit('/r/two', 10, [dep('b', '2.0.0', [u('minor', '2.1.0', 1)])]),
    { v: 1, at: at(11), event: 'proposed', repo: '/r/two', pkgPath: '.', proposal: 'p1', changes: [{ name: 'zzz', path: 'node_modules/zzz', from: '1', to: '2', step: 'direct' }] },
    audit('/r/two', 20, [dep('b', '2.1.0')]),
    // and one still open
    audit('/r/two', 30, [dep('b', '2.1.0', [u('patch', '2.1.1', 15)])]),
  ];
}

test('each release is timed from its publication to found, proposed and applied, by merge or by observation', () => {
  const h = buildHistory(events(), { nowMs: T0 + 40 * DAY, within: [14, 30] });
  const one = h.projects.find((p) => p.label === 'one');
  const r102 = one.lifecycle.find((r) => r.version === '1.0.2');
  assert.equal(r102.foundAt, at(5));
  assert.equal(r102.eligibleAt, at(12));
  assert.equal(r102.proposedAt, at(13));
  assert.equal(r102.appliedAt, at(14));
  assert.equal(r102.appliedBy, 'merge');
  assert.equal(r102.foundLagDays, 3);
  assert.equal(r102.applyLagDays, 12);
  const r101 = one.lifecycle.find((r) => r.version === '1.0.1');
  assert.equal(r101.preexisting, true, 'out before the first audit');
  assert.equal(r101.foundLagDays, null);
  const two = h.projects.find((p) => p.label === 'two');
  const r210 = two.lifecycle.find((r) => r.version === '2.1.0');
  assert.equal(r210.appliedBy, 'observed', 'the colliding proposal id from /r/one is not this project\'s');
  assert.equal(r210.appliedAt, at(20));
  assert.equal(two.lifecycle.find((r) => r.version === '2.1.1').openDays, 25);
});

test('the headline keeps the inherited backlog out of every lag, and counts a window only over releases old enough for it', () => {
  const h = buildHistory(events(), { nowMs: T0 + 40 * DAY, within: [14, 30] });
  const hl = h.headline;
  assert.deepEqual(hl.backlog, { releases: 1, applied: 1, open: 0 });
  assert.equal(hl.releases, 3);
  assert.equal(hl.medianApplyDays, median([12, 19]));
  assert.equal(hl.byMerge, 1);
  assert.equal(hl.byObserved, 1);
  assert.deepEqual(hl.patchWithin[14], { applied: 1, of: 2 }, '2.1.1 is 25 days old and unapplied; 1.0.2 took 12');
  assert.deepEqual(hl.patchWithin[30], { applied: 1, of: 1 }, 'only 1.0.2 is 30 days old, and its 12 days to apply is within; 2.1.1 is too young to count');
  assert.equal(hl.open, 1);
  assert.equal(hl.oldestOpen.version, '2.1.1');
});

test('the fleet series steps each project\'s latest audit forward', () => {
  const h = buildHistory(events(), { nowMs: T0 + 40 * DAY });
  const at12 = h.fleetSeries.find((s) => s.at === at(12));
  assert.deepEqual({ patch: at12.patch, minor: at12.minor, projects: at12.projects }, { patch: 1, minor: 1, projects: 2 }, '/r/two\'s day-10 audit still stands on day 12');
});

test('the page is self-contained, escapes what the registry named, and keeps the data out of the script context', () => {
  const ev = events();
  ev[2].deps[0].name = '<img src=x onerror=alert(1)>';
  ev.push(audit('/r/</script><b>', 1, [dep('c', '1.0.0', [u('patch', '1.0.1', 0)])]));
  const html = renderHistoryHtml(buildHistory(ev, { nowMs: T0 + 40 * DAY, within: [14, 30] }), { cooldown: 7 });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const data = html.slice(html.indexOf('id="cw-data">'), html.indexOf('</script>', html.indexOf('id="cw-data">')));
  assert.doesNotMatch(data.slice(13), /<\/script|<b>/i, 'a project path cannot close the JSON script block');
  assert.doesNotMatch(html, /\bsrc="https?:|<link[^>]+href="https?:/, 'no remote assets');
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
  assert.match(html, /Patch releases applied within 14 days/);
  assert.match(html, /Backlog at the first audit/);
});

test('an empty ledger renders the page with every list saying it is empty', () => {
  const html = renderHistoryHtml(buildHistory([], { nowMs: T0 }), { cooldown: 7 });
  assert.match(html, /No audit recorded\./);
  assert.match(html, /No release found yet\./);
  assert.match(html, /Two audits or more are needed/);
});
