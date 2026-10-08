// A parser's `skip` is the runner's n/a, never a pass; an SBOM lane that wrote no readable SBOM is a
// void, never n/a. `run` re-read a parser's verdict only on noscan, so parseSbom's skip, returned for
// an unreadable or non-CycloneDX artifact, published as pass. Both halves are pinned in both
// directions: a real n/a is not a failure, and unreadable output is not a pass. gradle-wrapper's
// no-wrapper result, which published as a pass through `ok`, is pinned as the same n/a in both layers.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// A namespace import, so a missing export fails its own test rather than the whole file at load.
import * as cw from '../commitwork.mjs';
import { stripAnsi } from '../lib/theme.mjs';
import { toWireStatus } from '../../monitor/check-vocabulary.mjs';
import { _gradleWrapperCounts, stampUnknown } from '../../monitor/extractors.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-parser-skip-'));
after(() => rmSync(T, { recursive: true, force: true }));

// monitor/rollup.mjs NA_SKIP: a skip reason without this prefix is counted as a blocked skip.
const NA_SKIP = /^n\/a\b/i;
const CDX = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [{ name: 'left-pad', version: '1.3.0' }] };

let n = 0;
const fresh = () => { const d = join(T, `d${n++}`); mkdirSync(d, { recursive: true }); return d; };
const sbomAt = (body) => {
  const d = fresh();
  writeFileSync(join(d, 'sbom.json'), typeof body === 'string' ? body : JSON.stringify(body));
  return d;
};

describe('parseSbom: an SBOM lane that wrote no readable SBOM is a void, not n/a', () => {
  const unreadable = { 'an empty file': '', 'text that is not JSON': 'npm ERR! code ELSPROBLEMS\n', 'JSON that is not an object': '"error"' };
  for (const [what, body] of Object.entries(unreadable)) {
    test(`${what} is noscan`, () => {
      const r = cw.parseReport('sbom', join(sbomAt(body), 'sbom.json'));
      assert.equal(r.sev, 'noscan', JSON.stringify(r));
      assert.equal(r.ok, false);
      assert.match(r.summary, /unreadable/);
    });
  }

  const wrongShape = { 'an error object': { error: 'npm ERR! missing: left-pad@1.3.0' }, 'an array': [], 'an SPDX document': { spdxVersion: 'SPDX-2.3', packages: [] } };
  for (const [what, body] of Object.entries(wrongShape)) {
    test(`${what} is noscan, not a CycloneDX document`, () => {
      const r = cw.parseReport('sbom', join(sbomAt(body), 'sbom.json'));
      assert.equal(r.sev, 'noscan', JSON.stringify(r));
      assert.match(r.summary, /not a CycloneDX document/);
    });
  }

  test('the classifier keeps the parser\'s reason', () => {
    const d = sbomAt({ error: 'x' });
    const v = cw.classifyReport({ id: 'sbom', report: { file: 'sbom.json', format: 'sbom' } }, d, d);
    assert.equal(v.sev, 'noscan');
    assert.match(v.summary, /not a CycloneDX document/);
  });

  test('control: a CycloneDX document reads ok, with components or with none', () => {
    assert.equal(cw.parseReport('sbom', join(sbomAt(CDX), 'sbom.json')).sev, 'ok');
    const empty = cw.parseReport('sbom', join(sbomAt({ bomFormat: 'CycloneDX', specVersion: '1.5' }), 'sbom.json'));
    assert.equal(empty.sev, 'ok');
    assert.equal(empty.empty, true);
  });
});

describe('applyReportVerdict: the one place a parser verdict moves a shell pass', () => {
  const pass = () => ({ id: 'x', status: 'pass' });

  test('skip is the runner\'s n/a: skipped, wired as skip, with a reason the rollup reads as n/a', () => {
    const r = cw.applyReportVerdict(pass(), { sev: 'skip', summary: 'no subject here' });
    assert.equal(r.status, 'skipped');
    assert.equal(toWireStatus(r.status), 'skip');
    assert.match(r.reason, NA_SKIP);
    assert.match(r.reason, /no subject here/);
  });

  test('noscan is a void carrying its reason and blocked flag', () => {
    const r = cw.applyReportVerdict(pass(), { sev: 'noscan', summary: 'token unset', blocked: true });
    assert.deepEqual([r.status, r.reason, r.blocked], ['noscan', 'token unset', true]);
  });

  test('ok stays a pass; an empty-but-complete answer carries its words', () => {
    assert.equal(cw.applyReportVerdict(pass(), { sev: 'ok', summary: '3 components' }).status, 'pass');
    const e = cw.applyReportVerdict(pass(), { sev: 'ok', summary: '0 components', empty: true });
    assert.deepEqual([e.status, e.reason], ['pass', '0 components']);
  });
});

// ── the real CLI ────────────────────────────────────────────────────────────────────────────────
// The n/a run swaps parseSbom for a stub returning skip, at load time and only for commitwork.mjs's
// import, so the runner's mapping is held apart from any one parser's n/a (gradle-wrapper's is below,
// jackson-guard's in jackson-guard-lane.test.mjs). The lane still writes a VALID SBOM: if the swap
// ever stops applying, the real parser reads it as a pass and the n/a assertions fail.
const HAS_HOOKS = typeof nodeModule.registerHooks === 'function';

function skipHook(d) {
  const real = pathToFileURL(join(CW, 'bin', 'lib', 'report-parsers', 'supply-chain.mjs')).href;
  const stub = join(d, 'sbom-skip.mjs');
  writeFileSync(stub, `export * from ${JSON.stringify(real)};\n`
    + 'export function parseSbom() { return { ok: false, sev: \'skip\', summary: \'stub: no subject for this lane\' }; }\n');
  const hook = join(d, 'hook.mjs');
  writeFileSync(hook, `import { registerHooks } from 'node:module';
const STUB = ${JSON.stringify(pathToFileURL(stub).href)};
registerHooks({
  resolve(s, c, next) {
    if (s === './lib/report-parsers/supply-chain.mjs' && String(c.parentURL || '').endsWith('/bin/commitwork.mjs')) return { url: STUB, shortCircuit: true };
    return next(s, c);
  },
});
`);
  return pathToFileURL(hook).href;
}

function setup(body) {
  const d = fresh();
  const repo = join(d, 'roots', 'fixture-repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.txt'), 'fixture\n');
  spawnSync('git', ['init', '-q', repo]);
  const fixture = join(d, 'sbom-body.json');
  writeFileSync(fixture, JSON.stringify(body));
  const manifest = join(d, 'm.json');
  writeFileSync(manifest, JSON.stringify({ repo: 'fixture', groups: { all: ['sbom'] }, checks: [{
    id: 'sbom', local: [`cp '${fixture}' "$CW_REPORT_DIR/sbom.json"; echo 0 > "$CW_REPORT_DIR/sbom.json.exit"`],
    report: { file: 'sbom.json', format: 'sbom' } }] }));
  const env = { ...process.env, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0', FORCE_COLOR: '0',
    COMMITWORK_TRUST_REPO_MANIFEST: '1', CW_SCAN_CONFIG: join(d, 'no-scan-config.json'), CW_PERF_FEEDBACK: join(d, 'perf.jsonl') };
  return { d, repo, manifest, env };
}

function run(body, { hook = false } = {}) {
  const { d, repo, manifest, env } = setup(body);
  const reports = join(d, 'reports');
  mkdirSync(reports);
  const r = spawnSync(process.execPath, [...(hook ? ['--import', skipHook(d)] : []), CLI, 'run', 'all', '--manifest', manifest, '--repo', repo],
    { cwd: d, encoding: 'utf8', env: { ...env, CW_REPORT_DIR: reports } });
  const out = stripAnsi(`${r.stdout}${r.stderr}`);
  let rows;
  try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
  catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${out}`); }
  return { code: r.status, out, row: rows.find((x) => x.check === 'sbom') };
}

describe('commitwork run publishes a parser\'s verdict, not the shell exit', () => {
  test('an SBOM lane that wrote an error object is noscan, not pass', () => {
    const { row, out } = run({ error: 'npm ERR! missing: left-pad@1.3.0' });
    assert.equal(row.status, 'noscan', `${JSON.stringify(row)}\n${out}`);
    assert.match(row.reason, /not a CycloneDX document/);
    assert.match(out, /0 passed/);
    assert.match(out, /1 noscan/);
  });

  test('control: a valid CycloneDX SBOM is a pass', () => {
    const { row, code } = run(CDX);
    assert.equal(row.status, 'pass', JSON.stringify(row));
    assert.equal(code, 0);
  });

  test('a parser\'s skip is published as n/a: skip on the wire, exit 0, no coverage, never pass', { skip: !HAS_HOOKS && 'module.registerHooks is absent on this Node' }, () => {
    const { row, code, out } = run(CDX, { hook: true });
    assert.equal(row.status, 'skip', `${JSON.stringify(row)}\n${out}`);
    assert.match(row.reason, NA_SKIP);
    assert.match(row.reason, /stub: no subject for this lane/, 'the stub parser must be the one that ran');
    assert.equal('coverage' in row, false, 'an n/a row carries no coverage, as an appliesIf miss does not');
    assert.equal(code, 0, 'a real n/a is not a failure');
    assert.match(out, /· n\/a — stub: no subject for this lane/);
    assert.match(out, /0 passed/);
    assert.match(out, /1 skipped/);
  });

  test('scan writes a parser\'s skip as n/a: the n/a glyph and cell, no coverage', { skip: !HAS_HOOKS && 'module.registerHooks is absent on this Node' }, () => {
    const { d, manifest, env } = setup(CDX);
    const outDir = join(d, 'scan-out');
    const r = spawnSync(process.execPath, ['--import', skipHook(d), CLI, 'scan', '--manifest', manifest, '--root', join(d, 'roots'), '--out', outDir],
      { cwd: d, encoding: 'utf8', env });
    const out = stripAnsi(`${r.stdout}${r.stderr}`);
    let scan;
    try { scan = JSON.parse(readFileSync(join(outDir, 'scan.json'), 'utf8')); }
    catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${out}`); }
    const cell = scan.repos[0].cells.sbom;
    assert.equal(cell.sev, 'skip', JSON.stringify(cell));
    assert.equal('coverage' in cell, false);
    const line = out.split('\n').find((l) => l.startsWith('▸ fixture-repo')) || '';
    assert.match(line, /▸ fixture-repo ·/, `progress line: ${line}`);
    assert.match(readFileSync(join(outDir, 'fixture-repo', 'summary.md'), 'utf8'), /\| sbom \| n\/a \| stub: no subject for this lane \|/);
  });
});

// ── gradle-wrapper: no wrapper is n/a in the runner and nosrc in the rollup ─────────────────────
describe('gradle-wrapper: a repo with no wrapper is n/a in both layers, never a pass', () => {
  const NONE = { ran: true, applicable: false, findings: [], reason: 'no gradlew and no wrapper properties' };
  const read = (body) => {
    const d = fresh();
    writeFileSync(join(d, 'gradle-wrapper.json'), JSON.stringify(body));
    const rollup = _gradleWrapperCounts(d, 'gradle-wrapper.json');
    return { run: cw.classifyReport({ id: 'gradle-wrapper', report: { file: 'gradle-wrapper.json', format: 'gradle-wrapper' } }, d, d),
      rollup: rollup && stampUnknown(rollup) };
  };

  test('applicable:false is skip in the runner and no-subject in the rollup', () => {
    const { run, rollup } = read(NONE);
    assert.equal(run.sev, 'skip', JSON.stringify(run));
    assert.match(run.summary, /no Gradle wrapper/);
    assert.equal(rollup.nosrc, true);
    assert.equal(rollup.unknownReason, 'no-subject');
  });

  test('control: an examined wrapper with no findings is ok in the runner and a clean result in the rollup', () => {
    const { run, rollup } = read({ ran: true, applicable: true, findings: [] });
    assert.equal(run.sev, 'ok');
    assert.equal(rollup.total, 0);
    assert.notEqual(rollup.unknown, true);
  });

  test('ran:false stays a void in the runner, not n/a', () => {
    assert.equal(read({ ran: false, reason: 'crashed' }).run.sev, 'noscan');
  });

  test('the shipped lane on a Gradle repo with no wrapper publishes n/a, exit 0', () => {
    const BASELINE = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
    const LANE = BASELINE.checks.find((c) => c.id === 'gradle-wrapper');
    const d = fresh();
    const repo = join(d, 'repo');
    mkdirSync(repo);
    writeFileSync(join(repo, 'build.gradle'), "plugins { id 'java' }\n");
    const reports = join(d, 'reports');
    mkdirSync(reports);
    const manifest = join(d, 'm.json');
    writeFileSync(manifest, JSON.stringify({ repo: 'fixture', checks: [LANE] }));
    const r = spawnSync(process.execPath, [CLI, 'run', LANE.id, '--manifest', manifest, '--repo', repo, '--no-fail-fast'],
      { cwd: d, encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off',
        CW_ASSERT_TREE: '0', CW_SELF_SWEEP: '0', CW_PERF_FEEDBACK: join(d, 'perf.jsonl'), FORCE_COLOR: '0' } });
    let rows;
    try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
    catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const row = rows.find((x) => x.check === LANE.id);
    assert.equal(row.status, 'skip', JSON.stringify(row));
    assert.match(row.reason, /^n\/a — no Gradle wrapper/);
    assert.equal(r.status, 0, 'a real n/a is not a failure');
    assert.equal(_gradleWrapperCounts(reports, LANE.report.file).nosrc, true, 'the rollup reads the same artifact as nothing to scan');
  });
});
