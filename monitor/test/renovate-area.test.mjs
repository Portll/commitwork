// monitor/renovate-status.mjs — WHICH repository a Renovate row describes.
//
// The defect this pins: `process.env.CW_RENOVATE_REPO || 'Portll/client-a'` with nothing in the tree
// ever setting that variable, so the literal fired every run and every area's Renovate row reported
// one customer's pull requests. That is the hardest class of wrong number to notice, because it is
// not missing or stale — it is present, plausible, and about a different repository.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, registryPath, isExampleRegistry } from '../registry.mjs';
import { registryPathFor } from '../store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const SCRIPT = join(CW, 'monitor', 'renovate-status.mjs');

// Renovate repos are declared only in the private registry; without it loadRegistry() reads the
// example, which declares none.
const LIVE_SKIP = isExampleRegistry(registryPath())
  ? `private registry absent: ${registryPathFor(CW)} does not exist, so loadRegistry() reads the example and the live renovate declarations are not measured`
  : undefined;

const run = (args, out) => {
  try {
    return execFileSync('node', [SCRIPT, ...args],
      { cwd: CW, encoding: 'utf8', timeout: 60_000, env: { ...process.env, CW_MONITOR_OUT: out } });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
};

describe('the Renovate lane names its own repository', () => {
  test('an area with NO renovate block writes a VOID, never another area\'s numbers', () => {
    const out = mkdtempSync(join(tmpdir(), 'cw-rv-'));
    run(['--area', 'client-d'], out);
    const j = JSON.parse(readFileSync(join(out, 'renovate.json'), 'utf8'));

    assert.equal(j.repo, null, 'an undeclared area must not be given a repo');
    assert.equal(j.void, 'undeclared');
    assert.equal(j.prs, null, 'no PR counts may be reported for a repo we cannot name');
    assert.equal(j.dashboard, null);
    assert.match(j.reason, /declares no `renovate` block/);
    // The load-bearing assertion: the void must not carry the fallback repo's identity.
    assert.doesNotMatch(JSON.stringify(j), /client-a/i,
      'the void must not mention the old hardcoded repo — substituting it is the bug');
  });

  test('the declaration is what supplies the repo, and it is per-area', { skip: LIVE_SKIP }, () => {
    const areas = loadRegistry().areas || [];
    const declared = areas.filter((a) => a.renovate);
    assert.ok(declared.length >= 1, 'at least one area declares a renovate repo');
    for (const a of declared) {
      assert.match(a.renovate.repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
        `${a.slug}: renovate.repo must be owner/name`);
    }
    // Every OTHER area is a declared void by omission — that is the point, not an oversight.
    const undeclared = areas.filter((a) => !a.renovate);
    assert.ok(undeclared.length > 0,
      'if every area declared one, this test would stop proving the void path is reachable');
  });

  test('no hardcoded fallback repo survives in the source', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    // A literal owner/name on the same line as the REPO resolution is the exact shape of the defect.
    const bad = src.split('\n').filter((l) => /const REPO\s*=/.test(l) && /['"][A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+['"]/.test(l));
    assert.deepEqual(bad, [],
      'REPO must resolve from the area declaration; a literal here reports one repo for every area');
  });
});
