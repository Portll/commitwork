// Coverage is a separate axis from severity: real findings are a true severity, a dead lane is a
// true coverage loss, and any single number reporting both is a lie. A cell with findings AND
// reduced coverage must still rank at its real severity — coverage never joins the sev enum.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneCoverage, classifyReport, validateManifest, parseReport } from '../commitwork.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-lane-cov-'));
const CHECK = (over = {}) => ({
  id: 'deps-osv',
  report: { file: 'osv.sarif', log: 'osv.log' },
  coverageSignals: [{ pattern: 'Skipping call analysis on Go code', lane: 'Go call analysis' }],
  ...over,
});

describe('the exit sidecar', () => {
  test('a non-zero exit reduces coverage and says what the number was', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '2\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /exited 2/);
    rmSync(d, { recursive: true, force: true });
  });

  test('exit 0 alone does not establish full coverage — the declared log still gets read', () => {
    // The whole point of the signals half: tools lose a lane and carry on exiting 0.
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');
    writeFileSync(join(d, 'osv.log'), 'Scanning...\nSkipping call analysis on Go code since Go is not installed\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'reduced', 'an exit-0 run that announced a dead lane is not full coverage');
    assert.match(r.coverageReason, /Go call analysis did not run/);
    rmSync(d, { recursive: true, force: true });
  });


  test('exit 1 is NOT reduced — it is how this family of tools reports findings', () => {
    // gitleaks/semgrep/shellcheck/gosec all exit 1 when they FIND something; the >1 threshold
    // mirrors deps-osv's own `if [ $rc -gt 1 ]`
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '1\n');
    writeFileSync(join(d, 'osv.log'), 'clean run\n');
    assert.equal(laneCoverage(CHECK(), d).coverage, 'full',
      'a tool that exited 1 because it found things has not lost coverage');
    rmSync(d, { recursive: true, force: true });
  });

  test('exit >1 IS reduced — that is the tool in trouble', () => {
    for (const code of [2, 126, 127]) {
      const d = dir();
      writeFileSync(join(d, 'osv.sarif.exit'), `${code}\n`);
      writeFileSync(join(d, 'osv.log'), 'x\n');
      const r = laneCoverage(CHECK(), d);
      assert.equal(r.coverage, 'reduced', `exit ${code} means the process itself failed`);
      assert.match(r.coverageReason, new RegExp(`exited ${code}`));
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a non-integer sidecar is ignored rather than believed', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), 'not-a-number\n');
    writeFileSync(join(d, 'osv.log'), 'clean run\n');
    assert.equal(laneCoverage(CHECK(), d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('declared signals', () => {
  test('a log that was read and matched nothing is the ONLY route to full', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Scanned 412 packages. No lanes skipped.\n');
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'full');
    assert.equal(r.coverageReason, null);
    rmSync(d, { recursive: true, force: true });
  });

  test('the reason names the LANE, not the regex — a reader needs the capability, not the grep', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Skipping call analysis on Go code since Go is not installed\n');
    assert.equal(laneCoverage(CHECK(), d).coverageReason, 'Go call analysis did not run');
    rmSync(d, { recursive: true, force: true });
  });

  test('a check declaring no signals is full on an exit-0 run, without inventing a log to read', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');
    assert.equal(laneCoverage(CHECK({ coverageSignals: [] }), d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('fail closed — an unread log is never full coverage', () => {
  test('a DECLARED log that is absent yields unknown, not full', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.sarif.exit'), '0\n');   // exit says fine; the log never appeared
    const r = laneCoverage(CHECK(), d);
    assert.equal(r.coverage, 'unknown',
      'returning full here would assert completeness nobody verified — the defect this field exists to remove');
    assert.match(r.coverageReason, /absent/);
    rmSync(d, { recursive: true, force: true });
  });

  test('an unreadable log yields unknown, not full', () => {
    const d = dir();
    const p = join(d, 'osv.log');
    writeFileSync(p, 'x\n');
    let skipped = false;
    try { chmodSync(p, 0o000); } catch { skipped = true; }
    // running as root defeats the permission, so only assert when the OS actually denied us
    let r;
    try { r = laneCoverage(CHECK(), d); } finally { try { chmodSync(p, 0o644); } catch {} }
    if (!skipped && r.coverage !== 'full') {
      assert.equal(r.coverage, 'unknown');
      assert.match(r.coverageReason, /unreadable/);
    }
    rmSync(d, { recursive: true, force: true });
  });

  test('a malformed regex yields unknown — a typo must not read as "nothing matched"', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'anything\n');
    const r = laneCoverage(CHECK({ coverageSignals: [{ pattern: '([unclosed', lane: 'x' }] }), d);
    assert.equal(r.coverage, 'unknown');
    assert.match(r.coverageReason, /not a valid regex/);
    rmSync(d, { recursive: true, force: true });
  });
});

describe('orthogonality — the property the whole design exists to protect', () => {
  test('coverage never returns a severity, and severity is not an input to it', () => {
    const d = dir();
    writeFileSync(join(d, 'osv.log'), 'Skipping call analysis on Go code since Go is not installed\n');
    const r = laneCoverage(CHECK(), d);
    // The guard is "no SEVERITY key leaks in", not "exactly two keys forever": coverageBasis was
    // added to say HOW the verdict was reached (per-file | signal | exit-code | ...), which is a
    // third fact about coverage, not a severity. Anything outside the coverage family still fails.
    assert.deepEqual(Object.keys(r).sort().filter((k) => !['coverage', 'coverageReason', 'coverageBasis'].includes(k)), [],
      'laneCoverage returns coverage keys only — a sev key here would be the two axes collapsing');
    assert.ok(!['ok', 'med', 'high', 'noscan', 'skip'].includes(r.coverage),
      'the coverage vocabulary must not overlap the severity vocabulary, or consumers will conflate them');
    rmSync(d, { recursive: true, force: true });
  });

  test('a check with no report block is full — coverage is not a way to fail an inapplicable lane', () => {
    const d = dir();
    assert.equal(laneCoverage({ id: 'x' }, d).coverage, 'full');
    assert.equal(laneCoverage(null, d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

// A tool whose findings status is an exit above 1. retire exits 13 when it finds a vulnerable
// library, psalm 2 when it reports issues, phpcs 4 sets bit 2 for issues it cannot fix; each was
// published as `degraded — the tool exited N` on runs that found exactly what they exist to find.
// The declaration fixes that, and the witness keeps it from becoming a way to pass a dead run.
describe('a11y: unchecked WCAG criteria', () => {
  const A11Y = { id: 'a11y-wcag', report: { file: 'a11y.json', format: 'a11y' } };
  const report = (criteria) => ({ ran: true, conformance: { A: 'pass', AA: 'unverified' }, criteria });

  test('zero failures with unchecked criteria is neither a pass nor a finding: severity ok, coverage reduced', () => {
    const d = dir();
    writeFileSync(join(d, 'a11y.json'), JSON.stringify(report([
      { id: '1.1.1', level: 'A', state: 'pass' }, { id: '1.4.4', level: 'AA', state: 'unchecked' }, { id: '1.4.10', level: 'AA', state: 'unchecked' },
    ])));
    writeFileSync(join(d, 'a11y.json.exit'), '0\n');
    assert.equal(parseReport('a11y', join(d, 'a11y.json')).sev, 'ok');
    assert.deepEqual(laneCoverage(A11Y, d), { coverage: 'reduced', coverageReason: '2 WCAG criteria unchecked — AA unverified', coverageBasis: 'per-criterion' });
    rmSync(d, { recursive: true, force: true });
  });

  test('every criterion decided keeps full coverage, and a failure keeps its severity', () => {
    const d = dir();
    writeFileSync(join(d, 'a11y.json'), JSON.stringify(report([{ id: '1.1.1', level: 'A', state: 'fail' }, { id: '1.4.4', level: 'AA', state: 'pass' }])));
    writeFileSync(join(d, 'a11y.json.exit'), '0\n');
    assert.equal(parseReport('a11y', join(d, 'a11y.json')).sev, 'high');
    assert.equal(laneCoverage(A11Y, d).coverage, 'full');
    rmSync(d, { recursive: true, force: true });
  });
});

describe('a declared findings exit (report.findingsExit)', () => {
  const RETIRE = (over = {}) => ({ id: 'deps-retire', report: { file: 'retire.json', format: 'retire', findingsExit: [13], ...over } });
  const VULNERABLE = JSON.stringify({ version: '5.4.3', data: [{ file: '/x/assets/lib-1.0.0.min.js',
    results: [{ component: 'lib', version: '1.0.0', vulnerabilities: [{ severity: 'high', identifiers: { summary: 'synthetic' } }] }] }] });
  const run = (files, check) => {
    const d = dir();
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    try { return laneCoverage(check, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };

  test('exit 13 beside a retire report that holds findings is a findings run, not reduced coverage', () => {
    const r = run({ 'retire.json': VULNERABLE, 'retire.json.exit': '13\n' }, RETIRE());
    assert.equal(r.coverage, 'full', `a declared findings exit with findings in the report: ${r.coverageReason}`);
  });

  test('exit 13 beside an EMPTY retire report fails closed — the exit claims findings the report does not hold', () => {
    const r = run({ 'retire.json': JSON.stringify({ version: '5.4.3', data: [] }), 'retire.json.exit': '13\n' }, RETIRE());
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /exited 13.*holds no findings/);
  });

  test('exit 13 beside an unparseable or absent retire report fails closed', () => {
    for (const files of [{ 'retire.json': 'Error: something went wrong\n', 'retire.json.exit': '13\n' }, { 'retire.json.exit': '13\n' }]) {
      const r = run(files, RETIRE());
      assert.equal(r.coverage, 'reduced', JSON.stringify(Object.keys(files)));
      assert.match(r.coverageReason, /exited 13.*(could not be read|was not written)/);
    }
  });

  test('the same exit WITHOUT the declaration is still reduced — nothing is assumed per tool', () => {
    const r = run({ 'retire.json': VULNERABLE, 'retire.json.exit': '13\n' }, { id: 'deps-retire', report: { file: 'retire.json', format: 'retire' } });
    assert.equal(r.coverage, 'reduced');
    assert.equal(r.coverageReason, 'the tool exited 13');
  });

  test('a declared code does not excuse a different one', () => {
    const r = run({ 'retire.json': VULNERABLE, 'retire.json.exit': '2\n' }, RETIRE());
    assert.equal(r.coverage, 'reduced');
    assert.equal(r.coverageReason, 'the tool exited 2');
  });

  test('an accepted findings exit still has its declared log read', () => {
    const r = run({ 'retire.json': VULNERABLE, 'retire.json.exit': '13\n', 'retire.log': 'could not load the repository\n' },
      { ...RETIRE({ log: 'retire.log' }), coverageSignals: [{ pattern: 'could not load the repository', lane: 'advisory data' }] });
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /advisory data did not run/);
  });

  test('a declaration built outside the validator cannot widen to shell codes', () => {
    const r = run({ 'retire.json': VULNERABLE, 'retire.json.exit': '127\n' }, RETIRE({ findingsExit: [127, 13] }));
    assert.equal(r.coverage, 'reduced');
    assert.equal(r.coverageReason, 'the tool exited 127');
  });

  test('the severity side already fails closed: exit 13 with nothing parsed is a void, never a pass', () => {
    for (const body of [JSON.stringify({ data: [] }), 'not json']) {
      const d = dir();
      writeFileSync(join(d, 'retire.json'), body);
      writeFileSync(join(d, 'retire.json.exit'), '13\n');
      const { sev, summary } = classifyReport(RETIRE(), d, d);
      rmSync(d, { recursive: true, force: true });
      assert.equal(sev, 'noscan', body);
      assert.match(summary, /exited 13/);
    }
  });

  test('the shipping deps-retire declaration accepts a findings run and refuses an empty one', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const m = JSON.parse(readFileSync(join(root, 'manifests', 'security-baseline.json'), 'utf8'));
    const check = m.checks.find((c) => c.id === 'deps-retire');
    assert.equal(run({ 'retire.json': VULNERABLE, 'retire.json.exit': '13\n' }, check).coverage, 'full');
    assert.equal(run({ 'retire.json': JSON.stringify({ data: [] }), 'retire.json.exit': '13\n' }, check).coverage, 'reduced');
  });

  test('the validator refuses a malformed declaration rather than dropping codes from it', () => {
    const manifest = (findingsExit) => ({ repo: 'x', checks: [{ id: 'x', local: ['true'], report: { file: 'x.json', format: 'retire', findingsExit } }] });
    for (const bad of [[], [0], [126], [128], [1.5], ['13'], 13]) {
      const { errors } = validateManifest(manifest(bad));
      assert.ok(errors.some((e) => /findingsExit/.test(e)), `findingsExit ${JSON.stringify(bad)} must be refused`);
    }
    assert.deepEqual(validateManifest(manifest([13])).errors, []);
  });
});

// psalm exits 2 when it completes and reports issues (docs/running_psalm/command_line_usage.md);
// phpcs 4 exits with a bitmask, 1 fixable, 2 not fixable, 3 both (src/Util/ExitCode.php). Both were
// published as degraded on every run that found something, and phpcs's own command called 3 a
// tool failure. The fixtures are synthetic: one tainted echo, one eval.
describe('the PHP lanes declare their findings exits', () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const shipped = (id) => JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8')).checks.find((c) => c.id === id);
  const run = (files, check) => {
    const d = dir();
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    try { return laneCoverage(check, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };
  const SARIF = (results) => JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'Psalm', rules: [{ id: '245', name: 'TaintedHtml' }] } }, results }] });
  const TAINT = { ruleId: '245', level: 'error', message: { text: 'Detected tainted HTML' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/page.php' }, region: { startLine: 3 } } }] };
  const PHPCS = (messages) => JSON.stringify({ totals: { errors: messages.length, warnings: 0, fixable: 0 },
    files: { '/fixture/src/page.php': { errors: messages.length, warnings: 0, messages } } });
  const EVAL = { message: 'eval() is a security risk', source: 'Security.BadFunctions.NoEvals.NoEvals', severity: 5, fixable: false, type: 'ERROR', line: 6, column: 1 };

  test('psalm exit 2 beside a SARIF holding a taint result is a findings run', () => {
    const r = run({ 'psalm.sarif': SARIF([TAINT]), 'psalm.sarif.exit': '2\n', 'psalm.log': 'MODE: degraded (first-party only)\n' }, shipped('sast-php-psalm'));
    assert.equal(r.coverage, 'full', r.coverageReason);
  });

  test('psalm exit 2 beside a SARIF with no results, or no SARIF at all, still reduces coverage', () => {
    for (const files of [{ 'psalm.sarif': SARIF([]) }, {}]) {
      const r = run({ ...files, 'psalm.sarif.exit': '2\n', 'psalm.log': 'x\n' }, shipped('sast-php-psalm'));
      assert.equal(r.coverage, 'reduced');
      assert.match(r.coverageReason, /exited 2, which it documents as having reported findings, but/);
    }
  });

  test('phpcs exits 1, 2 and 3 beside a report holding findings are findings runs; 16 and 255 are not', () => {
    for (const code of [1, 2, 3]) {
      const r = run({ 'phpcs.json': PHPCS([EVAL]), 'phpcs.json.exit': `${code}\n`, 'phpcs.log': 'Time: 20ms; Memory: 6MB\n' }, shipped('sast-php-phpcs'));
      assert.equal(r.coverage, 'full', `exit ${code}: ${r.coverageReason}`);
    }
    for (const code of [16, 255]) {
      const r = run({ 'phpcs.json': PHPCS([EVAL]), 'phpcs.json.exit': `${code}\n`, 'phpcs.log': 'x\n' }, shipped('sast-php-phpcs'));
      assert.equal(r.coverageReason, `the tool exited ${code}`);
    }
  });

  test('phpcs exit 2 beside a report with no messages, or a fatal error in place of JSON, still reduces coverage', () => {
    for (const body of [PHPCS([]), 'PHP Fatal error:  Allowed memory size exhausted\n']) {
      const r = run({ 'phpcs.json': body, 'phpcs.json.exit': '2\n', 'phpcs.log': 'x\n' }, shipped('sast-php-phpcs'));
      assert.equal(r.coverage, 'reduced', body.slice(0, 20));
      assert.match(r.coverageReason, /exited 2, which it documents as having reported findings, but/);
    }
  });

  // The command, run with a stub phpcs: exit 3 is "fixable and non-fixable issues", and the lane
  // must record it and carry on; 16 is phpcs reporting its own processing error, and must fail.
  test('the phpcs command records exit 3 as a run and still fails on 16', { skip: process.platform === 'win32' ? 'needs a POSIX sh' : false }, () => {
    const cmd = shipped('sast-php-phpcs').local[0];
    for (const [code, failed] of [[3, false], [16, true]]) {
      const d = dir();
      const bin = join(d, 'bin'); const std = join(d, 'Security'); const report = join(d, 'report');
      for (const p of [bin, std, report]) mkdirSync(p);
      writeFileSync(join(bin, 'phpcs'), `#!/bin/sh\necho '${PHPCS([EVAL])}'\nexit ${code}\n`);
      chmodSync(join(bin, 'phpcs'), 0o755);
      const r = spawnSync('sh', ['-c', cmd], { cwd: d, encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CW_REPORT_DIR: report, CW_PHPCS_SECURITY_STANDARD: std } });
      const sidecar = readFileSync(join(report, 'phpcs.json.exit'), 'utf8').trim();
      const log = readFileSync(join(report, 'phpcs.log'), 'utf8');
      rmSync(d, { recursive: true, force: true });
      assert.equal(sidecar, String(code));
      assert.equal(r.status !== 0, failed, `exit ${code}: command status ${r.status}`);
      assert.equal(/tool failure/.test(log), failed, `exit ${code}: ${log}`);
    }
  });

  // phpcs inherits PHP's 128M memory_limit and holds every message until it writes the report; a
  // large tree died there with exit 255. The command raises the limit, and the operator can move it.
  test('the phpcs command raises PHP\'s memory limit, and CW_PHPCS_MEMORY_LIMIT moves it', { skip: process.platform === 'win32' ? 'needs a POSIX sh' : false }, () => {
    const cmd = shipped('sast-php-phpcs').local[0];
    for (const [env, want] of [[{}, '2G'], [{ CW_PHPCS_MEMORY_LIMIT: '3G' }, '3G']]) {
      const d = dir();
      const bin = join(d, 'bin'); const std = join(d, 'Security'); const report = join(d, 'report');
      for (const p of [bin, std, report]) mkdirSync(p);
      writeFileSync(join(bin, 'phpcs'), `#!/bin/sh\nprintf '%s\\n' "$@" > "$CW_REPORT_DIR/argv"\necho '${PHPCS([])}'\nexit 0\n`);
      chmodSync(join(bin, 'phpcs'), 0o755);
      const base = { ...process.env }; delete base.CW_PHPCS_MEMORY_LIMIT;
      spawnSync('sh', ['-c', cmd], { cwd: d, encoding: 'utf8',
        env: { ...base, ...env, PATH: `${bin}:${process.env.PATH}`, CW_REPORT_DIR: report, CW_PHPCS_SECURITY_STANDARD: std } });
      const argv = readFileSync(join(report, 'argv'), 'utf8').split('\n');
      rmSync(d, { recursive: true, force: true });
      assert.deepEqual(argv.slice(0, 2), ['-d', `memory_limit=${want}`], JSON.stringify(env));
    }
  });
});

// brakeman exits 3 when it finds warnings (Brakeman 5.4.1 lib/brakeman.rb, Warnings_Found_Exit_Code),
// the same defect the PHP lanes had: every run that found something was published as degraded.
describe('the brakeman lane declares its findings exit', () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const shipped = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8')).checks.find((c) => c.id === 'sast-ruby-brakeman');
  const run = (files) => {
    const d = dir();
    for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
    try { return laneCoverage(shipped, d); } finally { rmSync(d, { recursive: true, force: true }); }
  };
  const REPORT = (warnings) => JSON.stringify({ scan_info: { app_path: '/fixture' }, warnings, errors: [] });
  const SQLI = { warning_type: 'SQL Injection', check_name: 'SQL', message: 'Possible SQL injection', file: 'app/models/user.rb', line: 4, confidence: 'High', cwe_id: [89] };

  test('exit 3 beside a report holding a warning is a findings run', () => {
    const r = run({ 'brakeman.json': REPORT([SQLI]), 'brakeman.json.exit': '3\n', 'brakeman.log': 'x\n' });
    assert.equal(r.coverage, 'full', r.coverageReason);
  });

  test('exit 3 beside a report with no warnings, and exit 7, still reduce coverage', () => {
    const empty = run({ 'brakeman.json': REPORT([]), 'brakeman.json.exit': '3\n', 'brakeman.log': 'x\n' });
    assert.equal(empty.coverage, 'reduced');
    assert.match(empty.coverageReason, /exited 3, which it documents as having reported findings, but/);
    const partial = run({ 'brakeman.json': REPORT([SQLI]), 'brakeman.json.exit': '7\n', 'brakeman.log': 'x\n' });
    assert.equal(partial.coverageReason, 'the tool exited 7');
  });
});

// The psalm command lost two measured behaviours in a later rewrite while its notes kept describing
// them: PHP's production assertion setting (a php-parser debug assert aborted whole runs, measured
// 2026-09-02) and the exclusion of test and fixture directories. Driven here with stub php and psalm.
describe('the psalm command runs under zend.assertions=-1 and leaves tests out', { skip: process.platform === 'win32' ? 'needs a POSIX sh' : false }, () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url));
  const cmd = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8')).checks.find((c) => c.id === 'sast-php-psalm').local[0];

  const runWith = (psalmShebang) => {
    const d = dir();
    const bin = join(d, 'bin'); const home = join(d, 'home'); const report = join(d, 'report'); const tree = join(d, 'tree');
    for (const p of [bin, home, report, join(tree, 'src', 'tests'), join(tree, 'src', 'Fixtures')]) mkdirSync(p, { recursive: true });
    writeFileSync(join(tree, 'src', 'a.php'), '<?php echo 1;\n');
    // the stub php records its argv and runs the script it was handed with sh, whatever its shebang says
    writeFileSync(join(bin, 'php'), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$CW_REPORT_DIR/php-argv"\nshift 2\ns="$1"; shift\nexec sh "$s" "$@"\n');
    writeFileSync(join(bin, 'psalm'), `${psalmShebang}\ncat psalm.xml > "$CW_REPORT_DIR/psalm-xml"\nexit 0\n`);
    for (const f of ['php', 'psalm']) chmodSync(join(bin, f), 0o755);
    spawnSync('sh', ['-c', cmd], { cwd: tree, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CW_REPORT_DIR: report } });
    const read = (f) => { try { return readFileSync(join(report, f), 'utf8'); } catch { return null; } };
    const out = { argv: read('php-argv'), xml: read('psalm-xml') };
    rmSync(d, { recursive: true, force: true });
    return out;
  };

  test('a PHP-script psalm runs through php -d zend.assertions=-1, and its psalm.xml ignores tests/ and fixtures/', () => {
    const { argv, xml } = runWith('#!/usr/bin/env php');
    assert.deepEqual(argv.split('\n').slice(0, 2), ['-d', 'zend.assertions=-1']);
    assert.match(xml, /<ignoreFiles>.*\/src\/tests" \/>.*<\/ignoreFiles>/);
    assert.match(xml, /\/src\/Fixtures" \/>/);
  });

  // The degraded scope: measured 2026-10-08 on a WordPress theme whose src/ held only JS, psalm was
  // pointed at src/ alone, examined nothing and exited 0, a clean zero over 282 unread PHP files.
  const scopeOf = (files) => {
    const d = dir();
    const bin = join(d, 'bin'); const home = join(d, 'home'); const report = join(d, 'report'); const tree = join(d, 'tree');
    for (const p of [bin, home, report, tree]) mkdirSync(p, { recursive: true });
    for (const [rel, body] of Object.entries(files)) { mkdirSync(join(tree, rel, '..'), { recursive: true }); writeFileSync(join(tree, rel), body); }
    writeFileSync(join(bin, 'psalm'), '#!/bin/sh\ncat psalm.xml > "$CW_REPORT_DIR/psalm-xml"\nexit 0\n');
    chmodSync(join(bin, 'psalm'), 0o755);
    spawnSync('sh', ['-c', cmd], { cwd: tree, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin`, CW_REPORT_DIR: report } });
    const xml = readFileSync(join(report, 'psalm-xml'), 'utf8').replaceAll(realpathSync(tree), '<tree>').replaceAll(tree, '<tree>');
    rmSync(d, { recursive: true, force: true });
    return /<projectFiles>(.*?)(<ignoreFiles>|<\/projectFiles>)/.exec(xml)[1];
  };

  test('a src/ with no PHP is not the scope: the tree is', () => {
    assert.equal(scopeOf({ 'src/app.js': 'x', 'functions.php': '<?php\n', 'modules/m.php': '<?php\n' }), '<directory name="<tree>" />');
  });

  test('PHP at the root keeps the whole tree even when src/ holds PHP too', () => {
    assert.equal(scopeOf({ 'src/a.php': '<?php\n', 'index.php': '<?php\n' }), '<directory name="<tree>" />');
  });

  test('a library layout, PHP only under src/, keeps the src/ scope', () => {
    assert.equal(scopeOf({ 'src/a.php': '<?php\n', 'README.md': 'x' }), '<directory name="<tree>/src" />');
  });

  test('a shell-wrapper psalm is run as it is, never handed to php', () => {
    const { argv, xml } = runWith('#!/bin/sh');
    assert.equal(argv, null, 'php was invoked on a shell script');
    assert.match(xml, /<ignoreFiles>/);
  });
});
