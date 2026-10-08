// node --test cra/test/ — CW_CRA_ROOT names a root, so an ambient CW_REGISTRY must not outrank it.
//
// resolvePaths() read registryPathFor(craRoot()) with the ambient override ON, so any CRA fixture run
// from a shell that had exported CW_REGISTRY — the documented way to aim a tool at the live
// registry — resolved its evidence paths from the LIVE fleet registry instead of the fixture's.
// monitor/store-paths.mjs already states the rule (a caller that nominates its own root passes
// `{ ambient: false }`); cra/lib.mjs was a caller that did not. Both directions are pinned: the
// fixture root wins when named, and CW_REGISTRY still wins when no root is named, because that is
// how production reaches the live registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { resolvePaths } from '../lib.mjs';
import { registryPathFor } from '../../monitor/store-paths.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-cra-root-registry-'));
const ROOT = join(T, 'fixture-root');
const own = registryPathFor(ROOT, { ambient: false });
mkdirSync(dirname(own), { recursive: true });
writeFileSync(own, JSON.stringify({ reportsRoot: 'reports', areas: [{ slug: 'fixture-area', out: 'fixture-out', primary: true }] }));
// Stands in for the live registry an operator's shell points at.
const DECOY = join(T, 'decoy-projects.json');
writeFileSync(DECOY, JSON.stringify({ reportsRoot: 'reports', areas: [{ slug: 'decoy-area', out: 'decoy-out', primary: true }] }));

const NAMES = ['CW_CRA_ROOT', 'CW_REGISTRY', 'CW_ROLLUP', 'CW_LEDGER', 'CW_HISTORY'];
// Set AFTER import on purpose: resolvePaths must read both variables at CALL time.
function withEnv(vars, fn) {
  const was = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
  for (const k of NAMES) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally {
    for (const k of NAMES) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  }
}

test('with CW_CRA_ROOT set, an exported CW_REGISTRY is refused — the fixture registry is read', () => {
  const p = withEnv({ CW_CRA_ROOT: ROOT, CW_REGISTRY: DECOY }, () => resolvePaths());
  assert.equal(p.areaOut, 'fixture-out', 'the ambient CW_REGISTRY outranked the root the caller named');
  assert.equal(p.rollup, join(ROOT, 'reports', 'fixture-out', 'rollup.json'));
  assert.deepEqual(p.projects.areas.map((a) => a.slug), ['fixture-area']);
});

test('the same holds for resolvePaths({ area })', () => {
  const p = withEnv({ CW_CRA_ROOT: ROOT, CW_REGISTRY: DECOY }, () => resolvePaths({ area: 'fixture-area' }));
  assert.equal(p.areaOut, 'fixture-out');
});

test('with no CW_CRA_ROOT, CW_REGISTRY still wins — production reaches the live registry through it', () => {
  const p = withEnv({ CW_REGISTRY: DECOY }, () => resolvePaths());
  assert.equal(p.areaOut, 'decoy-out', 'the production precedence was inverted, not narrowed');
});
