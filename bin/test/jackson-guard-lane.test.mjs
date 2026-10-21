// The jackson-caseinsensitive-guard lane, through both of its readers. Its report was declared
// 'generic', a pass-through that scored ok whatever the file said, so a violation (exit 1) never
// moved the lane and the GUARD_FAIL marker the command appended was read by nothing.
//
// Pins every state the guard can leave in the runner (parseReport/classifyReport) and the rollup
// (_jacksonGuardCounts), that the two never disagree, and the shipped lane run for real. Report text
// is synthetic and follows bin/guard-jackson-caseinsensitive.mjs's own lines.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReport, classifyReport } from '../commitwork.mjs';
import { _jacksonGuardCounts, stampUnknown } from '../../monitor/extractors.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = mkdtempSync(join(tmpdir(), 'cw-jackson-lane-'));
after(() => rmSync(T, { recursive: true, force: true }));

const CHECK = { id: 'jackson-caseinsensitive-guard', report: { file: 'jackson-guard.txt', format: 'jackson-guard' } };
let n = 0;
// a report dir as the lane leaves it; `exit` null writes no sidecar
function reportDir(text, exit) {
  const d = join(T, `r${n++}`);
  mkdirSync(d);
  if (text !== null) writeFileSync(join(d, 'jackson-guard.txt'), text);
  if (exit !== null) writeFileSync(join(d, 'jackson-guard.txt.exit'), `${exit}\n`);
  return d;
}
const read = (text, exit) => {
  const d = reportDir(text, exit);
  const rollup = _jacksonGuardCounts(d, 'jackson-guard.txt');
  return { run: classifyReport(CHECK, d, d), parsed: parseReport('jackson-guard', join(d, 'jackson-guard.txt')),
    rollup: rollup && stampUnknown(rollup) };
};

const P = 'guard-jackson-caseinsensitive: ';
const OK = `${P}OK — ACCEPT_CASE_INSENSITIVE_PROPERTIES not enabled in 7 scanned file(s) under . (CVE-2026-54515 unreachable here).\n`;
const SKIPPED = `${P}SKIPPED — no .java/.yml/.properties files under . (nothing scanned; this is NOT a clean result).\n`;
const FAILED = 'GUARD FAILED — ACCEPT_CASE_INSENSITIVE_PROPERTIES enabled (opens jackson CVE-2026-54515):\n'
  + '  src/main/resources/application.yml:4: accept-case-insensitive-properties: true\n'
  + '  src/main/java/app/Config.java:3: m.configure(MapperFeature.ACCEPT_CASE_INSENSITIVE_PROPERTIES, true);\n';
const UNREADABLE = `${P}UNREADABLE — 1 path(s) under . could not be read, and any of them may enable the feature (5 file(s) scanned is NOT a clean result):\n  config/app.yml: EACCES\n`;
const NOT_RUN = `${P}NOT RUN — . could not be read (ENOENT); nothing was scanned and this is NOT a clean result.\n`;
const CRASH = 'file:///cw/bin/guard-jackson-caseinsensitive.mjs:40\nTypeError: boom\n    at walk (file:///cw/bin/guard-jackson-caseinsensitive.mjs:40:5)\n';

const isClean = (c) => !!c && c.ran === true && c.total === 0 && !c.unknown;

describe('the runner and the rollup read each state the guard can leave', () => {
  test('exit 0 with OK and a scanned count is the one clean state, and carries its count', () => {
    const { run, rollup } = read(OK, 0);
    assert.equal(run.sev, 'ok');
    assert.match(run.summary, /7 file\(s\) scanned/);
    assert.ok(isClean(rollup), JSON.stringify(rollup));
    assert.equal(rollup.filesScanned, 7);
  });

  test('exit 1 with GUARD FAILED is one med finding per enabling line, in both readers', () => {
    const { run, parsed, rollup } = read(FAILED, 1);
    assert.equal(run.sev, 'med');
    assert.equal(parsed.total, 2);
    assert.match(run.summary, /2 line\(s\) enable ACCEPT_CASE_INSENSITIVE_PROPERTIES: src\/main\/java\/app\/Config\.java:3, src\/main\/resources\/application\.yml:4/);
    assert.equal(rollup.med, 2);
    assert.equal(rollup.total, 2);
    assert.equal(rollup.crit + rollup.high + rollup.low, 0);
    assert.deepEqual(rollup.findings.map((r) => [r.rule, r.file, r.line, r.sev]), [
      ['jackson-case-insensitive-enabled', 'src/main/java/app/Config.java', 3, 'med'],
      ['jackson-case-insensitive-enabled', 'src/main/resources/application.yml', 4, 'med'],
    ]);
    for (const r of rollup.findings) assert.doesNotMatch(r.message, /configure\(|: true/, 'the matched line stays in the artifact');
  });

  test('a violation beside an unreadable path keeps both facts', () => {
    const { run, rollup } = read(FAILED + UNREADABLE, 1);
    assert.equal(run.sev, 'med');
    assert.match(run.summary, /; 1 unreadable path\(s\) undetermined$/);
    assert.equal(rollup.med, 2);
    assert.equal(rollup.unreadable, 1);
  });

  test('exit 1 without a path:line is a crash, never a violation', () => {
    for (const text of [CRASH, 'GUARD FAILED — ACCEPT_CASE_INSENSITIVE_PROPERTIES enabled (opens jackson CVE-2026-54515):\n']) {
      const { run, rollup } = read(text, 1);
      assert.equal(run.sev, 'noscan', text);
      assert.match(run.summary, /a crash exits 1 as well/);
      assert.equal(rollup.total, 0);
      assert.equal(rollup.unparseable, true);
      assert.equal(rollup.unknownReason, 'unparseable');
    }
  });

  test('exit 2 is undetermined: UNREADABLE and NOT RUN neither pass nor find', () => {
    const u = read(UNREADABLE, 2);
    assert.equal(u.run.sev, 'noscan');
    assert.match(u.run.summary, /^1 path\(s\) could not be read.*\(5 file\(s\) scanned\); not a clean result$/);
    assert.equal(u.rollup.toolfailed, true);
    assert.equal(u.rollup.unreadable, 1);
    assert.equal(u.rollup.filesScanned, 5);
    assert.equal(u.rollup.total, 0);
    assert.equal(u.rollup.unknown, true);

    const r = read(NOT_RUN, 2);
    assert.equal(r.run.sev, 'noscan');
    assert.match(r.run.summary, /could not read its root/);
    assert.equal(r.rollup.toolfailed, true);
    assert.equal(r.rollup.unknownReason, 'not-run');
  });

  test('SKIPPED is nothing to guard: n/a in the runner, nosrc in the rollup, never ok and never a void', () => {
    const { run, parsed, rollup } = read(SKIPPED, 0);
    assert.equal(run.sev, 'skip');
    assert.match(run.summary, /no \.java\/\.yml\/\.properties files to guard/);
    assert.notEqual(parsed.nosrc, true, 'the runner reads nosrc as "ran, no source matched", a void');
    assert.equal(rollup.nosrc, true);
    assert.equal(rollup.unknownReason, 'no-subject');
    assert.equal(rollup.total, 0);
  });

  test('a missing or empty report, or a missing exit code, is undetermined', () => {
    const missing = reportDir(null, null);
    assert.equal(classifyReport(CHECK, missing, missing).sev, 'noscan');
    assert.equal(_jacksonGuardCounts(missing, 'jackson-guard.txt'), null, 'absent reads through checks-status, like every lane');

    const empty = read('', 0);
    assert.equal(empty.run.sev, 'noscan');
    assert.equal(empty.rollup.unknownReason, 'empty');

    const unwitnessed = read(OK, null);
    assert.equal(unwitnessed.run.sev, 'noscan', 'an OK line with no exit code beside it is unwitnessed');
    assert.match(unwitnessed.run.summary, /no exit code was recorded/);
    assert.equal(unwitnessed.rollup.unknownReason, 'not-recorded');

    assert.equal(read(OK, 'x').run.sev, 'noscan', 'a sidecar that holds no exit code witnesses nothing');
  });

  test('the exit code and the text must agree, or the lane is undetermined', () => {
    const cases = [
      [OK, 1, /exited 1 without a GUARD FAILED/], [OK, 2, /neither an UNREADABLE nor a NOT RUN/],
      [FAILED, 0, /exited 0 beside a failure line/], [FAILED, 2, /exited 2/], [OK, 127, /exited 127/],
      [OK + SKIPPED, 0, /no OK or SKIPPED line/],
      [`${P}OK — ACCEPT_CASE_INSENSITIVE_PROPERTIES not enabled in 0 scanned file(s) under .\n`, 0, /names no scanned file/],
    ];
    for (const [text, exit, why] of cases) {
      const { run, rollup } = read(text, exit);
      assert.equal(run.sev, 'noscan', `${exit}: ${text.slice(0, 40)}`);
      assert.match(run.summary, why);
      assert.equal(rollup.total, 0);
      assert.equal(rollup.unknown, true);
    }
  });

  test('the two readers never disagree on a verdict', () => {
    const states = [[OK, 0], [FAILED, 1], [FAILED + UNREADABLE, 1], [UNREADABLE, 2], [NOT_RUN, 2], [SKIPPED, 0],
      [CRASH, 1], ['', 0], [OK, null], [OK, 1], [FAILED, 0], [OK, 137]];
    for (const [text, exit] of states) {
      const { run, rollup } = read(text, exit);
      const at = `${exit} ${text.slice(0, 30)}`;
      // The rollup has no n/a of its own: nothing to scan is an unknown whose reason is no-subject.
      const na = rollup.unknownReason === 'no-subject';
      assert.equal(run.sev === 'ok', isClean(rollup), `clean in one reader only: ${at}`);
      assert.equal(run.sev === 'med', rollup.med > 0, `a finding in one reader only: ${at}`);
      assert.equal(run.sev === 'skip', na, `n/a in one reader only: ${at}`);
      assert.equal(run.sev === 'noscan', rollup.unknown === true && !na, `a void in one reader only: ${at}`);
    }
  });
});

describe('the shipped lane, run for real', () => {
  const BASELINE = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
  const LANE = BASELINE.checks.find((c) => c.id === 'jackson-caseinsensitive-guard');
  const MANIFEST = join(T, 'm.json');
  writeFileSync(MANIFEST, JSON.stringify({ repo: 'fixture', checks: [LANE] }));
  // NTFS cannot deny the owner by mode, and root reads through a 000 mode anyway
  const CAN_DENY = process.platform !== 'win32' && process.getuid?.() !== 0;

  function run(files, { lock = [] } = {}) {
    const repo = join(T, `repo${n++}`);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), body);
    }
    for (const rel of lock) chmodSync(join(repo, rel), 0o000);
    const reports = join(T, `reports${n++}`);
    mkdirSync(reports);
    const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', CW_ASSERT_TREE: '0',
      CW_SELF_SWEEP: '0', CW_PERF_FEEDBACK: join(T, 'perf.jsonl'), FORCE_COLOR: '0' };
    const r = spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'run', LANE.id, '--manifest', MANIFEST,
      '--repo', repo, '--no-fail-fast'], { cwd: T, encoding: 'utf8', env });
    for (const rel of lock) chmodSync(join(repo, rel), 0o600);
    let rows;
    try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); }
    catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); runner exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    return { row: rows.find((x) => x.check === LANE.id), verdict: classifyReport(LANE, reports, repo),
      rollup: _jacksonGuardCounts(reports, LANE.report.file) };
  }

  test('the lane declares the format and records the exit code the parser reads', () => {
    assert.equal(LANE.report.format, 'jackson-guard');
    assert.match(LANE.local.join('\n'), /; echo \$\? > "\$CW_REPORT_DIR\/jackson-guard\.txt\.exit"$/);
    assert.doesNotMatch(LANE.local.join('\n'), /GUARD_FAIL|\|\|/);
  });

  test('a repository that enables the toggle does not score ok', () => {
    const { row, verdict, rollup } = run({ 'src/main/resources/application.yml': 'spring:\n  jackson:\n    mapper:\n      accept-case-insensitive-properties: true\n' });
    assert.notEqual(row.status, 'noscan', JSON.stringify(row));
    assert.equal(verdict.sev, 'med', verdict.summary);
    assert.match(verdict.summary, /src\/main\/resources\/application\.yml:4/);
    assert.equal(rollup.med, 1);
  });

  test('a repository that leaves it off scores ok, with the count it read', () => {
    const { row, verdict, rollup } = run({ 'src/main/resources/application.yml': 'server:\n  port: 8080\n', 'src/App.java': 'class App {}\n' });
    assert.equal(row.status, 'pass', JSON.stringify(row));
    assert.equal(verdict.sev, 'ok');
    assert.match(verdict.summary, /2 file\(s\) scanned/);
    assert.equal(rollup.filesScanned, 2);
  });

  test('a repository with nothing to guard is n/a: skip on the wire, never pass and never a void', () => {
    const { row, verdict, rollup } = run({ 'README.md': '# not java\n', 'src/index.js': 'export {};\n' });
    assert.equal(row.status, 'skip', JSON.stringify(row));
    assert.match(row.reason, /^n\/a — no \.java\/\.yml\/\.properties files to guard/);
    assert.equal('coverage' in row, false, 'an n/a row carries no coverage');
    assert.equal(verdict.sev, 'skip');
    assert.equal(rollup.nosrc, true);
  });

  test('a config the guard cannot read is a void, never a pass', { skip: !CAN_DENY && 'cannot deny a read here' }, () => {
    const { row, rollup } = run({ 'a/application.yml': 'server:\n  port: 8080\n', 'b/application.yml': 'x: 1\n' }, { lock: ['b/application.yml'] });
    assert.equal(row.status, 'noscan', JSON.stringify(row));
    assert.match(row.reason, /1 path\(s\) could not be read/);
    assert.equal(rollup.toolfailed, true);
  });
});
