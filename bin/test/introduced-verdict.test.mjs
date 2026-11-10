// bin/test/introduced-verdict.test.mjs — the introduced-advisories verdict over two package-lock
// graphs, with an injected advisory lookup. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNpmGraph } from '../lib/npm-graph.mjs';
import { computeVerdict, lookupSet } from '../lib/introduced-verdict.mjs';
import { introducedVerdict } from '../lib/introduced-run.mjs';

const lock = (packages, rootDeps = {}, rootDev = {}) => JSON.stringify({ name: 'member-repo', lockfileVersion: 3,
  packages: { '': { name: 'member-repo', dependencies: rootDeps, devDependencies: rootDev }, ...packages } });
const adv = (id, severity, extra = {}) => ({ id, aliases: [], severity, severitySource: 'label', summary: `${id} summary`, url: null, ...extra });

/** A lookup from a fixed table of pairKey → advisories; a pair outside it has none. */
const table = (t, asked = []) => async (pairs) => new Map(pairs.map((p) => {
  const k = `${p.name}@${p.version}`;
  asked.push(k);
  return [k, t[k] instanceof Error ? { error: t[k].message } : { advisories: t[k] || [] }];
}));

async function verdict(beforeText, afterText, t, opts = {}) {
  const lookup = table(t, opts.asked);
  return introducedVerdict({ before: beforeText === null ? { absent: true } : { text: beforeText }, after: { text: afterText },
    lookupBefore: lookup, lookupAfter: lookup, source: 'injected', nowMs: Date.parse('2026-10-29T00:00:00Z'), ...opts });
}

const PARENT_V1 = lock({ 'node_modules/widget-x': { version: '1.0.0', dependencies: { 'child-y': '^1.0.0' } }, 'node_modules/child-y': { version: '1.0.0' } }, { 'widget-x': '^1.0.0' });
const PARENT_V2 = lock({ 'node_modules/widget-x': { version: '1.1.0', dependencies: { 'child-y': '^1.2.0' } }, 'node_modules/child-y': { version: '1.2.0' } }, { 'widget-x': '^1.1.0' });

test('a parent bump that pulls in a vulnerable transitive is caught, with the chain that brought it', async () => {
  const asked = [];
  const v = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-aaaa-bbbb-cccc', 'high')] }, { asked });
  assert.equal(v.state, 'introduces');
  assert.equal(v.introduced.length, 1);
  const [i] = v.introduced;
  assert.deepEqual([i.advisory, i.package, i.versions, i.severity, i.blocking, i.exposure, i.why], ['GHSA-aaaa-bbbb-cccc', 'child-y', ['1.2.0'], 'high', true, 'prod', 'new-advisory']);
  assert.deepEqual(i.paths, [['widget-x@1.1.0', 'child-y@1.2.0']]);
  assert.ok(asked.includes('child-y@1.2.0'), 'the transitive version was looked up, not only the package the update names');
});

test('an advisory present before and after the update is not introduced, at the same or a moved version', async () => {
  const same = await verdict(PARENT_V1, lock({ 'node_modules/widget-x': { version: '1.0.1', dependencies: { 'child-y': '^1.0.0' } }, 'node_modules/child-y': { version: '1.0.0' } }, { 'widget-x': '^1.0.0' }),
    { 'child-y@1.0.0': [adv('GHSA-dddd-eeee-ffff', 'critical')] });
  assert.equal(same.state, 'clear');
  assert.equal(same.counts.introduced, 0);
  // a partial fix: child-y moves, the advisory stays — the same finding having moved
  const moved = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.0.0': [adv('GHSA-dddd-eeee-ffff', 'critical')], 'child-y@1.2.0': [adv('GHSA-dddd-eeee-ffff', 'critical')] });
  assert.equal(moved.state, 'clear');
  assert.deepEqual([moved.counts.introduced, moved.counts.persisting, moved.counts.resolved], [0, 1, 0]);
});

test('a new copy of an advisory already in the graph is introduced when every old copy stays', async () => {
  const b = lock({ 'node_modules/widget-x': { version: '1.0.0' }, 'node_modules/child-y': { version: '1.0.0' } }, { 'widget-x': '^1.0.0', 'child-y': '^1.0.0' });
  const a = lock({ 'node_modules/widget-x': { version: '1.1.0', dependencies: { 'child-y': '^0.9.0' } }, 'node_modules/widget-x/node_modules/child-y': { version: '0.9.0' },
    'node_modules/child-y': { version: '1.0.0' } }, { 'widget-x': '^1.1.0', 'child-y': '^1.0.0' });
  const A = [adv('GHSA-aaaa-bbbb-cccc', 'high')];
  const v = await verdict(b, a, { 'child-y@1.0.0': A, 'child-y@0.9.0': A });
  assert.equal(v.state, 'introduces');
  assert.deepEqual([v.introduced[0].why, v.introduced[0].versions, v.counts.persisting], ['new-copy', ['0.9.0', '1.0.0'], 0]);
  assert.ok(v.introduced[0].paths.some((p) => p.join(' ') === 'widget-x@1.1.0 child-y@0.9.0'), JSON.stringify(v.introduced[0].paths));
});

test('an advisory that was only on dev packages and now ships is introduced', async () => {
  const b = lock({ 'node_modules/child-y': { version: '1.0.0', dev: true } }, {}, { 'child-y': '^1.0.0' });
  const a = lock({ 'node_modules/child-y': { version: '1.0.0' } }, { 'child-y': '^1.0.0' });
  const v = await verdict(b, a, { 'child-y@1.0.0': [adv('GHSA-aaaa-bbbb-cccc', 'high')] });
  assert.equal(v.state, 'introduces');
  assert.deepEqual([v.introduced[0].why, v.introduced[0].exposure], ['now-ships', 'prod']);
  const back = await verdict(a, b, { 'child-y@1.0.0': [adv('GHSA-aaaa-bbbb-cccc', 'high')] });
  assert.deepEqual([back.state, back.counts.persisting], ['clear', 1], 'prod to dev introduces nothing');
});

test('a move persists: the old copy gone and the new one still affected, one new copy or two', async () => {
  const A = [adv('GHSA-dddd-eeee-ffff', 'critical')];
  const b = lock({ 'node_modules/child-y': { version: '1.0.0' } }, { 'child-y': '^1.0.0' });
  const a = lock({ 'node_modules/child-y': { version: '1.2.0' }, 'node_modules/widget-x': { version: '1.0.0', dependencies: { 'child-y': '1.3.0' } },
    'node_modules/widget-x/node_modules/child-y': { version: '1.3.0' } }, { 'child-y': '^1.2.0', 'widget-x': '^1.0.0' });
  const v = await verdict(b, a, { 'child-y@1.0.0': A, 'child-y@1.2.0': A, 'child-y@1.3.0': A });
  assert.deepEqual([v.state, v.counts.introduced, v.counts.persisting], ['clear', 0, 1]);
});

test('a swap is caught: one high resolved and another introduced keeps the count, not the verdict', async () => {
  const v = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.0.0': [adv('GHSA-1111-2222-3333', 'high')], 'child-y@1.2.0': [adv('GHSA-4444-5555-6666', 'high')] });
  assert.equal(v.state, 'introduces');
  assert.deepEqual(v.introduced.map((i) => i.advisory), ['GHSA-4444-5555-6666']);
  assert.deepEqual(v.resolved.map((i) => i.advisory), ['GHSA-1111-2222-3333']);
});

test('an advisory on a package the update removes is resolved', async () => {
  const dropped = lock({ 'node_modules/widget-x': { version: '1.1.0' } }, { 'widget-x': '^1.1.0' });
  const v = await verdict(PARENT_V1, dropped, { 'child-y@1.0.0': [adv('GHSA-1111-2222-3333', 'high')] });
  assert.equal(v.state, 'clear');
  assert.deepEqual(v.resolved.map((r) => `${r.advisory} ${r.package}`), ['GHSA-1111-2222-3333 child-y']);
});

test('a dev-only introduction is caught by default, and only the setting turns that off', async () => {
  const devBefore = lock({ 'node_modules/tool-z': { version: '2.0.0', dev: true } }, {}, { 'tool-z': '^2.0.0' });
  const devAfter = lock({ 'node_modules/tool-z': { version: '2.1.0', dev: true } }, {}, { 'tool-z': '^2.1.0' });
  const t = { 'tool-z@2.1.0': [adv('GHSA-7777-8888-9999', 'critical')] };
  const v = await verdict(devBefore, devAfter, t);
  assert.equal(v.state, 'introduces');
  assert.equal(v.introduced[0].exposure, 'dev');
  assert.equal(v.scope.includeDev, true);
  const off = await verdict(devBefore, devAfter, t, { includeDev: false });
  assert.equal(off.state, 'clear');
  assert.equal(off.counts.looked, 0);
});

test('a dev package that starts to ship counts as introduced when devDependencies are excluded', async () => {
  const b = lock({ 'node_modules/tool-z': { version: '2.0.0', dev: true } }, {}, { 'tool-z': '^2.0.0' });
  const a = lock({ 'node_modules/tool-z': { version: '2.0.0' } }, { 'tool-z': '^2.0.0' });
  const v = await verdict(b, a, { 'tool-z@2.0.0': [adv('GHSA-7777-8888-9999', 'high')] }, { includeDev: false });
  assert.equal(v.state, 'introduces');
});

test('a graph that cannot be resolved is unmeasured, never clear', async () => {
  for (const [b, a, why] of [
    [PARENT_V1, '{ not json', /after graph could not be resolved: .*not JSON/],
    [PARENT_V1, JSON.stringify({ lockfileVersion: 1, dependencies: {} }), /lockfileVersion 1/],
    ['', PARENT_V2, /before graph could not be resolved/],
  ]) {
    const v = await verdict(b, a, {});
    assert.equal(v.state, 'unmeasured', why.source);
    assert.match(v.reasons.join('\n'), why);
    assert.deepEqual(v.introduced, []);
  }
  const gone = await introducedVerdict({ before: { text: PARENT_V1 }, after: { absent: true }, lookupBefore: table({}), lookupAfter: table({}) });
  assert.equal(gone.state, 'unmeasured');
  assert.match(gone.reasons[0], /no package-lock\.json after the update/);
});

test('a lookup that fails, throws, or skips a pair is unmeasured; a version with no stated version too', async () => {
  const failed = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': new Error('OSV answered 503') });
  assert.equal(failed.state, 'unmeasured');
  assert.match(failed.unmeasured.map((u) => u.reason).join(), /OSV answered 503/);
  const thrown = await introducedVerdict({ before: { text: PARENT_V1 }, after: { text: PARENT_V2 }, lookupBefore: table({}), lookupAfter: async () => { throw new Error('socket hang up'); } });
  assert.equal(thrown.state, 'unmeasured');
  const silent = computeVerdict({ before: readNpmGraph(PARENT_V1), after: readNpmGraph(PARENT_V2), findingsBefore: new Map(), findingsAfter: new Map() });
  assert.equal(silent.state, 'unmeasured', 'a pair nobody answered for is not a pair with no advisories');
  const noVersion = await verdict(PARENT_V1, lock({ 'node_modules/widget-x': { version: '1.0.0', dependencies: { 'child-y': '^1.0.0' } }, 'node_modules/child-y': { resolved: 'https://registry.example.invalid/child-y.tgz' } }, { 'widget-x': '^1.0.0' }), {});
  assert.equal(noVersion.state, 'unmeasured');
  assert.match(noVersion.unmeasured[0].reason, /states no version/);
});

test('an unknown severity counts by default, an unread record too, and the blocking set is the setting', async () => {
  const unknown = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-unkn-own0-0000', 'undetermined', { severitySource: 'unrated' })] });
  assert.equal(unknown.state, 'introduces');
  assert.equal(unknown.introduced[0].severity, 'unknown');
  const unread = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-unre-ad00-0000', 'unknown', { severitySource: 'unread' })] });
  assert.equal(unread.state, 'introduces');
  const narrowed = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-unkn-own0-0000', 'undetermined')] }, { blocking: ['critical', 'high'] });
  assert.equal(narrowed.state, 'clear');
  assert.equal(narrowed.introduced[0].blocking, false, 'a non-blocking introduction is still listed');
  const moderate = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-mode-rate-0000', 'med')] });
  assert.deepEqual([moderate.state, moderate.introduced[0].severity], ['clear', 'moderate']);
});

test('an advisory after the update on a package whose before side was not measured is not called introduced', async () => {
  const v = await verdict(PARENT_V1, PARENT_V2, { 'child-y@1.0.0': new Error('timeout'), 'child-y@1.2.0': [adv('GHSA-aaaa-bbbb-cccc', 'high')] });
  assert.equal(v.state, 'unmeasured');
  assert.equal(v.counts.introduced, 0);
  assert.ok(v.unmeasured.some((u) => u.advisory === 'GHSA-aaaa-bbbb-cccc'));
});

test('a lockfile added by the update introduces what it carries; a git source is unmeasured', async () => {
  const added = await verdict(null, PARENT_V2, { 'child-y@1.2.0': [adv('GHSA-aaaa-bbbb-cccc', 'high')] });
  assert.equal(added.state, 'introduces');
  const git = lock({ 'node_modules/widget-x': { version: '1.0.0', resolved: 'git+ssh://git@example.invalid/widget-x.git#abc' } }, { 'widget-x': 'example/widget-x' });
  const v = await verdict(PARENT_V1, git, {});
  assert.equal(v.state, 'unmeasured');
  assert.match(v.unmeasured.find((u) => u.side === 'after').reason, /not a registry package/);
});

test('only packages whose versions changed are looked up, and the same inputs give byte-identical JSON', async () => {
  const b = readNpmGraph(lock({ 'node_modules/steady': { version: '3.0.0' }, 'node_modules/widget-x': { version: '1.0.0' } }));
  const a = readNpmGraph(lock({ 'node_modules/steady': { version: '3.0.0' }, 'node_modules/widget-x': { version: '1.0.1' } }));
  const set = lookupSet(b, a);
  assert.deepEqual([...set.before, ...set.after].map((p) => `${p.name}@${p.version}`), ['widget-x@1.0.0', 'widget-x@1.0.1']);
  const t = { 'child-y@1.2.0': [adv('GHSA-aaaa-bbbb-cccc', 'high'), adv('GHSA-0000-1111-2222', 'low')] };
  assert.equal(JSON.stringify(await verdict(PARENT_V1, PARENT_V2, t)), JSON.stringify(await verdict(PARENT_V1, PARENT_V2, t)));
  const v = await verdict(PARENT_V1, PARENT_V2, t);
  assert.deepEqual([v.schema, v.version, v.check], ['commitwork.introduced-advisories', 1, { kind: 'security', id: 'dependency-audit' }]);
  assert.deepEqual(v.introduced.map((i) => i.advisory), ['GHSA-0000-1111-2222', 'GHSA-aaaa-bbbb-cccc']);
});
