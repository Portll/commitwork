// The /daily digest: identity without lines, new/persisting/fixed/carried, data-path aggregation,
// secrets never read, renames carried, caps, batch completeness, and an end-to-end build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchIsComplete, buildDigest, fitDigest, groupFindings, itemId, kindOf, severityOf, digestIdOf } from '../daily.mjs';
import { validateDigest } from '../daily-validate.mjs';
import { AREA, REPO, dailyFixture, rows } from './lib/daily-fixture.mjs';

const build = (fx, extra = {}) => buildDigest({
  reportsRoot: fx.reports, areaOut: fx.areaOut, area: AREA, members: [REPO], config: fx.config, configSha256: 'a'.repeat(64),
  previousConfigSha: 'a'.repeat(64), now: new Date('2026-10-02T01:00:00Z'), guidanceFor: (lane) => `guidance for ${lane}`.replace('guidance for sast', 'fix the sink'), ...extra,
}).digest;
const item = (digest, rule) => digest.repos[0].items.find((i) => i.rule === rule);

test('identity excludes the line, so two lines of one rule in one file are one item', () => {
  const g = groupFindings({ scannerFindings: { sastSemgrep: [rows.exec, rows.execAgain] } }, REPO);
  assert.equal(g.size, 1);
  const [only] = g.values();
  assert.deepEqual(only.lines, [10, 14]);
  assert.equal(only.id, itemId(REPO, 'sastSemgrep', 'js.exec', 'src/app.js'));
});

test('severity comes from the row, else a category default, and the source is recorded', () => {
  assert.deepEqual(severityOf({ sev: 'crit' }, 'sastSemgrep'), { severity: 'critical', severitySource: 'row' });
  assert.deepEqual(severityOf({ sev: '' }, 'secrets'), { severity: 'high', severitySource: 'category-default' });
  assert.deepEqual(severityOf({}, 'sastCobol'), { severity: 'low', severitySource: 'category-default' });
  assert.equal(kindOf('cobolCoverage'), 'hygiene');
  assert.equal(kindOf('lintRust'), 'hygiene');
  assert.equal(kindOf('sastCodeql'), 'security');
});

test('a batch is complete only when it published, scanned every repo, and covers the members', () => {
  const manifest = { only: null, group: 'all', scope: { repos: [{ name: 'a' }, { name: 'b' }] } };
  const verdict = { rollup: 'published', repos: { resolved: 2, scanned: 2, scans: [{ ran: true }, { ran: true }] } };
  assert.equal(batchIsComplete({ manifest, verdict }, ['a', 'b']), true);
  assert.equal(batchIsComplete({ manifest: { ...manifest, only: 'a' }, verdict }, ['a']), false);
  assert.equal(batchIsComplete({ manifest, verdict: { ...verdict, rollup: 'lock-contention' } }, ['a']), false);
  assert.equal(batchIsComplete({ manifest, verdict: { ...verdict, repos: { ...verdict.repos, scanned: 1 } } }, ['a']), false);
  assert.equal(batchIsComplete({ manifest, verdict }, ['a', 'c']), false);
  assert.equal(batchIsComplete({ manifest: { ...manifest, group: 'deep' }, verdict }, ['a']), false, 'a deep sweep is not compared with a full one');
  assert.equal(batchIsComplete({ manifest, verdict: null }, ['a']), false);
});

test('new, persisting and fixed are decided against the previous complete batch', () => {
  const fx = dailyFixture({
    previousRows: { sastSemgrep: [rows.gone, rows.old] },
    currentRows: { sastSemgrep: [rows.exec, rows.execAgain, rows.renamed] },
  });
  const d = build(fx);
  assert.deepEqual(validateDigest(d), []);
  const r = d.repos[0];
  assert.equal(r.baseline, null);
  assert.equal(item(d, 'js.exec').state, 'new');
  assert.equal(item(d, 'js.exec').occurrences, 2);
  assert.match(item(d, 'js.exec').context.text, /exec\(userInput\)/);
  const weak = item(d, 'js.weak');
  assert.equal(weak.state, 'persisting', 'a renamed file carries its finding');
  assert.equal(weak.renamedFrom, 'src/old.js');
  assert.deepEqual(r.fixed.map((f) => f.rule), ['js.gone']);
  assert.deepEqual(r.carried, []);
  assert.equal(r.commitsSince.length, 1);
  assert.deepEqual(r.commitsSince[0].files.sort(), ['src/app.js', 'src/renamed.js']);
  assert.equal(d.guidance.sast, 'fix the sink', 'guidance is keyed by the lane the category maps to');
  assert.deepEqual(Object.keys(d.guidance), ['sast'], 'a lane with no item to act on carries no guidance');
  assert.equal(weak.firstSeenBatch, null, 'a persisting item the ledger does not know has no first-seen batch');
  assert.equal(item(d, 'js.exec').firstSeenBatch, 'sweep-20261002000000');
  const known = build(fx, { firstSeenOf: () => 'sweep-20260901000000' });
  assert.equal(known.repos[0].items.find((i) => i.rule === 'js.weak').firstSeenBatch, 'sweep-20260901000000');
  assert.equal(item(d, 'js.exec').lane, 'sast');
  assert.equal(d.gapDays, 1);
  assert.equal(digestIdOf(d), d.digestId);
});

test('a finding gone while its lane did not run, or after its tool changed, is carried, not fixed', () => {
  const notRun = build(dailyFixture({ previousRows: { sastSemgrep: [rows.gone] }, currentRows: { sastSemgrep: [] }, currentStatus: 'fail' }));
  assert.deepEqual(notRun.repos[0].fixed, []);
  assert.equal(notRun.repos[0].carried.length, 1);
  const retooled = build(dailyFixture({ previousRows: { sastSemgrep: [rows.gone] }, currentRows: { sastSemgrep: [] }, toolVersions: ['1.0', '2.0'] }));
  assert.deepEqual(retooled.repos[0].fixed, []);
  assert.equal(retooled.repos[0].carried.length, 1);
  assert.equal(retooled.repos[0].lanes.find((l) => l.lane === 'sast').toolChanged, true);
});

test('data-path findings are counted per rule; a new one is listed except at baseline', () => {
  const later = build(dailyFixture({ previousRows: { sastSemgrep: [] }, currentRows: { sastSemgrep: [rows.fixture] } }));
  assert.equal(item(later, 'js.eval').pathClass, 'data');
  assert.deepEqual(later.repos[0].aggregates.map((a) => [a.rule, a.count, a.new]), [['js.eval', 1, 1]]);
  const baseline = build(dailyFixture({ currentRows: { sastSemgrep: [rows.fixture, rows.exec] }, secondBatch: false }));
  assert.equal(baseline.repos[0].baseline, 'first-sweep');
  assert.equal(item(baseline, 'js.eval'), undefined);
  assert.equal(item(baseline, 'js.exec').state, 'new');
  assert.equal(item(baseline, 'js.exec').firstSeenBatch, null, 'at baseline nobody knows when it first appeared');
  assert.equal(baseline.previousBatch, null);
});

test('a secret finding never carries the file\'s text', () => {
  const d = build(dailyFixture({ previousRows: {}, currentRows: { secrets: [rows.secret] } }));
  const s = item(d, 'generic-api-key');
  assert.equal(s.context, null);
  assert.equal(s.severity, 'high');
  assert.doesNotMatch(JSON.stringify(d), /not-a-real-secret-value/);
});

test('a previous batch whose rollup is gone is a baseline named for it, not a first sweep', () => {
  const fx = dailyFixture({ previousRows: { sastSemgrep: [rows.exec] }, currentRows: { sastSemgrep: [rows.exec] } });
  rmSync(join(fx.areaOut, 'rollup-sweep-20261001000000.json'));
  assert.equal(build(fx).repos[0].baseline, 'previous-missing');
});

test('a changed config makes the comparison a baseline', () => {
  const d = build(dailyFixture({ previousRows: { sastSemgrep: [rows.exec] }, currentRows: { sastSemgrep: [rows.exec] } }), { previousConfigSha: 'b'.repeat(64) });
  assert.equal(d.repos[0].baseline, 'config-changed');
  assert.equal(item(d, 'js.exec').state, 'new');
});

test('the cap moves the lowest-ranked items to omittedIds, and the byte budget drops context first', () => {
  const fx = dailyFixture({ previousRows: {}, currentRows: { sastSemgrep: [rows.exec, rows.gone, rows.renamed] } });
  const d = build({ ...fx, config: { ...fx.config, maxItemsPerRepo: 1 } });
  assert.deepEqual(d.repos[0].items.map((i) => i.rule), ['js.exec']);
  assert.equal(d.repos[0].omittedIds.length, 2);
  const tight = build(fx);
  const withContext = Buffer.byteLength(JSON.stringify(tight));
  fitDigest(tight, withContext - 10);
  assert.ok(tight.repos[0].items.some((i) => i.context === null));
  assert.equal(tight.repos[0].items.length, 3, 'context goes before items do');
});

test('an anchor that is not a commit in the repository refuses the batch', () => {
  const fx = dailyFixture({ previousRows: {}, currentRows: {} });
  const manifest = join(fx.reports, `sweep-20261002000000-${AREA}`, 'batch-manifest.json');
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  m.anchors[REPO].sha = 'f'.repeat(40);
  writeFileSync(manifest, JSON.stringify(m));
  assert.throws(() => build(fx), /is not a commit/);
});

test('a batch named by the inflight marker is passed over', () => {
  const fx = dailyFixture({ previousRows: {}, currentRows: {} });
  assert.equal(build(fx, { inflight: 'sweep-20261002000000' }).batch, 'sweep-20261001000000');
});
