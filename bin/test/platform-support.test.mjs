import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXIT, check, compare, main, measureRun, parseLog, serialize, statementFor, statementsIn, toRecord,
} from '../platform-support.mjs';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
// `gh run view --log` shape: job<TAB>step<TAB>timestamp line; gh renders ESC as `^[`.
const gh = (lines) => lines.map((l, i) => `Windows portability (Node 22)\tUNKNOWN STEP\t2026-10-07T13:${String(10 + i).padStart(2, '0')}:00.0000000Z ${l}`).join('\n');

const HEADER = [
  '##[group]Operating System',
  'Microsoft Windows Server 2025',
  '##[endgroup]',
  "Working directory is 'D:\\a\\proj\\proj'",
  '[command]"C:\\Program Files\\Git\\bin\\git.exe" -c protocol.version=2 fetch --no-tags --depth=1 origin +' + SHA + ':refs/remotes/origin/main',
  'Found in cache @ C:\\hostedtoolcache\\windows\\node\\22.20.0\\x64',
  '##[group]Run node --test --test-concurrency=1 `',
  '^[[36;1mnode --test --test-concurrency=1 `^[[0m',
  '^[[36;1m  lib/test/one.test.mjs `^[[0m',
  '^[[36;1m  bin/test/two.test.mjs^[[0m',
  "shell: C:\\Program Files\\PowerShell\\7\\pwsh.EXE -command \". '{0}'\"",
  '##[endgroup]',
];

const SPEC = [
  '▶ outer suite',
  '  ✔ passes (0.3ms)',
  '  ✖ breaks on CRLF (0.4ms)',
  '  ﹣ posix only (0.3ms) # no POSIX modes',
  '✖ outer suite (1.5ms)',
  '﹣ bare skip (0.03ms) # SKIP',
  '✖ top-level fails (0.03ms)',
  '⚠ todo item (0.02ms) # later',
  '▶ parent',
  '  ✖ child fails (0.2ms)',
  '  ✔ child ok (0.05ms)',
  '✖ parent (0.6ms)',
  'ℹ tests 9', 'ℹ suites 1', 'ℹ pass 2', 'ℹ fail 4', 'ℹ cancelled 0', 'ℹ skipped 2', 'ℹ todo 1',
  'ℹ duration_ms 40.1',
  '',
  '✖ failing tests:',
  '',
  'test at lib\\test\\one.test.mjs:5:3',
  '✖ breaks on CRLF (0.4ms)',
  '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  '',
  'test at lib\\test\\one.test.mjs:9:1',
  '✖ top-level fails (0.03ms)',
  '  Error: boom',
  '',
  'test at lib\\test\\one.test.mjs:10:1',
  '⚠ todo item (0.02ms) # later',
  '  Error: x',
  '',
  'test at bin\\test\\two.test.mjs:2:39',
  '✖ child fails (0.2ms)',
  '  Error: c',
];

const TAP = [
  'TAP version 13',
  '# Subtest: outer suite',
  '    # Subtest: passes',
  '    ok 1 - passes',
  '      ---', "      duration_ms: 0.25", "      type: 'test'", '      ...',
  '    # Subtest: breaks on CRLF',
  '    not ok 2 - breaks on CRLF',
  '      ---', "      type: 'test'", "      location: 'D:\\a\\proj\\proj\\lib\\test\\one.test.mjs:5:3'",
  "      failureType: 'testCodeFailure'", '      ...',
  '    # Subtest: posix only',
  '    ok 3 - posix only # SKIP no POSIX modes',
  '    1..3',
  'not ok 1 - outer suite',
  '  ---', "  type: 'suite'", "  failureType: 'subtestsFailed'", '  ...',
  '# Subtest: bare skip',
  'ok 2 - bare skip # SKIP',
  '# Subtest: top-level fails',
  'not ok 3 - top-level fails',
  '  ---', "  type: 'test'", "  location: 'D:\\a\\proj\\proj\\lib\\test\\one.test.mjs:9:1'",
  "  failureType: 'testCodeFailure'", '  ...',
  '# Subtest: todo item',
  'not ok 4 - todo item # TODO later',
  '  ---', "  type: 'test'", "  failureType: 'testCodeFailure'", '  ...',
  '# Subtest: parent',
  '    # Subtest: child fails',
  '    not ok 1 - child fails',
  '      ---', "      type: 'test'", "      location: 'D:\\a\\proj\\proj\\bin\\test\\two.test.mjs:2:39'",
  "      failureType: 'testCodeFailure'", '      ...',
  '    # Subtest: child ok',
  '    ok 2 - child ok',
  '    1..2',
  'not ok 5 - parent',
  '  ---', "  type: 'test'", "  failureType: 'subtestsFailed'", '  ...',
  '1..5',
  '# tests 9', '# suites 1', '# pass 2', '# fail 4', '# cancelled 0', '# skipped 2', '# todo 1',
  '# duration_ms 43.1',
];

const EXPECTED_FAILING = [
  'bin/test/two.test.mjs > child fails',
  'lib/test/one.test.mjs > breaks on CRLF',
  'lib/test/one.test.mjs > top-level fails',
];

for (const [shape, body] of [['spec', SPEC], ['tap', TAP]]) {
  test(`${shape}: totals, own-failure names by file, skips with a reason`, () => {
    const parsed = parseLog(gh([...HEADER, ...body]));
    const r = toRecord(parsed, { runId: 42 });
    assert.equal(r.platform, 'windows');
    assert.equal(r.node, '22.20.0');
    assert.equal(r.headSha, SHA);
    assert.equal(r.runId, '42');
    assert.match(r.measuredAt, /^2026-10-07T13:\d\d:00/);
    assert.deepEqual([r.tests, r.pass, r.fail, r.skip, r.todo], [9, 2, 4, 2, 1]);
    assert.equal(r.skippedWithReason, 1, 'a bare SKIP carries no reason');
    assert.deepEqual(r.failing, EXPECTED_FAILING, 'a parent failed only by its subtest is not named');
    assert.deepEqual(r.failingByFile, { 'bin/test/two.test.mjs': 1, 'lib/test/one.test.mjs': 2 });
    assert.deepEqual(r.testFiles, ['lib/test/one.test.mjs', 'bin/test/two.test.mjs']);
  });
}

test('a log without the gh prefix parses the same, with CRLF line ends', () => {
  const r = toRecord(parseLog(SPEC.join('\r\n')), { runId: 1, platform: 'windows', node: '24.0.0', headSha: SHA, measuredAt: '2026-10-07T00:00:00Z' });
  assert.deepEqual([r.pass, r.fail, r.skip], [2, 4, 2]);
  assert.deepEqual(r.failing, EXPECTED_FAILING);
});

test('two summaries in one log are summed', () => {
  const p = parseLog([...SPEC.slice(12, 20), ...SPEC.slice(12, 20)].join('\n'));
  assert.equal(p.blocks, 2);
  assert.equal(p.totals.pass, 4);
});

test('a log with no totals is unmeasured, never zero failures', () => {
  const p = parseLog(gh([...HEADER, '✔ something (1ms)', 'working tree clean after the suite']));
  assert.throws(() => toRecord(p, { runId: 1 }), (e) => e.exitCode === EXIT.UNMEASURED);
});

test('the statement round-trips through the doc reader, wrapped across lines', () => {
  const r = toRecord(parseLog(gh([...HEADER, ...SPEC])), { runId: 1 });
  const s = statementFor(r);
  assert.equal(s, 'Windows CI measured 2026-10-07 at `a1b2c3d4`, Node 22.20.0: 2 pass / 4 fail / 2 skipped');
  const doc = `Intro.\n\n${s.replace(' Node', '\nNode')}.\n`;
  assert.deepEqual(compare([r], statementsIn(doc), 'd.md'), []);
  assert.equal(compare([r], statementsIn(doc.replace('2 pass', '3 pass')), 'd.md').length, 2);
  assert.equal(compare([r], statementsIn('nothing here'), 'd.md').length, 1);
});

test('measureRun reads one record per matching job through an injected gh', () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args.join(' '));
    if (args.includes('--json')) {
      return JSON.stringify({ headSha: SHA, jobs: [
        { databaseId: 7, name: 'Windows portability (Node 22)', status: 'completed', completedAt: '2026-10-07T13:35:15Z' },
        { databaseId: 8, name: 'Test suite', status: 'completed', completedAt: '2026-10-07T13:20:00Z' },
      ] });
    }
    return gh([...HEADER, ...TAP]);
  };
  const recs = measureRun({ runId: 99, exec, cwd: '.' });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].job, 'Windows portability (Node 22)');
  assert.equal(recs[0].measuredAt, '2026-10-07T13:35:15Z');
  assert.ok(calls.every((c) => c.startsWith('run view 99')), 'only read-only gh calls');
  assert.ok(calls.some((c) => c.includes('--log --job 7')));
  assert.throws(() => measureRun({ runId: 99, exec, cwd: '.', platform: 'macos' }), (e) => e.exitCode === EXIT.UNMEASURED);
});

test('a platform outside the known three is matched as literal text in the job name', () => {
  const exec = (args) => (args.includes('--json')
    ? JSON.stringify({ headSha: SHA, jobs: [{ databaseId: 9, name: 'Test suite (Node 22)', status: 'completed', completedAt: '2026-10-07T13:20:00Z' }] })
    : gh([...HEADER, ...TAP]));
  assert.equal(measureRun({ runId: 99, exec, cwd: '.', platform: '(node 22)' })[0].job, 'Test suite (Node 22)');
  assert.throws(() => measureRun({ runId: 99, exec, cwd: '.', platform: 'node.22' }), (e) => e.exitCode === EXIT.UNMEASURED);
});

test('--log writes the record atomically and byte-identically; --check reads env at call time', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-platform-support-'));
  const saved = { ...process.env };
  try {
    mkdirSync(join(root, 'docs'));
    const log = join(root, 'job.log');
    writeFileSync(log, gh([...HEADER, ...TAP]));
    process.env.CW_PLATFORM_SUPPORT_ROOT = root;
    process.env.CW_PLATFORM_SUPPORT_RECORD = join(root, 'out', 'rec.json');

    assert.throws(() => check(), (e) => e.exitCode === EXIT.UNMEASURED, 'no record is not a pass');

    const args = ['--log', log, '--run-id', '5'];
    assert.equal(main(args), EXIT.OK);
    const first = readFileSync(process.env.CW_PLATFORM_SUPPORT_RECORD, 'utf8');
    assert.equal(main(args), EXIT.OK);
    assert.equal(readFileSync(process.env.CW_PLATFORM_SUPPORT_RECORD, 'utf8'), first);
    const { records } = JSON.parse(first);
    assert.equal(first, serialize(records));

    const line = `${statementFor(records[0])}.\n`;
    writeFileSync(join(root, 'docs', 'SCOPE.md'), line);
    writeFileSync(join(root, 'docs', 'PLATFORM-SEAMS.md'), 'no statement\n');
    assert.equal(main(['--check']), EXIT.DRIFT);
    writeFileSync(join(root, 'docs', 'PLATFORM-SEAMS.md'), line);
    assert.equal(main(['--check']), EXIT.OK);

    writeFileSync(process.env.CW_PLATFORM_SUPPORT_RECORD, '{not json');
    assert.throws(() => check(), (e) => e.exitCode === EXIT.UNREADABLE, 'a corrupt record fails closed');
  } finally {
    for (const k of ['CW_PLATFORM_SUPPORT_ROOT', 'CW_PLATFORM_SUPPORT_RECORD']) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('usage errors exit 22', () => {
  for (const argv of [[], ['--check', '--run', '1'], ['--log', 'x'], ['--bogus']]) {
    assert.throws(() => main(argv), (e) => e.exitCode === EXIT.USAGE, argv.join(' '));
  }
});
