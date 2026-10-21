import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuggest, aggregate, findObserved, exitCodeFor, EXIT, OBSERVED_FILE } from '../egress-suggest.mjs';
import { validateAllowlist } from '../../bin/lib/egress-conf.mjs';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'egress-suggest.mjs');
const NOW = '2026-10-11T00:00:00.000Z';
const obs = (check, egress, at, destinations) => ({ check, egress, at, mode: 'observe', coverage: 'proxy-honouring clients only', destinations });

function reportsRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-egress-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'sweep-1', 'repo-a'), { recursive: true }); mkdirSync(join(root, 'sweep-2', 'repo-a'), { recursive: true }); mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'sweep-1', 'repo-a', OBSERVED_FILE), JSON.stringify({ lanes: [
    obs('deps-osv', 'registry', '2026-10-09T01:00:00.000Z', [{ host: 'api.osv.dev', port: 443, allowed: 3, denied: 0 }]),
    obs('secrets-trufflehog', 'verifiers', '2026-10-09T01:05:00.000Z', [{ host: 'api.github.com', port: 443, allowed: 1, denied: 0 }, { host: '127.0.0.1', port: 7878, allowed: 0, denied: 0, local: 1 }]),
    { check: 'scan-docker', egress: 'registry', at: '2026-10-09T01:06:00.000Z', destinations: null, unobserved: 'the command runs a container, and the proxy env does not reach inside it' },
  ] }));
  writeFileSync(join(root, 'sweep-2', 'repo-a', OBSERVED_FILE), JSON.stringify(obs('deps-osv', 'registry', '2026-10-10T01:00:00.000Z', [{ host: 'api.osv.dev', port: 443, allowed: 2, denied: 0 }, { host: 'registry.npmjs.org', port: 443, allowed: 1, denied: 0 }])));
  writeFileSync(join(root, 'node_modules', 'x', OBSERVED_FILE), JSON.stringify(obs('ghost', 'registry', NOW, [{ host: 'ignored.example', port: 443, allowed: 1, denied: 0 }])));
  return root;
}

test('observations are aggregated per lane and host with run counts and the window; node_modules and the egress output dir are not read', (t) => {
  const root = reportsRoot(t);
  const found = findObserved(root);
  assert.equal(found.files.length, 2);
  const agg = aggregate(found.files, root);
  assert.deepEqual([agg.runs, agg.failures], [3, []]);
  const osv = agg.lanes.find((l) => l.check === 'deps-osv');
  assert.deepEqual([osv.runs, osv.hosts.map((h) => `${h.host}:${h.allowed}/${h.runs}`)], [2, ['api.osv.dev:5/2', 'registry.npmjs.org:1/1']]);
  assert.deepEqual([osv.hosts[0].firstSeen, osv.hosts[0].lastSeen], ['2026-10-09T01:00:00.000Z', '2026-10-10T01:00:00.000Z']);
});

test('the suggestion is written under the reports root in the allowlist shape, every entry carrying a reason the validator accepts and the word SUGGESTED', (t) => {
  const root = reportsRoot(t);
  const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_NOW: NOW } });
  assert.deepEqual([r.lanes, r.hosts, r.failures, exitCodeFor(r)], [2, 4, [], EXIT.wrote]);
  assert.equal(r.out, join(root, 'egress', 'allowlist.suggested.json'));
  const doc = JSON.parse(readFileSync(r.out, 'utf8'));
  assert.equal(doc.generated, NOW);
  for (const [, lane] of Object.entries(doc.lanes)) {
    assert.doesNotThrow(() => validateAllowlist({ allow: lane.allow }), 'an entry a person copies must already pass the manifest validator');
    for (const a of lane.allow) assert.match(a.why, /^SUGGESTED, not reviewed:/);
  }
  assert.ok(!existsSync(join(root, '..', 'manifests')), 'nothing is written outside the reports root');
  assert.equal(JSON.stringify(runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_NOW: NOW } }).suggestion), JSON.stringify(doc), 'deterministic');
});

test('nothing observed writes nothing and exits 2; an unreadable observation is a failure, not an empty lane', (t) => {
  const empty = mkdtempSync(join(tmpdir(), 'cw-egress-empty-')); t.after(() => rmSync(empty, { recursive: true, force: true }));
  const none = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: empty, CW_NOW: NOW } });
  assert.deepEqual([none.lanes, none.out, exitCodeFor(none)], [0, null, EXIT.nothing]);
  assert.equal(existsSync(join(empty, 'egress')), false);
  const root = reportsRoot(t);
  writeFileSync(join(root, 'sweep-2', 'repo-a', OBSERVED_FILE), '{ broken');
  const bad = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_NOW: NOW } });
  assert.equal(bad.failures.length, 1);
  assert.equal(exitCodeFor(bad), EXIT.nothing, 'a suggestion built on a half-read set is not reported as complete');
  const cli = spawnSync(process.execPath, [TOOL], { encoding: 'utf8', env: { ...process.env, CW_EGRESS_OBSERVED_ROOT: empty, CW_NOW: NOW } });
  assert.equal(cli.status, EXIT.nothing);
  assert.match(cli.stdout, /nothing observed/);
});

test('a local destination is never suggested and is listed as refused; an unobserved lane is counted apart, not as a failure', (t) => {
  const root = reportsRoot(t);
  const r = runSuggest({ env: { CW_EGRESS_OBSERVED_ROOT: root, CW_NOW: NOW } });
  const tr = r.suggestion.lanes['secrets-trufflehog'];
  assert.deepEqual(tr.allow.map((a) => a.host), ['api.github.com']);
  assert.deepEqual(tr.refusedLocal, ['127.0.0.1:7878']);
  assert.deepEqual(r.unobserved, [{ check: 'scan-docker', why: 'the command runs a container, and the proxy env does not reach inside it' }]);
  assert.deepEqual(r.failures, []);
  assert.equal(exitCodeFor(r), EXIT.wrote);
});
