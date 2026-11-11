// Two Windows-only defects a first-time user meets, and neither can be reproduced on the host that
// fixes them — so the win32 half is decided by a PARAMETER and the off-Windows half is measured
// through the runner. The two halves are asserted separately on purpose: only one of them can lie
// quietly. A win32 branch that returns nothing fails loudly on Windows the first time somebody
// runs it; an off-Windows branch that returns something changes every lane's environment on every
// box in the fleet and nothing says so.
//
//   PYTHONUTF8     semgrep's CLI is a CPython entry point, and Python on Windows encodes its
//                  output as the ANSI code page. A non-ASCII path or match aborts the scan.
//   MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL
//                  Git Bash rewrites a container-internal path on the way to native docker, so the
//                  mount names a host directory instead (lib/posix-shell.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneWindowsEnv } from '../lib/scanner-env.mjs';
import { msysPathconvEnv, MSYS_PATHCONV_ENV } from '../../lib/posix-shell.mjs';
import { fakeDocker, fakeSimple } from '../../monitor/test/lib/fake-bin.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const semgrep = { id: 'sast', requires: { tools: ['semgrep'] } };
const osv = { id: 'deps-osv', requires: { tools: ['docker'], docker: true } };

test('a CPython lane gets PYTHONUTF8 on win32 and the operator\'s own value is left alone', () => {
  assert.deepEqual(laneWindowsEnv(semgrep, {}, { platform: 'win32' }), { PYTHONUTF8: '1' });
  assert.deepEqual(laneWindowsEnv(semgrep, { PYTHONUTF8: '0' }, { platform: 'win32' }), {},
    'an inherited PYTHONUTF8 wins, as an inherited JAVA_HOME does');
});

test('a lane that runs no CPython tool gets no PYTHONUTF8, so the variable names a reason rather than a platform', () => {
  for (const tools of [['codeql'], ['gitleaks'], ['ruff'], ['zizmor'], []]) {
    assert.equal(laneWindowsEnv({ requires: { tools } }, {}, { platform: 'win32' }).PYTHONUTF8, undefined,
      `${JSON.stringify(tools)} is not a CPython entry point and must not claim to need UTF-8 mode`);
  }
});

test('a container lane gets BOTH MSYS switches on win32; a host lane gets neither', () => {
  assert.deepEqual(laneWindowsEnv(osv, {}, { platform: 'win32', container: true }),
    { MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' });
  assert.deepEqual(laneWindowsEnv(osv, {}, { platform: 'win32', container: false }), {},
    'a lane that hands no container a path needs no exclusion, and a blanket one would disable conversion a lane may rely on');
  // Both names, because which one a given Git for Windows honours is not knowable from here:
  // MSYS_NO_PATHCONV is Git's own switch and MSYS2_ARG_CONV_EXCL is the upstream runtime's.
  assert.deepEqual(Object.keys(MSYS_PATHCONV_ENV).sort(), ['MSYS2_ARG_CONV_EXCL', 'MSYS_NO_PATHCONV']);
});

test('off Windows the lane env is untouched — every platform, both lane kinds', () => {
  for (const platform of ['darwin', 'linux', 'freebsd']) {
    assert.deepEqual(msysPathconvEnv(platform), {});
    for (const container of [true, false]) {
      assert.deepEqual(laneWindowsEnv(semgrep, {}, { platform, container }), {});
      assert.deepEqual(laneWindowsEnv(osv, {}, { platform, container }), {});
    }
  }
});

// ── the second witness: the SOURCES, not the helper ─────────────────────────────────────────────
// The helper above only reaches a lane the runner starts. These scripts are also run by hand and
// by each other, and each builds a `-v host:container` or `--mount-source` argument of its own, so
// each needs the switches in its own environment. A grep is the right instrument here and the
// wrong one alone: it cannot tell a script that sets them from one that mentions them, and a
// detector that finds nothing reads exactly like a tree with nothing to find. So the population is
// asserted too.
test('every bin/*.sh that hands a container or the sandbox CLI a path exports the MSYS switches', () => {
  const dir = join(CW, 'bin');
  const hands = [];
  const sets = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.sh')).sort()) {
    const text = readFileSync(join(dir, name), 'utf8');
    // Comments are stripped first: this file's own explanation of the defect names `-v C:/x:/src`.
    const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    // A mount argument always pairs a host path with a container one, so the colon-then-slash is
    // what distinguishes `-v "$VOL":/vdb` from `command -v "$CW_PY"`, which carries no path at all.
    if (/docker\s+(?:run|compose|exec)\b|(?:-v|--volume|--mount|--mount-source)[ =]"?\S*:\//.test(code)) hands.push(name);
    if (/^export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='\*'$/m.test(code)) sets.push(name);
  }
  assert.ok(hands.length >= 7,
    `the detector found only ${hands.length} container scripts, and the tree has more than that — a detector that reads nothing reports a clean tree it never saw`);
  assert.deepEqual(hands.filter((n) => !sets.includes(n)), [],
    'each of these builds a container path argument and would hand docker a rewritten one under Git Bash');
  assert.deepEqual(sets.filter((n) => !hands.includes(n)), [],
    'a script that sets the switches and hands no container a path is dead configuration — drop it or the pair stops meaning anything');
});

// ── the effect, through the runner: the lane still runs on this platform ─────────────────────────
// `env > file` is the only witness that cannot share the helper's failure mode — it reads the
// child's real environment. It can only be run where the suite runs, so what it proves here is the
// off-Windows direction: a semgrep-shaped lane and a docker-shaped lane both execute, and neither
// carries a variable this platform never needed.
// The requirement gate would refuse both lanes on a host with no semgrep or no docker daemon, and a
// refused lane writes no env to read. Neither tool is ever run by `env > file`, so a fake of each
// goes first on PATH and the docker probe cache is the fixture's own: the gate is satisfied by the
// fixture, not by what this machine has installed.
test('a lane runs with its env untouched on this platform', async () => {
  const T = mkdtempSync(join(tmpdir(), 'cw-win-env-'));
  try {
    const repo = join(T, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'README.md'), 'fixture\n');
    const reports = join(T, 'reports'); mkdirSync(reports);
    const manifest = join(T, 'm.json');
    const fakes = join(T, 'bin'); mkdirSync(fakes);
    fakeSimple(fakes, 'semgrep');
    fakeDocker(fakes, { info: 'ok' });
    const dump = (id, requires) => ({ id, egress: 'none', groups: ['all'], requires, local: [`env > "$CW_REPORT_DIR/${id}.env"`] });
    writeFileSync(manifest, JSON.stringify({ repo: 'fixture',
      checks: [dump('py', { tools: ['semgrep'] }), dump('box', { tools: ['docker'], docker: true })] }));
    const env = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_ASSERT_TREE: '0', CW_SELF_SWEEP: '0',
      CW_SANDBOX: 'off', CW_PERF_FEEDBACK: join(T, 'perf.jsonl'), FORCE_COLOR: '0',
      PATH: `${fakes}${delimiter}${process.env.PATH || ''}`, FAKE_LOG: join(T, 'fakes.log'), FAKE_DIR: T,
      CW_DOCKER_PROBE_CACHE: join(T, 'docker-probe.json') };
    delete env.PYTHONUTF8; delete env.MSYS_NO_PATHCONV; delete env.MSYS2_ARG_CONV_EXCL;
    const out = await new Promise((res) => {
      const c = spawn(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'run', 'all', '--manifest', manifest, '--repo', repo, '--no-fail-fast'],
        { cwd: T, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; });
      c.on('close', () => res(o));
    });
    for (const id of ['py', 'box']) {
      let text;
      try { text = readFileSync(join(reports, `${id}.env`), 'utf8'); } catch (e) { assert.fail(`the ${id} lane wrote no env (${e.message}):\n${out}`); }
      const keys = new Set(text.split('\n').filter(Boolean).map((l) => l.slice(0, l.indexOf('='))));
      assert.ok(keys.has('CW_REPORT_DIR'), `the ${id} lane did not run with a report dir, so the absences below prove nothing`);
      for (const k of ['PYTHONUTF8', 'MSYS_NO_PATHCONV', 'MSYS2_ARG_CONV_EXCL']) {
        assert.equal(keys.has(k), false, `${k} reached a lane on ${process.platform}, where nothing reads it`);
      }
    }
  } finally { rmSync(T, { recursive: true, force: true }); }
});
