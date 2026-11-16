// A lane that declares report.exitCodes is read by them, so an unmeasured exit is never a pass.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReport, laneCoverage, validateManifest, applyReportVerdict, parseReport } from '../commitwork.mjs';
import { exitCodeFor } from '../wp-dynamic-witness.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXIT_CODES = {
  0: { outcome: 'measured', meaning: 'every trial measured' },
  3: { outcome: 'unmeasured', meaning: 'no consent to run repository code' },
  4: { outcome: 'unmeasured', meaning: 'the plugin could not be installed' },
};
const CHECK = (report = {}) => ({ id: 'declared-lane', report: { file: 'out.json', format: 'generic', exitCodes: EXIT_CODES, ...report } });

function inDir(files, fn) {
  const d = mkdtempSync(join(tmpdir(), 'cw-exit-codes-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    return fn(d);
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const classify = (files, check = CHECK()) => inDir(files, (d) => classifyReport(check, d, d));
const coverage = (files, check = CHECK()) => inDir(files, (d) => laneCoverage(check, d));

describe('classifyReport reads a declared exit code', () => {
  test('an unmeasured code on a pass-through report is noscan with its declared meaning', () => {
    const r = classify({ 'out.json': '{}', 'out.json.exit': '4\n' });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /exited 4: the plugin could not be installed/);
    assert.deepEqual(r.exit, { code: 4, outcome: 'unmeasured', meaning: 'the plugin could not be installed' });
  });

  test('a measured code keeps the existing verdict and records the code', () => {
    const r = classify({ 'out.json': '{}', 'out.json.exit': '0\n' });
    assert.equal(r.sev, 'ok');
    assert.deepEqual(r.exit, { code: 0, outcome: 'measured', meaning: 'every trial measured' });
  });

  test('a code the lane does not declare is noscan and lists the declared ones', () => {
    const r = classify({ 'out.json': '{}', 'out.json.exit': '7\n' });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /exited 7, which is not one of its declared exit codes \(0, 3, 4\)/);
    assert.equal(r.exit.outcome, 'undeclared');
  });

  test('a shell code is named: 127 not found, 126 not executable, 128+n by its signal', () => {
    assert.match(classify({ 'out.json': '{}', 'out.json.exit': '127' }).summary, /exited 127 \(command not found\)/);
    assert.match(classify({ 'out.json': '{}', 'out.json.exit': '126' }).summary, /exited 126 \(command not executable\)/);
    const killed = classify({ 'out.json': '{}', 'out.json.exit': '137' });
    assert.match(killed.summary, /exited 137 \(killed by SIGKILL\)/);
    assert.equal(killed.exit.meaning, 'killed by SIGKILL');
  });

  test('a missing sidecar beside a report is noscan, never the declared measured code', () => {
    const r = classify({ 'out.json': '{}' });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /no exit code was recorded/);
    assert.equal(r.exit.code, null);
    assert.equal(r.exit.outcome, 'unrecorded');
  });

  test('a sidecar that is not an exit code is noscan and quotes what it holds', () => {
    const r = classify({ 'out.json': '{}', 'out.json.exit': 'Killed\n' });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /"Killed"/);
    assert.equal(r.exit.outcome, 'unrecorded');
  });

  test('a missing report keeps the absent-tool reason and adds what the exit code says', () => {
    const r = classify({ 'out.json.exit': '3\n' });
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /no output \(tool absent\/failed\); exited 3: no consent to run repository code/);
  });

  test('findings beside an unmeasured code keep their severity', () => {
    const sarif = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 't', rules: [] } }, invocations: [{ executionSuccessful: true }],
      results: [{ ruleId: 'r', level: 'error', message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 1 } } }] }] }] });
    const r = classify({ 'out.sarif': sarif, 'out.sarif.exit': '4\n' }, CHECK({ file: 'out.sarif', format: 'sarif' }));
    assert.notEqual(r.sev, 'noscan');
    assert.equal(r.exit.outcome, 'unmeasured');
  });

  test('a lane without a declaration is unchanged and carries no exit field', () => {
    const r = classify({ 'out.json': '{}', 'out.json.exit': '4\n' }, { id: 'x', report: { file: 'out.json', format: 'generic' } });
    assert.equal(r.sev, 'ok');
    assert.equal(r.exit, undefined);
  });
});

describe('applyReportVerdict carries the exit onto the run result', () => {
  test('a noscan verdict sets status, reason and exit', () => {
    const exit = { code: 4, outcome: 'unmeasured', meaning: 'm' };
    const res = applyReportVerdict({ status: 'pass', reason: 'exit 0' }, { sev: 'noscan', summary: 'exited 4: m', exit });
    assert.equal(res.status, 'noscan');
    assert.equal(res.reason, 'exited 4: m');
    assert.deepEqual(res.exit, exit);
  });

  test('a measured pass gets the classifier reason in place of the shell exit', () => {
    const exit = { code: 0, outcome: 'measured', meaning: 'm' };
    const res = applyReportVerdict({ status: 'pass', reason: 'exit 0' }, { sev: 'ok', summary: 'written', exit });
    assert.equal(res.status, 'pass');
    assert.equal(res.reason, 'written');
    assert.deepEqual(res.exit, exit);
  });
});

describe('laneCoverage reads a declared exit code', () => {
  test('a measured code above 1 does not reduce coverage', () => {
    const check = CHECK({ exitCodes: { ...EXIT_CODES, 5: { outcome: 'measured', meaning: 'reported findings' } } });
    assert.equal(coverage({ 'out.json': '{}', 'out.json.exit': '5\n' }, check).coverage, 'full');
  });

  test('an unmeasured exit 1 reduces coverage, which the undeclared rule never did', () => {
    const check = CHECK({ exitCodes: { 0: EXIT_CODES[0], 1: { outcome: 'unmeasured', meaning: 'the test failed or errored' } } });
    const r = coverage({ 'out.json': '{}', 'out.json.exit': '1\n' }, check);
    assert.equal(r.coverage, 'reduced');
    assert.equal(r.coverageReason, 'the tool exited 1: the test failed or errored');
    assert.equal(r.coverageBasis, 'exit-code');
  });

  test('an undeclared code reduces coverage and says it is undeclared', () => {
    const r = coverage({ 'out.json': '{}', 'out.json.exit': '9\n' });
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /exited 9, which is not one of its declared exit codes/);
  });

  test('a missing sidecar beside a report leaves coverage unknown', () => {
    const r = coverage({ 'out.json': '{}' });
    assert.equal(r.coverage, 'unknown');
    assert.match(r.coverageReason, /no exit code was recorded/);
  });
});

describe('validateManifest refuses a malformed exitCodes declaration', () => {
  const manifest = (report) => ({ repo: 'x', checks: [{ id: 'x', local: ['true'], report: { file: 'x.json', format: 'generic', ...report } }] });
  const errs = (report) => validateManifest(manifest(report)).errors.filter((e) => /exitCodes/.test(e));

  test('a well-formed declaration validates', () => {
    assert.deepEqual(validateManifest(manifest({ exitCodes: EXIT_CODES })).errors, []);
  });

  for (const [label, exitCodes] of [
    ['an array', [0]],
    ['an empty object', {}],
    ['a key above 255', { 0: EXIT_CODES[0], 256: EXIT_CODES[3] }],
    ['a non-decimal key', { 0: EXIT_CODES[0], '03': EXIT_CODES[3] }],
    ['an unknown outcome', { 0: { outcome: 'failed', meaning: 'm' } }],
    ['an empty meaning', { 0: { outcome: 'measured', meaning: ' ' } }],
    ['an extra field', { 0: { outcome: 'measured', meaning: 'm', severity: 'high' } }],
    ['no measured code', { 3: EXIT_CODES[3] }],
  ]) test(`refuses ${label}`, () => assert.ok(errs({ exitCodes }).length, `${label} must be refused`));

  test('a findingsExit code must be declared measured', () => {
    assert.ok(errs({ format: 'retire', findingsExit: [13], exitCodes: EXIT_CODES }).length);
    assert.ok(errs({ format: 'retire', findingsExit: [3], exitCodes: EXIT_CODES }).length);
    assert.deepEqual(errs({ format: 'retire', findingsExit: [13], exitCodes: { ...EXIT_CODES, 13: { outcome: 'measured', meaning: 'f' } } }), []);
  });
});

describe('the wp-witness report format', () => {
  const report = (over) => JSON.stringify({ tool: 'wp-dynamic-witness', summary: { confirmed: 0, unattributedChange: 0, exercisedNoEffect: 0, notExercised: 0, notMeasured: 0 }, entryCounts: { exercised: 3 }, findings: [], ...over });
  const parse = (body) => inDir({ 'w.json': body }, (d) => parseReport('wp-witness', join(d, 'w.json')));

  test('findings are high and counted', () => {
    const r = parse(report({ status: 'findings', summary: { confirmed: 2, unattributedChange: 0, exercisedNoEffect: 1, notExercised: 0, notMeasured: 0 }, findings: [{ key: 'a' }, { key: 'b' }] }));
    assert.equal(r.sev, 'high');
    assert.equal(r.total, 2);
    assert.match(r.summary, /2 confirmed/);
  });

  test('no confirmed change is ok with zero findings and names what it measured', () => {
    const r = parse(report({ status: 'no-confirmed-change', summary: { confirmed: 0, unattributedChange: 0, exercisedNoEffect: 4, notExercised: 1, notMeasured: 0 } }));
    assert.equal(r.sev, 'ok');
    assert.equal(r.total, 0);
    assert.match(r.summary, /4 exercised with no effect/);
  });

  test('undetermined is noscan and keeps its counts', () => {
    const r = parse(report({ status: 'undetermined', summary: { confirmed: 0, unattributedChange: 2, exercisedNoEffect: 0, notExercised: 0, notMeasured: 1 } }));
    assert.equal(r.sev, 'noscan');
    assert.equal(r.undetermined, 3);
    assert.match(r.summary, /2 unattributed/);
  });

  for (const status of ['noscan', 'could-not-install', 'error']) test(`${status} is noscan with the report's reason`, () => {
    const r = parse(report({ status, reason: `because ${status}` }));
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, new RegExp(`because ${status}`));
  });

  test('an unknown status or a non-JSON body is not read as clean', () => {
    assert.equal(parse(report({ status: 'clean' })).ok, false);
    assert.equal(parse('not json').ok, false);
  });
});

describe('the shipping declarations', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
  const check = (id) => m.checks.find((c) => c.id === id);

  test('wp-dynamic-witness declares every code its tool can exit with', () => {
    const c = check('wp-dynamic-witness');
    assert.equal(c.report.format, 'wp-witness');
    const fromTool = new Set([0, 1, 2, ...['findings', 'no-confirmed-change', 'noscan', 'could-not-install', 'error', 'undetermined'].map(exitCodeFor)]);
    assert.deepEqual(Object.keys(c.report.exitCodes).map(Number).sort((a, b) => a - b), [...fromTool].sort((a, b) => a - b));
    const header = readFileSync(join(ROOT, 'bin', 'wp-dynamic-witness.mjs'), 'utf8').match(/^\/\/ exit:([\s\S]*?)\n(?!\/\/ {6})/m);
    assert.ok(header, 'the witness documents its exit codes in a // exit: header');
    const documented = [...header[1].matchAll(/(?:^|·)\s*(\d+)\s/g)].map((x) => Number(x[1])).sort((a, b) => a - b);
    assert.deepEqual(documented, [...fromTool].sort((a, b) => a - b));
  });

  test('wp-dynamic-witness: could-not-install is noscan with the report reason, never a pass', () => {
    const c = check('wp-dynamic-witness');
    const r = classify({ 'wp-witness.json': JSON.stringify({ tool: 'wp-dynamic-witness', status: 'could-not-install', reason: 'plugin did not activate', summary: {}, findings: [] }), 'wp-witness.json.exit': '4\n' }, c);
    assert.equal(r.sev, 'noscan');
    assert.match(r.summary, /exited 4: .*plugin did not activate/);
  });

  test('authz-test declares 0 measured and 1 unmeasured', () => {
    const c = check('authz-test');
    assert.equal(c.report.exitCodes['0'].outcome, 'measured');
    assert.equal(c.report.exitCodes['1'].outcome, 'unmeasured');
  });

  test('the shipping manifest validates', () => {
    assert.deepEqual(validateManifest(m).errors, []);
  });
});
