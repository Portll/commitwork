// node --test monitor/test/ — tiers 2+3. The properties that make this lane different from a
// consumer scanner, each pinned: an exact ecosystem match publishes alone (tier-1 oracle), a CPE
// match caps at undetermined WITH the claim preserved, KEV enriches and never witnesses, an
// unreadable KEV list is kev:null (unchecked ≠ absent), a non-zero tool exit is unknown even when
// stdout parsed, an absent grype DB is unknown for the whole lane and never triggers a download,
// zero components is no-subject not clean, and one CVE dominating across apps is a defect
// signature, not a fleet in crisis.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  checkGrypeDb, sbomForBundle, grypeMatches, candidatesForMatch, classifyMatch, defectSignature,
  assessApp, runLens, loadKevSet, loadEpss, collectNpmGlobalPackages, SYFT_CATALOGERS,
} from '../app-vuln.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-appvuln-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const SYFT = JSON.stringify({ artifacts: [{ name: 'electron', version: '22.0.0' }, { name: 'lodash', version: '4.17.20' }] });
const GRYPE = JSON.stringify({
  matches: [
    { vulnerability: { id: 'CVE-2024-0001', severity: 'Critical' }, artifact: { name: 'electron', version: '22.0.0', type: 'npm' }, matchDetails: [{ type: 'exact-direct-match' }] },
    { vulnerability: { id: 'CVE-2024-0002', severity: 'High' }, artifact: { name: 'lodash', version: '4.17.20', type: 'npm' }, matchDetails: [{ type: 'cpe-match' }] },
    { vulnerability: { id: 'CVE-2024-0003', severity: 'Medium' }, artifact: { name: 'electron', version: '22.0.0', type: 'npm' }, matchDetails: [{ type: 'exact-indirect-match' }] },
  ],
});
const M = (over = {}) => ({ id: 'CVE-2024-0001', severity: 'Critical', component: 'electron', componentVersion: '22.0.0', componentType: 'npm', matchTypes: ['exact-direct-match'], ...over });

describe('the DB gate', () => {
  test('valid passes; invalid/absent is unknown for the WHOLE lane and never a download', () => {
    assert.equal(checkGrypeDb({ run: () => ({ status: 0, stdout: 'Status:    valid\n', stderr: '', errCode: null }) }).ok, true);
    const stale = checkGrypeDb({ run: () => ({ status: 1, stdout: 'Status: invalid', stderr: '', errCode: null }) });
    assert.equal(stale.unknownReason, 'no-reference');
    assert.match(stale.unknownDetail, /operator egress decision/);
    assert.equal(checkGrypeDb({ run: () => ({ status: null, stdout: '', stderr: '', errCode: 'ENOENT' }) }).unknownReason, 'tool-failed');
  });
});

describe('tier 2 — SBOM + match, exit-code discipline', () => {
  test('the SBOM caches on (bundle, version); a second call does not re-run syft', () => {
    const cacheDir = scratch();
    let calls = 0;
    const run = () => { calls++; return { status: 0, stdout: SYFT, stderr: '', errCode: null }; };
    const a = sbomForBundle('/Applications/X.app', '1.0', { run, cacheDir });
    const b = sbomForBundle('/Applications/X.app', '1.0', { run, cacheDir });
    assert.equal(calls, 1);
    assert.equal(a.cached, false);
    assert.equal(b.cached, true);
    assert.equal(readFileSync(a.path, 'utf8'), SYFT);
    // a version change is a different key — the cache never serves a stale bundle
    sbomForBundle('/Applications/X.app', '2.0', { run, cacheDir });
    assert.equal(calls, 2);
  });

  test('syft runs with the installed-package cataloger, and an SBOM cached under the blind key is never served', () => {
    const cacheDir = scratch();
    const blindKey = createHash('sha256').update('/Applications/X.app|1.0').digest('hex').slice(0, 16);
    writeFileSync(join(cacheDir, `${blindKey}.syft.json`), JSON.stringify({ artifacts: [] }));
    const seen = [];
    const run = (cmd, args) => { seen.push(args); return { status: 0, stdout: SYFT, stderr: '', errCode: null }; };
    const r = sbomForBundle('/Applications/X.app', '1.0', { run, cacheDir });
    assert.equal(r.cached, false, 'the pre-cataloger SBOM saw no installed node_modules — serving it would be a false zero');
    assert.equal(seen.length, 1);
    const i = seen[0].indexOf('--select-catalogers');
    assert.ok(i > 0, 'without the selection syft reads lockfiles only');
    assert.equal(seen[0][i + 1], SYFT_CATALOGERS);
    assert.match(SYFT_CATALOGERS, /\+javascript-package-cataloger/);
  });

  test('a non-zero syft exit is unknown even with parseable stdout — the exit code is a second witness', () => {
    const r = sbomForBundle('/A.app', '1', { run: () => ({ status: 1, stdout: SYFT, stderr: 'died', errCode: null }), cacheDir: scratch() });
    assert.equal(r.unknownReason, 'tool-failed');
  });

  test('syft-json without artifacts[] is unparseable — the format decides the field you count', () => {
    const r = sbomForBundle('/A.app', '1', { run: () => ({ status: 0, stdout: JSON.stringify({ components: [] }), stderr: '', errCode: null }), cacheDir: scratch() });
    assert.equal(r.unknownReason, 'unparseable');
  });

  test('grype matches parse into the fields tier 3 prices', () => {
    const dir = scratch();
    const p = join(dir, 's.json');
    writeFileSync(p, SYFT);
    const g = grypeMatches(p, { run: () => ({ status: 0, stdout: GRYPE, stderr: '', errCode: null }) });
    assert.equal(g.matches.length, 3);
    assert.deepEqual(g.matches[0].matchTypes, ['exact-direct-match']);
  });
});

describe('tier 3 — the F-gate prices the epistemics', () => {
  test('exact-direct publishes alone; indirect and CPE cap at undetermined with the claim preserved', () => {
    const direct = classifyMatch(M());
    assert.equal(direct.publish, 'severity');
    assert.equal(direct.severity, 'Critical');

    const cpe = classifyMatch(M({ id: 'CVE-2024-0002', matchTypes: ['cpe-match'], severity: 'High' }));
    assert.equal(cpe.publish, 'undetermined');
    assert.equal(cpe.originalClaim.severity, 'High', 'the claim is preserved, never erased');
    assert.equal(cpe.severity, undefined, 'and no severity field wears a verdict it did not earn');

    const indirect = classifyMatch(M({ matchTypes: ['exact-indirect-match'] }));
    assert.equal(indirect.publish, 'undetermined');
  });

  test('an exact match with NO version lacks oracle integrity — refused into undetermined, never published', () => {
    const r = classifyMatch(M({ componentVersion: null }));
    assert.equal(r.publish, 'undetermined');
    assert.match(r.why, /refused|integrity/i);
  });

  test('a second independent matcher converges a CPE match to severity — cross-provenance, as the F-gate demands', () => {
    const r = classifyMatch(M({ matchTypes: ['cpe-match'] }), { osvIds: new Set(['CVE-2024-0001']) });
    assert.equal(r.publish, 'severity');
    assert.match(r.why, /convergence|cross-tier|oracle/i);
  });

  test('KEV and EPSS enrich both classes and witness neither; unreadable lists are null, never false', () => {
    const kevSet = new Set(['CVE-2024-0002']);
    const cpeKev = classifyMatch(M({ id: 'CVE-2024-0002', matchTypes: ['cpe-match'] }), { kevSet, epss: { 'CVE-2024-0002': 0.93 } });
    assert.equal(cpeKev.publish, 'undetermined', 'KEV does not validate the MATCH — it must not promote');
    assert.equal(cpeKev.kev, true);
    assert.equal(cpeKev.epss, 0.93);
    assert.equal(classifyMatch(M(), { kevSet }).kev, false, 'checked and absent is false');
    assert.equal(classifyMatch(M(), { kevSet: null }).kev, null, 'unchecked is null — never false');
  });
});

describe('defect signature', () => {
  const app = (name, ids) => ({ name, published: ids.map((id) => ({ id })) });
  test('one CVE dominating published rows across ≥3 apps flags; small totals never do', () => {
    const sig = defectSignature([app('a', ['X', 'X']), app('b', ['X', 'Y']), app('c', ['X', 'Z'])]);
    assert.ok(sig);
    assert.equal(sig.id, 'X');
    assert.equal(defectSignature([app('a', ['X']), app('b', ['X'])]), null, 'below the floor, noise is noise');
  });
});

describe('per-app assessment + the lane end to end', () => {
  const APP = { id: '/Applications/Demo.app', name: 'Demo', version: '1.0', kind: 'app' };

  test('zero components is no-subject — not clean, not a finding', () => {
    const run = () => ({ status: 0, stdout: JSON.stringify({ artifacts: [] }), stderr: '', errCode: null });
    const r = assessApp(APP, { run, cacheDir: scratch() });
    assert.equal(r.unknownReason, 'no-subject');
  });

  test('a grype failure after a good SBOM is unknown for that app', () => {
    const run = (cmd) => (cmd === 'syft'
      ? { status: 0, stdout: SYFT, stderr: '', errCode: null }
      : { status: 1, stdout: '', stderr: 'db locked', errCode: null });
    const r = assessApp(APP, { run, cacheDir: scratch() });
    assert.equal(r.unknownReason, 'tool-failed');
    assert.equal(r.componentCount, 2, 'what WAS measured stays reported');
  });

  test('the lane, end to end on fixtures: publishes the exact match, holds the rest, enriches with KEV', async () => {
    const dir = scratch();
    const appsRoot = join(dir, 'Apps');
    mkdirSync(join(appsRoot, 'Demo.app', 'Contents'), { recursive: true });
    writeFileSync(join(appsRoot, 'Demo.app', 'Contents', 'Info.plist'), 'x');
    const kev = join(dir, 'kev.json');
    const epss = join(dir, 'epss.json');
    writeFileSync(kev, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2024-0001' }] }));
    writeFileSync(epss, JSON.stringify({ 'CVE-2024-0001': 0.97 }));
    const run = (cmd, args) => {
      if (cmd === 'grype' && args[0] === 'db') return { status: 0, stdout: 'Status: valid', stderr: '', errCode: null };
      if (cmd === 'grype') return { status: 0, stdout: GRYPE, stderr: '', errCode: null };
      if (cmd === 'syft') return { status: 0, stdout: SYFT, stderr: '', errCode: null };
      if (cmd === 'plutil') return { status: 0, stdout: JSON.stringify({ CFBundleName: 'Demo', CFBundleShortVersionString: '1.0' }), stderr: '', errCode: null };
      if (cmd === 'codesign') return { status: 0, stdout: '', stderr: 'Authority=X\nTeamIdentifier=T\n', errCode: null };
      if (cmd === 'xattr') return { status: 1, stdout: '', stderr: '', errCode: null };
      return { status: null, stdout: '', stderr: '', errCode: 'ENOENT' };
    };
    const listeners = join(dir, 'listeners.json');
    writeFileSync(listeners, JSON.stringify([]));
    await env({ CW_APPVULN_KEV: kev, CW_APPVULN_EPSS: epss, CW_APPVULN_CACHE: join(dir, 'cache'), CW_BIND_LISTENERS: listeners, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      const r = runLens({ run, roots: [appsRoot] });
      assert.equal(r.npmGlobal, 'absent', 'no npm on the box is an absent source, not zero packages');
      assert.equal(r.state, 'findings');
      assert.equal(r.publishedTotal, 1, 'the exact-direct match, alone');
      assert.equal(r.undeterminedTotal, 2, 'CPE + indirect, held with claims preserved');
      assert.equal(r.kevChecked, true);
      const demo = r.perApp[0];
      assert.deepEqual(demo.kevHits, ['CVE-2024-0001']);
      assert.equal(demo.published[0].epss, 0.97);
      assert.deepEqual(demo.severities, { Critical: 1 });
      assert.equal(demo.reach.listening, false, 'an enumerated table with no match is FALSE, not null');
      assert.deepEqual(r.priority.map((p) => p.id), ['CVE-2024-0001'], 'the KEV-listed published row is the priority list');

      // The same box with the app LISTENING: every published row of that app floats to priority.
      writeFileSync(listeners, JSON.stringify([{ pid: 5, command: 'Demo', args: `${join(appsRoot, 'Demo.app')}/Contents/MacOS/Demo --serve`, addr: '0.0.0.0', port: 9999 }]));
      const r2 = runLens({ run, roots: [appsRoot] });
      assert.equal(r2.perApp[0].reach.listening, true);
      assert.equal(r2.priority[0].listening, true);
    })();
  });

  test('an absent DB stops the lane before any scan — no app rows exist to mislead', async () => {
    const run = (cmd, args) => (cmd === 'grype' && args[0] === 'db'
      ? { status: 1, stdout: 'Status: stale', stderr: '', errCode: null }
      : (() => { throw new Error('nothing else may run'); })());
    const r = runLens({ run, roots: ['/nowhere'] });
    assert.equal(r.state, 'unknown');
    assert.equal(r.perApp, undefined);
  });
});

describe('global npm packages', () => {
  const ok = (stdout) => ({ status: 0, stdout, stderr: '', errCode: null });
  const LS = JSON.stringify({ dependencies: { openclaw: { version: '2026.7.1-2' }, '@scope/tool': { version: '1.2.3' }, npm: { version: '11.0.0' } } });

  test('each package is a subject keyed on its install directory, sorted, scoped names intact', () => {
    const run = (cmd, args) => (args[0] === 'root' ? ok('/g/node_modules\n') : ok(LS));
    const r = collectNpmGlobalPackages({ run });
    assert.deepEqual(r.items.map((i) => i.id), ['/g/node_modules/@scope/tool', '/g/node_modules/npm', '/g/node_modules/openclaw']);
    assert.equal(r.items[2].version, '2026.7.1-2');
    assert.ok(r.items.every((i) => i.kind === 'npm-global'));
  });

  test('npm ls exiting non-zero with valid JSON still parses — peer warnings are not a failure', () => {
    const run = (cmd, args) => (args[0] === 'root' ? ok('/g/node_modules') : { status: 1, stdout: LS, stderr: 'ERESOLVE', errCode: null });
    assert.equal(collectNpmGlobalPackages({ run }).items.length, 3);
  });

  test('npm absent is an absent source; a failing root or unparseable listing is unknown, never empty', () => {
    assert.equal(collectNpmGlobalPackages({ run: () => ({ status: null, stdout: '', stderr: '', errCode: 'ENOENT' }) }).absent, true);
    const noRoot = collectNpmGlobalPackages({ run: () => ({ status: 1, stdout: '', stderr: 'boom', errCode: null }) });
    assert.equal(noRoot.items.length, 0);
    assert.equal(noRoot.unknowns[0].unknownReason, 'tool-failed');
    const garbled = collectNpmGlobalPackages({ run: (cmd, args) => (args[0] === 'root' ? ok('/g/node_modules') : ok('not json')) });
    assert.equal(garbled.unknowns[0].unknownReason, 'unparseable');
  });

  test('the lane: a vulnerable transitive dep of a listening global publishes as priority; a name-prefix neighbour is not listening', async () => {
    const dir = scratch();
    const listeners = join(dir, 'listeners.json');
    writeFileSync(listeners, JSON.stringify([{ pid: 9, command: 'node', args: '/opt/homebrew/opt/node/bin/node /g/node_modules/openclaw/dist/index.js gateway --port 18789', addr: '127.0.0.1', port: 18789 }]));
    const LS2 = JSON.stringify({ dependencies: { openclaw: { version: '2026.7.1-2' }, open: { version: '10.0.0' } } });
    const TRANSITIVE = JSON.stringify({ matches: [{ vulnerability: { id: 'GHSA-fast-uri', severity: 'High' }, artifact: { name: 'fast-uri', version: '3.1.2', type: 'npm' }, matchDetails: [{ type: 'exact-direct-match' }] }] });
    const run = (cmd, args) => {
      if (cmd === 'grype' && args[0] === 'db') return ok('Status: valid');
      if (cmd === 'npm') return args[0] === 'root' ? ok('/g/node_modules\n') : ok(LS2);
      if (cmd === 'syft') return ok(SYFT);
      if (cmd === 'grype') return ok(args[0].includes('sbom:') ? TRANSITIVE : '');
      return { status: null, stdout: '', stderr: '', errCode: 'ENOENT' };
    };
    await env({ CW_APPVULN_KEV: join(dir, 'none.json'), CW_APPVULN_EPSS: join(dir, 'none2.json'), CW_APPVULN_CACHE: join(dir, 'cache'), CW_BIND_LISTENERS: listeners }, async () => {
      const r = runLens({ run, roots: [join(dir, 'NoApps')] });
      assert.equal(r.apps, 0);
      assert.equal(r.npmGlobal, 2);
      const byName = Object.fromEntries(r.perApp.map((a) => [a.name, a]));
      assert.equal(byName.openclaw.kind, 'npm-global');
      assert.equal(byName.openclaw.reach.listening, true);
      assert.equal(byName.open.reach.listening, false, '/g/node_modules/open is a prefix of …/openclaw and must not inherit its socket');
      assert.ok(r.priority.some((p) => p.app === 'openclaw' && p.component === 'fast-uri'));
      assert.ok(!r.priority.some((p) => p.app === 'open'));
    })();
  });

  test('a failing npm listing is an unknown ROW in the lane — counted, never a quiet absence', async () => {
    const dir = scratch();
    const run = (cmd, args) => {
      if (cmd === 'grype' && args[0] === 'db') return ok('Status: valid');
      if (cmd === 'npm') return { status: 1, stdout: '', stderr: 'EACCES', errCode: null };
      return { status: null, stdout: '', stderr: '', errCode: 'ENOENT' };
    };
    const listeners = join(dir, 'l.json');
    writeFileSync(listeners, '[]');
    await env({ CW_APPVULN_CACHE: join(dir, 'cache'), CW_BIND_LISTENERS: listeners }, async () => {
      const r = runLens({ run, roots: [join(dir, 'NoApps')] });
      assert.equal(r.unknowns, 1);
      assert.equal(r.state, 'unknown');
      assert.equal(runLens({ run, roots: [join(dir, 'NoApps')], npmGlobal: false }).npmGlobal, 'skipped');
    })();
  });
});

describe('enrichment loaders', () => {
  test('unreadable KEV/EPSS load as null — unchecked, never empty', async () => {
    const dir = scratch();
    await env({ CW_APPVULN_KEV: join(dir, 'absent.json'), CW_APPVULN_EPSS: join(dir, 'absent2.json') }, async () => {
      assert.equal(loadKevSet(), null);
      assert.equal(loadEpss(), null);
    })();
  });
});
