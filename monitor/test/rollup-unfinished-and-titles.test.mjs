// The rollup carries what a tool did not finish, and each rule's own title, up from the per-repo
// records to the fleet blocks the panel reads: files read only in part (coverage reduced, counted by
// reason), rules the engine could not evaluate (named, never touching coverage), and one
// {rule: title} map per category beside scannerFindings, with the per-repo copy stripped.
// Harness: self-contained reports root + registry via CW_REGISTRY, as rollup-scanner-findings does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROLLUP = join(CW, 'monitor', 'rollup.mjs');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

const note = (id, text) => ({ descriptor: { id }, level: 'warning', message: { text } });
const semgrepSarif = { runs: [{
  tool: { driver: { name: 'semgrep', rules: [{ id: 'r.one', shortDescription: { text: 'Semgrep Finding: r.one' } }] } },
  invocations: [{ executionSuccessful: true, toolExecutionNotifications: [
    note('Timeout', 'Timeout when running r.one on src/big.rs:\n '),
    note('Internal matching error', 'Internal matching error when running js.pro.only on src/a.ts:\n An error occurred while invoking the Semgrep engine.\n\nmetavariable-name:module(s) operator is only supported in the Pro engine'),
  ] }],
  results: [{ ruleId: 'r.one', level: 'warning', message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.rs' }, region: { startLine: 3 } } }] }],
}] };
const trivySarif = { runs: [{
  tool: { driver: { name: 'Trivy', rules: [{ id: 'DS-0002', name: 'Misconfiguration', shortDescription: { text: "Image user should not be 'root'" }, defaultConfiguration: { level: 'error' } }] } },
  invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }],
  results: [{ ruleId: 'DS-0002', level: 'error', message: { text: 'Specify at least 1 USER command' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'Dockerfile' }, region: { startLine: 1 } } }] }],
}] };
const checksRow = (check) => ({ check, status: 'pass', durationMs: 5, at: '2026-10-01T12:00:01.000Z' });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-unfinished-'));
  const areas = [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true }, { slug: 'u-area', label: 'u', out: 'u-area', members: ['alpha'] }];
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify({ reportsRoot: join(root, 'reports'), monitorOutput: 'primary-area', defaultManifest: 'security-baseline', roots: [], projects: [], areas }));
  for (const a of areas) mkdirSync(join(root, 'reports', a.out), { recursive: true });
  const batch = join(root, 'reports', 'sweep-20261001120000-u-area');
  mkdirSync(join(batch, 'alpha'), { recursive: true });
  writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
    sliceId: 'sweep-20261001120000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
    area: 'u-area', areaOut: 'reports/u-area', startedAt: '2026-10-01T12:00:00.000Z',
    scope: { repos: [{ name: 'alpha', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
  }));
  writeFileSync(join(batch, 'alpha', 'semgrep.sarif'), JSON.stringify(semgrepSarif));
  writeFileSync(join(batch, 'alpha', 'trivy-config.sarif'), JSON.stringify(trivySarif));
  writeFileSync(join(batch, 'alpha', 'checks-status.json'), JSON.stringify(['sast', 'iac-config'].map(checksRow)));
  return { batch, regPath, out: join(root, 'reports', 'u-area') };
}

test('unfinished work and rule titles reach the fleet blocks; the per-repo copies do not ship', () => {
  const { batch, regPath, out } = fixture();
  const r = spawnSync(process.execPath, ['--import', NO_FETCH, ROLLUP, batch],
    { cwd: CW, encoding: 'utf8', env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '' } });
  assert.equal(r.status, 0, r.stderr);
  const raw = readFileSync(join(out, 'rollup.json'), 'utf8');
  const rollup = JSON.parse(raw);
  const sast = rollup.scanners.sastSemgrep;
  assert.equal(sast.coverage, 'reduced', 'a file read in part makes the lane reduced');
  assert.deepEqual(sast.partialAnalysis, { repos: 1, files: 1, byReason: { timeout: 1 } });
  assert.deepEqual(sast.rulesNotEvaluated, { repos: 1, rules: ['js.pro.only'] });
  assert.equal(rollup.scanners.iac.partialAnalysis, undefined, 'absent when nothing was left unread');
  assert.equal(rollup.scanners.iac.rulesNotEvaluated, undefined);
  assert.deepEqual(rollup.scannerRuleTitles.iac, { 'DS-0002': "Image user should not be 'root'" });
  assert.equal(rollup.scannerRuleTitles.sastSemgrep, undefined, 'a title that only restates the id is not a title');
  assert.equal(rollup.scannerFindings.iac[0].title, undefined, 'titles ride beside the rows, never in them');
  assert.doesNotMatch(raw, /"ruleTitles"/, 'the per-repo title map is stripped like the per-repo findings');
  const plan = readFileSync(join(out, 'REMEDIATION.md'), 'utf8');
  assert.match(plan, /\| High \| posture \| Image user should not be 'root' \(`DS-0002`\) \| iac \| 1 \| alpha \| `Dockerfile` \|/,
    'a high configuration finding is listed in the plan by its title');
});
