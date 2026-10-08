// monitor/test/lane-reach.test.mjs — present vs gate-fired vs demonstrably consumed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { reachRows, readOsvConsumption, walkMarkers, gateMarkers, findOsvLog, SKIP, MAX_DEPTH, LANES_UNREAD } from '../lane-reach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the walk mirrors the other two axes — one tree, three lenses', () => {
  const src = readFileSync(join(HERE, '..', 'coverage-manifest.mjs'), 'utf8');
  const m = src.match(/const SKIP = new Set\(\[([\s\S]*?)\]\)/);
  const theirs = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual([...SKIP].sort(), theirs);
  assert.equal(MAX_DEPTH, Number(src.match(/const MAX_DEPTH = (\d+)/)[1]));
});

test('the consumption reader parses the probed 2.5.1 line shape and strips the /src mount', () => {
  const log = [
    'Scanning dir /src',
    'Scanned /src/uv.lock file and found 2 packages',
    'Scanned /src/sub/conan.lock file and found 1 package',
    'No package sources found, --help for usage information.',
  ].join('\n');
  assert.deepEqual([...readOsvConsumption(log)].sort(), ['sub/conan.lock', 'uv.lock']);
  assert.equal(readOsvConsumption('Scanning dir /src\n').size, 0, 'no scanned lines is a real empty, not a parse failure');
});

test('present + gate-fired + log-silent is consumed:false — the conanfile.txt shape, named', () => {
  const rows = reachRows(['conanfile.txt', 'conan.lock'], ['conanfile.txt', 'conan.lock'], new Set(['conan.lock']));
  const byPath = Object.fromEntries(rows.map((r) => [r.manifestPath, r]));
  assert.equal(byPath['conan.lock'].consumed, true);
  assert.equal(byPath['conanfile.txt'].consumed, false, 'the lane ran and did not read it');
  assert.equal(byPath['conanfile.txt'].gateFired, true, 'which is precisely why the row matters');
});

test('no log at all is consumed:null with an unknown reason — not-run is not declined', () => {
  const rows = reachRows(['uv.lock'], ['uv.lock'], null);
  assert.equal(rows[0].consumed, null);
  assert.equal(rows[0].unknown, true);
  assert.equal(rows[0].unknownReason, 'absent');
  assert.equal(rows[0].laneRan, false);
});

test('a file outside the gate vocabulary classifies gateFired:false — the pyproject shape, named', () => {
  // walkMarkers only returns gate-vocabulary files, so this reaches reachRows via a caller that
  // widened the census deliberately; the row still classifies rather than being dropped.
  const rows = reachRows(['pyproject.toml'], ['requirements.txt'], new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gateFired, false);
  assert.equal(rows[0].consumed, false);
});

test('nested markers are found and pathed markers are checked literally', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-reach-'));
  mkdirSync(join(d, 'svc'));
  mkdirSync(join(d, 'node_modules', 'x'), { recursive: true });
  mkdirSync(join(d, 'gradle'));
  writeFileSync(join(d, 'svc', 'uv.lock'), '');
  writeFileSync(join(d, 'node_modules', 'x', 'uv.lock'), '');
  writeFileSync(join(d, 'gradle', 'libs.versions.toml'), '');
  const found = walkMarkers(d, ['uv.lock', 'gradle/libs.versions.toml']);
  assert.deepEqual(found, ['gradle/libs.versions.toml', 'svc/uv.lock'], 'node_modules is never walked; the pathed marker is literal');
});

test('the gate is read from the live manifest and contains what 2026-08-24/26 wired', () => {
  const gate = gateMarkers();
  assert.ok(Array.isArray(gate));
  for (const m of ['uv.lock', 'conan.lock', 'mix.lock', 'Package.resolved']) {
    assert.ok(gate.includes(m), `${m} must be in the deps-osv gate`);
  }
});

test('findOsvLog names the repo in the path — a batch-level log is never attributed to a repo', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-reach-'));
  mkdirSync(join(d, 'sweep-1', 'repoA'), { recursive: true });
  mkdirSync(join(d, 'sweep-2', 'repoA'), { recursive: true });
  writeFileSync(join(d, 'sweep-1', 'osv.log'), 'batch-level');
  writeFileSync(join(d, 'sweep-1', 'repoA', 'osv.log'), 'old');
  writeFileSync(join(d, 'sweep-2', 'repoA', 'osv.log'), 'new');
  assert.match(findOsvLog(d, 'repoA'), /sweep-2\/repoA\/osv\.log$/, 'lexically newest batch wins');
  assert.equal(findOsvLog(d, 'repoB'), null, 'the batch-level log never stands in');
});

test('the unverifiable lanes are declared, with reasons that say what would clear them', () => {
  assert.deepEqual(Object.keys(LANES_UNREAD).sort(), ['deps-jvm', 'deps-reachability']);
  for (const why of Object.values(LANES_UNREAD)) assert.match(why, /probed against real output/);
});
