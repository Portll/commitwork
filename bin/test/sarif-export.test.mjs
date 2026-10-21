// The SARIF export (bin/lib/sarif-export.mjs) and `commitwork sarif`, over a fixture scan run: nothing
// here runs a scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRepoSarif, writeRunSarif, repoRelative, commitworkVersion, FINGERPRINT_KEY, SARIF_FILE } from '../lib/sarif-export.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body)); };
const AT = '2026-10-04T00:00:00.000Z';

const osvSarif = (advs) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'osv-scanner', rules: advs.map((a) => ({ id: a.id, shortDescription: { text: `${a.id}: a flaw in ${a.pkg}` },
    properties: { 'security-severity': String(a.cvss) } })) } },
  invocations: [{ executionSuccessful: true }],
  results: advs.map((a) => ({ ruleId: a.id, message: { text: `Package '${a.pkg}@${a.version}' is vulnerable to '${a.id}'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri: a.uri || 'package-lock.json' } } }] })),
}] });
const semgrepSarif = (results) => ({ version: '2.1.0', runs: [{
  tool: { driver: { name: 'semgrep', rules: [...new Set(results.map((r) => r.rule))].map((id) => ({ id })) } },
  invocations: [{ executionSuccessful: true }],
  results: results.map((r) => ({ ruleId: r.rule, level: r.level, message: { text: r.message },
    locations: [{ physicalLocation: { artifactLocation: { uri: r.file }, region: { startLine: r.line } } }],
    ...(r.suppressed ? { suppressions: [{ kind: 'inSource' }] } : {}) })),
}] });

function fixtureRun({ line = 3 } = {}) {
  const run = mkdtempSync(join(tmpdir(), 'cw-sarif-run-'));
  const dir = join(run, 'app');
  write(join(dir, 'summary.md'), '# Security report — app\n\nRepo: `/src/app`\n');
  write(join(dir, 'osv.sarif'), osvSarif([
    { id: 'CVE-2020-0001', pkg: 'big', version: '1.0.0', cvss: 9.8 },
    { id: 'CVE-2020-0004', pkg: 'loose', version: '0.1.0', cvss: 9.1, uri: 'requirements.txt' },
  ]));
  write(join(dir, 'osv-declared.json'), { ran: true, manifests: { 'requirements.txt': { resolved: ['loose@0.1.0'] } } });
  write(join(dir, 'semgrep.sarif'), semgrepSarif([
    { rule: 'r.open', level: 'error', file: 'src/a.js', line, message: 'tainted value reaches eval' },
    { rule: 'r.open', level: 'error', file: 'src/a.js', line: line + 20, message: 'tainted value reaches eval again' },
    { rule: 'r.warn', level: 'warning', file: '/src/app/src/b.js', line: 7, message: 'weak comparison' },
    { rule: 'r.hidden', level: 'error', file: 'src/c.js', line: 9, message: 'reviewed', suppressed: true },
  ]));
  const rows = [{ repo: '/src/app', slug: 'app', commit: 'abc123', cells: {
    'deps-osv': { sev: 'high', summary: '2 advisories' },
    sast: { sev: 'high', summary: '3 (2e/1w)' },
    'dast-nuclei': { sev: 'noscan', summary: 'runtime scanner did not run — no live URL' },
    'sast-opengrep': { sev: 'med', summary: '2', coverage: 'reduced', coverageReason: 'the tool exited 2' },
    'shell-lint': { sev: 'skip', summary: 'no .sh sources' },
  } }];
  return { run, rows };
}
const sarif = (over = {}) => { const { run, rows } = fixtureRun(over); return buildRepoSarif({ row: rows[0], dir: join(run, 'app'), toolVersion: '9.9.9', generatedAt: AT }); };

// Structural check of what SARIF 2.1.0 and GitHub code scanning require of an upload.
function assertValidSarif(doc) {
  assert.equal(doc.version, '2.1.0');
  assert.match(doc.$schema, /sarif-2\.1\.0/);
  assert.ok(Array.isArray(doc.runs) && doc.runs.length === 1);
  const run = doc.runs[0];
  assert.equal(run.tool.driver.name, 'commitwork');
  assert.equal(typeof run.tool.driver.version, 'string');
  assert.match(run.automationDetails.id, /^commitwork\//);
  const ids = run.tool.driver.rules.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort(), 'rules are sorted');
  assert.equal(new Set(ids).size, ids.length, 'rule ids are unique');
  for (const r of run.tool.driver.rules) assert.ok(r.shortDescription.text);
  assert.equal(typeof run.invocations[0].executionSuccessful, 'boolean');
  for (const res of run.results) {
    assert.ok(ids.includes(res.ruleId), `result rule ${res.ruleId} is declared`);
    assert.equal(ids[res.ruleIndex], res.ruleId);
    assert.ok(['error', 'warning', 'note'].includes(res.level));
    assert.ok(res.message.text);
    for (const loc of res.locations || []) {
      const { uri } = loc.physicalLocation.artifactLocation;
      assert.ok(uri && !uri.startsWith('/') && !/^[a-z]+:/i.test(uri), `uri ${uri} is repo-relative`);
      if (loc.physicalLocation.region) assert.ok(loc.physicalLocation.region.startLine >= 1);
    }
  }
}

test('the log is valid SARIF 2.1.0 with one rule per lane rule and severities mapped to levels', () => {
  const doc = sarif();
  assertValidSarif(doc);
  const byRule = doc.runs[0].results.map((r) => [r.ruleId, r.level, r.properties.severity]);
  assert.deepEqual(byRule, [
    ['deps/CVE-2020-0001', 'error', 'crit'],
    ['sastSemgrep/r.open', 'error', 'high'],
    ['sastSemgrep/r.open', 'error', 'high'],
    ['sastSemgrep/r.warn', 'warning', 'med'],
  ]);
});

test('locations are repo-relative with the start line, and an absolute path inside the repo is made relative', () => {
  const locs = sarif().runs[0].results.map((r) => r.locations?.[0]?.physicalLocation);
  assert.deepEqual(locs[0].artifactLocation, { uri: 'package-lock.json', uriBaseId: '%SRCROOT%' });
  assert.equal(locs[0].region, undefined, 'no line is known for a lockfile advisory, so no region');
  assert.deepEqual([locs[1].artifactLocation.uri, locs[1].region.startLine], ['src/a.js', 3]);
  assert.equal(locs[3].artifactLocation.uri, 'src/b.js');
});

test('fingerprints are line-free: moving the code leaves them unchanged, and repeats are told apart', () => {
  const fp = (doc) => doc.runs[0].results.map((r) => r.partialFingerprints[FINGERPRINT_KEY]);
  const a = fp(sarif({ line: 3 }));
  const b = fp(sarif({ line: 40 }));
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length, 'two occurrences of one rule in one file are distinct');
});

test('undetermined and unmeasured results are never results with a level', () => {
  const run = sarif().runs[0];
  assert.ok(!run.results.some((r) => r.ruleId === 'deps/CVE-2020-0004'));
  assert.deepEqual(run.properties.commitwork.undetermined.map((u) => [u.ruleId, u.claimedSeverity]), [['deps/CVE-2020-0004', 'crit']]);
  const notes = run.invocations[0].toolExecutionNotifications.map((n) => `${n.descriptor.id}:${n.level}`);
  assert.deepEqual(notes, ['dast-nuclei:warning', 'sast-opengrep:note']);
  assert.equal(run.invocations[0].executionSuccessful, false, 'a void lane is not a successful full run');
  assert.ok(!run.results.some((r) => r.ruleId.includes('r.hidden')));
  assert.equal(run.properties.commitwork.suppressedInSource, 1);
});

test('the same run gives the same bytes, and the file is written where asked', () => {
  const { run, rows } = fixtureRun();
  const a = writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT });
  const first = readFileSync(a[0].path, 'utf8');
  writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT });
  assert.equal(readFileSync(a[0].path, 'utf8'), first);
  assert.equal(a[0].path, join(run, 'app', SARIF_FILE));
  assert.throws(() => writeRunSarif({ runDir: run, rows: [...rows, { ...rows[0], slug: 'other' }], toolVersion: '1', generatedAt: AT, file: join(run, 'x.sarif') }), /one repository/);
});

test('repoRelative keeps relative paths and refuses ones outside the repository', () => {
  assert.equal(repoRelative('./src/x.js', '/r/app'), 'src/x.js');
  assert.equal(repoRelative('file:///r/app/src/x.js', '/r/app'), 'src/x.js');
  assert.equal(repoRelative('r/app/src/x.js', '/r/app'), 'src/x.js');
  assert.equal(repoRelative('/elsewhere/x.js', '/r/app'), '');
  assert.equal(repoRelative('../x.js', '/r/app'), '');
  assert.equal(repoRelative('src\\win.js', '/r/app'), 'src/win.js');
});

test('`commitwork sarif` writes a log for a finished run, honouring CW_NOW and the package version', () => {
  const { run, rows } = fixtureRun();
  write(join(run, 'scan.json'), { version: 1, baseline: 'x', repos: rows });
  const out = join(run, 'one.sarif');
  const r = spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'sarif', '--from', run, '--out', out],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, CW_NOW: AT, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0', NO_COLOR: '1' } });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(out));
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assertValidSarif(doc);
  assert.equal(doc.runs[0].tool.driver.version, commitworkVersion());
  assert.equal(doc.runs[0].invocations[0].endTimeUtc, AT);
});

// A `run` directory has no scan.json: each lane's status is in checks-status.json beside the reports.
const cliSarif = (run, out) => spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'sarif', '--from', run, '--out', out],
  { encoding: 'utf8', timeout: 60_000, env: { ...process.env, CW_NOW: AT, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0', NO_COLOR: '1' } });

test('`commitwork sarif` over a `run` directory names each lane checks-status.json records as not measured', () => {
  const { run } = fixtureRun();
  write(join(run, 'app', 'checks-status.json'), [
    { check: 'secrets-gitleaks', status: 'noscan', reason: 'tool:gitleaks (not on PATH)' },
    { check: 'actions-zizmor', status: 'fail', reason: 'exited non-zero and wrote no zizmor.sarif — nothing was scanned' },
    { check: 'shell-lint', status: 'skip', reason: 'n/a — no .sh sources' },
    { check: 'sast', status: 'noscan', reason: 'a report exists, so the report decides' },
  ]);
  const out = join(run, 'one.sarif');
  const r = cliSarif(run, out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assertValidSarif(doc);
  const notes = doc.runs[0].invocations[0].toolExecutionNotifications.map((n) => [n.descriptor.id, n.level, n.message.text]);
  assert.deepEqual(notes.filter(([id]) => ['secrets-gitleaks', 'actions-zizmor', 'shell-lint'].includes(id)), [
    ['actions-zizmor', 'warning', 'actions-zizmor: did not measure — exited non-zero and wrote no zizmor.sarif — nothing was scanned'],
    ['secrets-gitleaks', 'warning', 'secrets-gitleaks: did not measure — tool:gitleaks (not on PATH)'],
  ]);
  assert.ok(doc.runs[0].results.some((x) => x.ruleId === 'sastSemgrep/r.open'), 'a lane with a report is read from the report');
  assert.equal(doc.runs[0].invocations[0].executionSuccessful, false);
});

test('a run directory holding only checks-status.json is a run where nothing measured, not an empty directory', () => {
  const run = mkdtempSync(join(tmpdir(), 'cw-sarif-run-'));
  write(join(run, 'app', 'checks-status.json'), [{ check: 'sast', status: 'noscan', reason: 'tool:semgrep (not on PATH)' }]);
  const r = cliSarif(run, join(run, 'one.sarif'));
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const doc = JSON.parse(readFileSync(join(run, 'one.sarif'), 'utf8'));
  assert.deepEqual([doc.runs[0].results.length, doc.runs[0].invocations[0].toolExecutionNotifications.map((n) => n.descriptor.id)], [0, ['sast']]);
});

test('an unreadable checks-status.json is refused, never read as every lane measured', () => {
  for (const body of ['[{"check": "sast"', '{"check": "sast"}']) {
    const { run } = fixtureRun();
    write(join(run, 'app', 'checks-status.json'), body);
    const out = join(run, 'one.sarif');
    const r = cliSarif(run, out);
    assert.equal(r.status, 2, body);
    assert.match(r.stderr, /checks-status\.json .*which lanes measured is unknown, not all of them/);
    assert.ok(!existsSync(out), 'a log was written over an unknown lane record');
  }
});
