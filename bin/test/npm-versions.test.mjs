// bin/test/npm-versions.test.mjs — the npm version audit: update types, cooldown holds, advisory
// ranges, fix states and the gate. Pure over fixtures; no npm, no registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateType, satisfies, nonRegistryReason, planDependency, fixStateOf, summariseAudit, exposureOf, gate, readProject, renderAuditText, auditProject, cmpVersion } from '../lib/npm-versions.mjs';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();

test('update types are measured from the locked version, and under 0.x a minor is a major', () => {
  assert.equal(updateType('1.2.3', '1.2.4'), 'patch');
  assert.equal(updateType('1.2.3', '1.3.0'), 'minor');
  assert.equal(updateType('1.2.3', '2.0.0'), 'major');
  assert.equal(updateType('0.1.2', '0.1.3'), 'patch');
  assert.equal(updateType('0.1.2', '0.2.0'), 'major');
  assert.equal(updateType('0.0.1', '0.0.2'), 'major');
  assert.equal(updateType('2.0.0-rc.1', '2.0.0'), 'patch');
  assert.ok(cmpVersion('1.0.0-rc.2', '1.0.0-rc.10') < 0 && cmpVersion('1.0.0-rc.1', '1.0.0') < 0);
});

test('advisory ranges read the forms npm audit prints, and an unreadable one is null, not a guess', () => {
  assert.equal(satisfies('3.0.3', '<=3.0.3'), true);
  assert.equal(satisfies('3.0.4', '<=3.0.3'), false);
  assert.equal(satisfies('2.1.0', '>=2.0.0 <2.1.1 || <=1.4.0'), true);
  assert.equal(satisfies('1.5.0', '>=2.0.0 <2.1.1 || <=1.4.0'), false);
  assert.equal(satisfies('2.9.9', '<=2'), true, '<=2 means below 3.0.0');
  assert.equal(satisfies('3.0.0', '<=2'), false);
  assert.equal(satisfies('1.2.5', '1.2.3 - 1.2.6'), true);
  assert.equal(satisfies('4.0.0', '*'), true);
  assert.equal(satisfies('1.0.0', 'garbage!'), null);
});

test('specs that are not registry ranges are named, never measured', () => {
  for (const s of ['git+https://x/y.git', 'file:../x', 'github:a/b', 'a/b', 'npm:other@1', 'workspace:*', 'next']) assert.ok(nonRegistryReason(s), s);
  for (const s of ['^1.2.3', '~1.2', '1.2.3', '>=1 <2', '*', 'x', '1.x']) assert.equal(nonRegistryReason(s), null, s);
});

const meta = (versions, extra = {}) => ({ versions: Object.keys(versions), time: versions, latest: Object.keys(versions).at(-1), lockedDeprecated: null, lockedUnpublished: false, ...extra });
const dep = { name: 'p', kind: 'dependencies', spec: '^1.0.0', locked: '1.0.0', linked: false };

test('a release inside its type\'s cooldown is held, with the days until it is eligible; no publish time is held as unknown-age', () => {
  const m = meta({ '1.0.0': ago(400), '1.0.1': ago(3), '1.1.0': ago(30), '2.0.0': ago(10), '2.1.0-beta.1': ago(40) });
  m.versions.push('1.0.2'); // in the list, with no time
  const r = planDependency(dep, m, { nowMs: NOW, cooldown: { patch: 7, minor: 7, major: 14 } });
  assert.deepEqual(r.updates.map((u) => `${u.type} ${u.version}`), ['minor 1.1.0']);
  assert.deepEqual(r.held.map((h) => `${h.version} ${h.reason} ${h.releasesIn}`), ['1.0.1 too-new 4', '1.0.2 unknown-age null', '2.0.0 too-new 4']);
  const zero = planDependency(dep, m, { nowMs: NOW, cooldown: 0 });
  assert.deepEqual(zero.updates.map((u) => u.version), ['1.0.1', '1.1.0', '2.0.0'], 'a cooldown of 0 holds nothing with a known age; the prerelease is never offered');
});

test('the locked version\'s deprecation and absence from the registry are reported', () => {
  const r = planDependency(dep, meta({ '1.0.1': ago(30) }, { lockedDeprecated: 'use q', lockedUnpublished: true }), { nowMs: NOW });
  assert.equal(r.lockedDeprecated, 'use q');
  assert.equal(r.lockedUnpublished, true);
  assert.match(renderAuditText({ name: 'x', deps: [r], counts: { patch: 1, minor: 0, major: 0 }, cooldown: { patch: 7, minor: 7, major: 7 }, unmeasured: 0, advisories: { error: 'offline' } }), /locked version deprecated: use q; locked version unpublished/);
});

const lock = { packages: { '': {}, 'node_modules/braces': { version: '3.0.3', dev: true }, 'node_modules/micromatch': { version: '4.0.8', dev: true },
  'node_modules/top': { version: '44.0.0', dev: true }, 'node_modules/shipped': { version: '1.0.0' }, 'node_modules/glob': { version: '1.0.0', dev: true } } };

test('npm\'s "fix available" loses to the registry when no release sits outside the affected range', () => {
  const braces = { name: 'braces', fixAvailable: true, via: [{ range: '<=3.0.3', title: 't' }], nodes: ['node_modules/braces'] };
  assert.equal(fixStateOf(braces, lock, ['3.0.0', '3.0.2', '3.0.3']).state, 'unpatched');
  assert.equal(fixStateOf(braces, lock, ['3.0.3', '3.0.4']).state, 'available', 'with a patched release npm\'s fix stands');
  const downgrade = { ...braces, fixAvailable: { name: 'top', version: '21.0.0', isSemVerMajor: true } };
  assert.equal(fixStateOf(downgrade, lock, ['3.0.3', '3.1.0']).state, 'blocked', 'a downgrade is no fix; a patched release behind a parent range is blocked');
  assert.deepEqual(fixStateOf(downgrade, lock, ['3.0.3', '3.1.0']).override, { braces: '^3.1.0' });
  assert.equal(fixStateOf(downgrade, lock, null).state, 'undetermined');
});

test('a package vulnerable only through others takes their state, and a diamond is not a cycle', () => {
  // `top` first: rows resolve in order and memoise, so the diamond is only walked when its top
  // resolves before the packages under it.
  const audit = { vulnerabilities: {
    top: { name: 'top', severity: 'high', via: ['glob', 'micromatch'], nodes: ['node_modules/top'], isDirect: true, fixAvailable: true },
    glob: { name: 'glob', severity: 'high', via: ['micromatch', 'braces'], nodes: ['node_modules/glob'], fixAvailable: true },
    micromatch: { name: 'micromatch', severity: 'high', via: ['braces'], nodes: ['node_modules/micromatch'], fixAvailable: true },
    braces: { name: 'braces', severity: 'high', via: [{ range: '<=3.0.3', title: 'b' }], nodes: ['node_modules/braces'], fixAvailable: true },
  } };
  const s = summariseAudit(audit, lock, (n) => (n === 'braces' ? ['3.0.3'] : null));
  assert.deepEqual(Object.fromEntries(s.rows.map((r) => [r.name, r.fix.state])), { braces: 'unpatched', glob: 'unpatched', micromatch: 'unpatched', top: 'unpatched' });
  assert.deepEqual(s.prod, { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, 'all four are dev-only');
});

test('exposure is prod when any node ships, unknown when a node is missing — and the gate reads shipped advisories by default', () => {
  assert.equal(exposureOf(['node_modules/braces'], lock), 'dev');
  assert.equal(exposureOf(['node_modules/braces', 'node_modules/shipped'], lock), 'prod');
  assert.equal(exposureOf(['node_modules/ghost'], lock), 'unknown');
  const rows = (fix, exposure, severity = 'high') => ({ rows: [{ name: 'x', severity, exposure, fix: { state: fix } }] });
  assert.equal(gate(rows('available', 'dev')).verdict, 'clear');
  assert.equal(gate(rows('available', 'dev'), { includeDev: true }).verdict, 'actionable');
  assert.equal(gate(rows('blocked', 'prod')).verdict, 'actionable');
  assert.equal(gate(rows('available', 'unknown')).verdict, 'actionable', 'unknown exposure is gated as shipped');
  assert.equal(gate(rows('undetermined', 'prod')).verdict, 'unmeasured');
  assert.equal(gate(rows('unpatched', 'prod')).verdict, 'clear');
  assert.equal(gate(rows('available', 'prod', 'moderate')).verdict, 'clear');
  assert.equal(gate({ error: 'npm audit failed' }).verdict, 'unmeasured');
});

test('a project without an npm lockfile is not measured, names its own lockfile, and an unreadable one is an error', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-npmv-'));
  writeFileSync(join(d, 'package.json'), '{"name":"y"}');
  assert.match(readProject(d).error, /package-lock\.json not found/);
  writeFileSync(join(d, 'yarn.lock'), '# yarn lockfile v1\n');
  assert.match(readProject(d).error, /not measured: this project is locked by yarn \(yarn\.lock\)/);
  writeFileSync(join(d, 'package-lock.json'), '{"lockfileVersion":1,"dependencies":{}}');
  assert.match(readProject(d).error, /lockfileVersion 1/);
  writeFileSync(join(d, 'package-lock.json'), '{not json');
  assert.match(readProject(d).error, /package-lock\.json is not JSON/);
  writeFileSync(join(d, 'package.json'), '{"name":"y","devDependencies":[]}');
  writeFileSync(join(d, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  assert.match(readProject(d).error, /devDependencies is not an object/);
});

test('the audit composes from injected npm answers, and a failed lookup is not-measured rather than current', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-npmv-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'y', dependencies: { a: '^1.0.0', b: '^1.0.0' } }));
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' } } }));
  const view = async (name) => (name === 'a' ? { meta: meta({ '1.0.0': ago(100), '1.0.1': ago(20) }) } : { error: 'E404' });
  const r = await auditProject(d, { nowMs: NOW, view, audit: async () => ({ audit: { vulnerabilities: {} } }) });
  assert.deepEqual(r.counts, { patch: 1, minor: 0, major: 0 });
  assert.equal(r.unmeasured, 1);
  assert.match(r.deps.find((x) => x.name === 'b').skipped, /registry lookup failed: E404/);
  const text = renderAuditText(r);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.match(text, /b +1\.0\.0 +not measured/);
});
