// Call analysis is ON, and its verdict may never suppress. Measured against osv-scanner 2.5.1:
// `experimental_analysis` emits `called:false` IDENTICALLY when --call-analysis was never passed,
// so `false` is the absence of a claim, not "unreachable" — trusting it suppresses every finding
// in every repo. Only `called:true` carries information, and even that arrives unevidenced (no
// call path, no symbols, no entry points), which is why the rule below is absolute.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
const OSV = MANIFEST.checks.find((c) => c.id === 'deps-osv');
const CMD = (OSV.local || []).join(' ');

describe('call analysis is enabled, and enabled deliberately', () => {
  test('the command requests it for Go', () => {
    assert.match(CMD, /--call-analysis=go/,
      'enabled after verifying it adds no network endpoint beyond api.osv.dev, which this lane already contacts');
  });

  test('it is requested for go only — rust call analysis runs build scripts', () => {
    assert.ok(!/--call-analysis=rust/.test(CMD),
      'osv-scanner\'s help marks rust with "(*) Will run build scripts"; executing build scripts from '
      + 'scanned third-party code is a different risk decision and is not taken here');
  });

  test('the reasoning is recorded on the check, not only in a commit message', () => {
    assert.match(OSV.notes || '', /call analysis/i);
    assert.match(OSV.notes || '', /never used to suppress|NEVER used to suppress/,
      'the next reader must find the suppression rule on the check itself');
  });
});

describe('THE RULE: experimental_analysis may never suppress a finding', () => {
  // enforced by absence: the safe state is that no code reads this field, and a consumer must
  // arrive with a deliberate change to this test
  const runtimeDirs = ['bin', 'monitor', 'admin', 'mcp', 'cra'];
  const sources = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'test') walk(p); continue; }
      if (e.name.endsWith('.mjs') || e.name.endsWith('.html')) sources.push(p);
    }
  };
  for (const d of runtimeDirs) walk(join(REPO, d));

  test('no shipped code reads experimental_analysis / called / unimportant', () => {
    const offenders = [];
    for (const p of sources) {
      const src = readFileSync(p, 'utf8');
      if (/experimental_?[Aa]nalysis/.test(src)) offenders.push(`${p.slice(REPO.length + 1)} (experimental_analysis)`);
    }
    assert.deepEqual(offenders, [],
      'a consumer of experimental_analysis has appeared. Before wiring it: `called:false` is emitted even '
      + 'when call analysis was never requested, so treating it as "unreachable" suppresses every finding '
      + 'in every repo. Only `called:true` is informative, and even that arrives with no call path, no '
      + 'symbols checked and no entry points — an unevidenced clearance. If you are adding a consumer, it '
      + 'must record the reachability EVIDENCE alongside the verdict, and must not remove or downgrade a '
      + 'finding on the strength of a boolean:\n  ' + offenders.join('\n  '));
  });

  test('sources were actually scanned — an empty sweep would pass vacuously', () => {
    assert.ok(sources.length > 40, `expected the runtime tree, walked only ${sources.length} files`);
  });
});
