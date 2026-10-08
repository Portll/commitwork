// The owner map — what it may claim, and whose repos it may claim them about. The rule: the map may
// not describe itself as more wired-up than it is, and may not attribute one area's ownership to
// another's. The operator's map is a private record (monitor/private/owner-map.json); the claims
// below run on the shipped example and on the private map when it is present.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registryPathFor, ownerMapPathFor } from '../store-paths.mjs';
import { fileURLToPath } from 'node:url';
import { assembleLifecycle } from '../lifecycle.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'monitor', 'owner-map.example.json'), 'utf8'));
function privateMap() {
  try { return JSON.parse(fs.readFileSync(ownerMapPathFor(ROOT), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_OWNER_MAP) return null; throw e; }
}
const PRIVATE = privateMap();
const maps = [['example', EXAMPLE], ['private', PRIVATE]].filter(([, m]) => m);
const privateOnly = PRIVATE ? {} : { skip: `private owner map absent: ${ownerMapPathFor(ROOT)} (ENOENT)` };
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'monitor', 'schema', 'repo-meta.schema.json'), 'utf8'));

// Areas are declared in the private fleet registry, which a clean checkout does not have. Only its
// absence skips — ENOENT, with no CW_REGISTRY naming it — so unreadable or unparseable fails.
function liveRegistry() {
  try { return JSON.parse(fs.readFileSync(registryPathFor(ROOT), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_REGISTRY) return null; throw e; }
}

const rec = (repo) => ({ repo, key: `${repo}|x`, severity: 'high' });
const assemble = (recs, ctx) => assembleLifecycle(recs, { nowIso: '2026-08-03T00:00:00.000Z', ...ctx }).records;

describe('the map does not claim capabilities it lacks', () => {
  test('no live text promises bugReportedTo — the field and the code never existed', () => {
    for (const [label, map] of maps) {
      const live = JSON.stringify({ ...map, $notConsumed: undefined });
      assert.ok(!/bugReportedTo/.test(live),
        `${label}: the docstring promised escalation-recipient defaults with no field and no consumer`);
      assert.match(JSON.stringify(map.$notConsumed), /bugReportedTo/,
        `${label}: and the retraction is recorded, so the claim cannot quietly return`);
    }
  });

  test('no config key holds pseudo-code about code', () => {
    for (const [, map] of maps) assert.equal(map.$defaults.technologyFallback, undefined,
      "technologyFallback held `humanize(repo)  // e.g. ...` — a comment about lifecycle.mjs, in a "
      + 'config file, that nothing read');
  });

  test('the schema does not describe a renderer that does not exist', () => {
    assert.equal(schema['x-front-end-wiring'], undefined,
      'it named a C11 lifecycle-tab.mjs; no such file is in the tree');
    for (const f of ['lifecycle-tab.mjs']) {
      assert.equal(fs.existsSync(path.join(ROOT, 'monitor', f)), false, `${f} still absent`);
    }
    assert.match(schema['x-consumers'], /lifecycle\.mjs/, 'the real consumer is named instead');
  });

  test('nothing in the tree claims this file is validated', () => {
    // The schema is accurate and worth keeping; it is simply not loaded by anything.
    for (const [, map] of maps) assert.doesNotMatch(JSON.stringify({ ...map, $notConsumed: undefined }), /Validated by/);
    assert.match(schema.title, /DESCRIBES/, 'the schema says what it does, in its title');
  });
});

describe('$defaults is read, not decorative', () => {
  test('a declared default reaches the record', () => {
    const [r] = assemble([rec('unmapped-repo')], {
      ownerMap: { $defaults: { visibleTo: 'embargoed' }, repos: {} },
    });
    assert.equal(r.bugVisibleTo, 'embargoed',
      'the consumer used to hardcode its own literal, so editing $defaults changed nothing');
  });

  test('with no $defaults at all it still falls back to internal', () => {
    const [r] = assemble([rec('unmapped-repo')], { ownerMap: { repos: {} } });
    assert.equal(r.bugVisibleTo, 'internal');
  });

  test('a per-repo visibleTo still beats the default', () => {
    const [r] = assemble([rec('a')], {
      ownerMap: { $defaults: { visibleTo: 'internal' }, repos: { a: { technology: 'A', visibleTo: 'public' } } },
    });
    assert.equal(r.bugVisibleTo, 'public');
  });
});

describe('ownership belongs to one area', () => {
  const ownerMap = { $scope: { area: 'client-a' }, repos: { 'api-gateway': { team: 'platform', technology: 'Spring Cloud Gateway' } } };

  test('the map applies in its own area', () => {
    const [r] = assemble([rec('api-gateway')], { ownerMap, area: 'client-a' });
    assert.equal(r.bugBelongsTo, 'platform');
    assert.equal(r.repoTechnology, 'Spring Cloud Gateway');
  });

  test("a like-named repo in ANOTHER area does not inherit the attribution", () => {
    // the join is on the bare directory name — without the scope check the attribution crosses areas
    const [r] = assemble([rec('api-gateway')], { ownerMap, area: 'client-d' });
    assert.equal(r.bugBelongsTo, null, 'unmapped is a legitimate state; misattributed is not');
    assert.equal(r.repoTechnology, 'Api Gateway', 'falls back to the humanized name');
  });

  test('an unscoped map still applies — this is not a silent behaviour change for old maps', () => {
    const [r] = assemble([rec('api-gateway')], { ownerMap: { repos: ownerMap.repos }, area: 'client-d' });
    assert.equal(r.bugBelongsTo, 'platform');
  });

  test('every map declares its scope', () => {
    for (const [label, map] of maps) assert.ok(map.$scope?.area, `${label}: the map must say which area it covers`);
  });

  test('the private map\'s scope is a real area in the registry', privateOnly, (t) => {
    const reg = liveRegistry();
    if (!reg) {
      return t.skip(`private registry absent: ${registryPathFor(ROOT)} does not exist, so $scope.area `
        + 'has no fleet to be checked against');
    }
    assert.ok((reg.areas || []).some((a) => a.slug === PRIVATE.$scope?.area),
      `$scope.area '${PRIVATE.$scope?.area}' is not a declared area slug`);
  });
});

describe('unreachable rows are not shaped like live ones', () => {
  test('no _infra_* keys remain in repos{}', () => {
    for (const [label, map] of maps) {
      const infraish = Object.keys(map.repos).filter((k) => k.startsWith('_'));
      assert.deepEqual(infraish, [],
        `${label}: the consumer looks up by scanned repo dir name; no scan produces these, so they could never match`);
    }
  });

  test('the private map keeps them, in their own block, with their status stated', privateOnly, () => {
    assert.ok(PRIVATE.infra, 'the facts are worth keeping');
    assert.ok(Object.keys(PRIVATE.infra).filter((k) => !k.startsWith('$')).length >= 6);
    assert.match(PRIVATE.infra.$comment, /no reader yet/i, 'and their unwired status is on the record');
  });

  test('every remaining repos{} entry carries the field the schema requires', () => {
    for (const [label, map] of maps) for (const [name, m] of Object.entries(map.repos)) {
      assert.ok(m.technology, `${label}: ${name} has no technology headline`);
    }
  });
});
