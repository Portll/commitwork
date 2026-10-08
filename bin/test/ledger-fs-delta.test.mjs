// R-A · write detection must key on the EFFECT, not on the tool.
//
// THE FALSIFIER, named by the remediation plan as its acceptance test: *a `python3 - <<'PY'` heredoc
// writing a tracked file MUST produce a write row. That exact form produced none today, six times.*
// So this file does not simulate the heredoc — it RUNS one, and asserts against the filesystem.
//
// The defect being closed: `execWritesFrom` parses the command string for write-looking paths, and
// the caller then confirms with an mtime window. Two witnesses, but the second only ever runs on
// paths the FIRST one named, so the parser is the recall ceiling. Every write it cannot parse
// becomes a row indistinguishable from a read — and absence of a write marker was read as "this was
// a read", which is an unsupported pass inside the instrument every attribution downstream trusts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, rmSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execWritesFrom, writesFromFsDelta, snapshotEntry, accessForDelta } from '../lib/touch-ledger-core.mjs';
import { resolvePosixShell } from '../../lib/posix-shell.mjs';
import { fileURLToPath } from 'node:url';

// ── running a POSIX shell from a test, on Windows, without wrecking the repo ────────────────────
//
// These tests RUN a real heredoc rather than simulating one, which is the whole point of the file.
// Two things about that were wrong on Windows, and the second one left litter in the repository.
//
// 1. `bash` was assumed to be on PATH. On a stock Windows 11 box it is not — even with Git for
//    Windows installed, which puts bash.exe inside its own tree and not on PATH. resolvePosixShell()
//    finds it there (it is the same resolver bin/commitwork.mjs uses for manifest commands), so
//    these tests now RUN on a standard box instead of failing on a missing prerequisite. Where
//    there is genuinely no shell they SKIP, because a POSIX shell is an optional install here.
//
// 2. A Windows path was interpolated UNQUOTED into the shell command line:
//        spawnSync('bash', ['-c', `cat > ${join(dir, 'new.txt')} <<'E'…`])
//    `join()` produced `C:\Users\…\Temp\cw-fsdelta-XXX\new.txt`, and to a POSIX shell every `\` is
//    an ESCAPE character — so the path collapsed to `C:Users…new.txt`, which has no separators and
//    is therefore RELATIVE. The redirect wrote it into the process's cwd: the repository root.
//    Found as four stray files sitting in `git status` (`C:UsersmeAppData…new.txt`, the
//    colon stored as U+F03A), created afresh by every run of the suite.
//
//    This is the same family as the batch-shim problem in lib/win-spawn.mjs — a path handed to a
//    shell as syntax rather than as data — and it is invisible on POSIX, where paths contain no
//    backslashes and the bug simply cannot fire.
const SHELL = resolvePosixShell();

/** A Windows path a POSIX shell can actually use, single-quoted so nothing in it is syntax. */
function shq(p) {
  // Forward slashes: Git Bash accepts `C:/Users/...` and resolves it to the same file. Single
  // quotes stop every remaining character being interpreted, and a literal `'` is closed, escaped
  // and reopened — the only correct way to put one inside single quotes.
  return `'${String(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

/** Run a POSIX shell command, or report why it could not be run. */
function sh(command, opts = {}) {
  if (!SHELL) return { skipped: 'no POSIX shell on this box (an optional install — see lib/posix-shell.mjs)' };
  return spawnSync(SHELL.path, ['-c', command], { encoding: 'utf8', ...opts });
}

const hasPython = () => !!SHELL && sh('command -v python3 >/dev/null 2>&1').status === 0;

/** Snapshot every file in a flat dir, the way the hook would over a repo. */
function snap(dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    try { const e = snapshotEntry(statSync(join(dir, name))); if (e) out[name] = e; } catch { /* gone */ }
  }
  return out;
}

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-fsdelta-'));

test('THE FALSIFIER: a python3 heredoc writing a file is DETECTED — the exact form that produced nothing', (t) => {
  if (!SHELL) { t.skip('no POSIX shell (optional install)'); return; }
  if (!hasPython()) { t.skip('no python3 (optional install)'); return; }
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'target.mjs'), 'export const x = 1;\n');
    const before = snap(dir);

    // The real thing, not a stand-in. This is how an agent under a Bash-first instruction edits.
    // The path goes in with forward slashes so python's own string literal does not eat the
    // backslashes as escapes — `"C:\Users\new"` contains \U and \n, not a path.
    const pyPath = join(dir, 'target.mjs').replace(/\\/g, '/');
    const command = `python3 - <<'PY'\np="${pyPath}"\ns=open(p).read()\nopen(p,"w").write(s.replace("1","2"))\nPY`;
    const r = sh(command);
    assert.equal(r.status, 0, `the heredoc must actually run: ${r.stderr}`);

    // 1. THE PARSER IS BLIND TO IT — this is the defect, asserted rather than asserted-about.
    const parsed = execWritesFrom(command, (tok) => (tok.endsWith('target.mjs') ? 'target.mjs' : null));
    assert.deepEqual(parsed, [],
      'if the parser has learned this form, this test is obsolete — delete it and say so, do not weaken it');

    // 2. THE EFFECT IS NOT. This is the fix.
    const changed = writesFromFsDelta(before, snap(dir), { parserNamed: parsed });
    const hit = changed.find((c) => c.rel === 'target.mjs');
    assert.ok(hit, 'the filesystem delta MUST see the write the parser missed — this is R-A');
    assert.equal(hit.kind, 'modified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an uncorroborated delta is `undetermined`, never `write` — a confident wrong owner is worse than none', () => {
  const hit = { rel: 'x.mjs', kind: 'modified', corroborated: false };
  assert.equal(accessForDelta(hit), 'undetermined',
    'eleven sessions write this tree; a delta cannot tell my write from theirs and must not claim to');
});

test('a corroborated delta IS a write — two witnesses that cannot fail the same way', () => {
  assert.equal(accessForDelta({ rel: 'x.mjs', kind: 'modified', corroborated: true }), 'write');
});

test('a file created by the command is reported, not only a modified one', (t) => {
  if (!SHELL) { t.skip('no POSIX shell (optional install)'); return; }
  const dir = scratch();
  try {
    const before = snap(dir);
    const r = sh(`cat > ${shq(join(dir, 'new.txt'))} <<'E'\nhi\nE`);
    // ASSERTED, not fire-and-forget. Unchecked, this spawn failed silently on Windows for as long
    // as the file has existed — and its redirect wrote into the repository root instead.
    assert.equal(r.status, 0, `the shell write must succeed: ${r.stderr}`);
    const changed = writesFromFsDelta(before, snap(dir));
    assert.deepEqual(changed.map((c) => [c.rel, c.kind]), [['new.txt', 'created']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a DELETION is a write to the tree — a ledger blind to it cannot explain a vanished module', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'doomed.mjs'), 'x');
    const before = snap(dir);
    unlinkSync(join(dir, 'doomed.mjs'));
    const changed = writesFromFsDelta(before, snap(dir));
    assert.deepEqual(changed.map((c) => [c.rel, c.kind]), [['doomed.mjs', 'deleted']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an untouched tree yields nothing — the detector is not reporting churn', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'a.txt'), 'a');
    const s = snap(dir);
    assert.deepEqual(writesFromFsDelta(s, s), [],
      'a delta that always fires is as useless as one that never does');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a same-size in-place edit is still caught — size alone would miss it', (t) => {
  if (!SHELL) { t.skip('no POSIX shell (optional install)'); return; }
  const dir = scratch();
  try {
    const p = join(dir, 'same.txt');
    writeFileSync(p, 'aaaa');
    const before = snap(dir);
    // Force a distinct mtime; a fast filesystem can otherwise land both writes in one tick.
    const r = sh(`sleep 0.02; printf 'bbbb' > ${shq(p)}`);
    assert.equal(r.status, 0, `the shell write must succeed: ${r.stderr}`);
    const changed = writesFromFsDelta(before, snap(dir));
    assert.equal(changed.length, 1, 'mtime must carry the change when the size is identical');
    assert.equal(changed[0].kind, 'modified');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── R-1 · THE FIELD ─────────────────────────────────────────────────────────────────────────────
// A delta row must NOT occupy `f`. `f` means "this session WROTE this file" and ~40 call sites read
// it that way without inspecting `via`. This block has one witness — mtime — which is precisely the
// witness that cannot tell my write from a peer's on a shared checkout.
// This test was a TAUTOLOGY in its first form: it hand-built `{d:'x.mjs'}` and asserted the object
// had the property just given to it. The hook was never executed, so it would have passed with the
// hook still writing `f`. That is the defect this repo names most often — a guard that runs, cannot
// fail, and reports clean — committed inside the fix for a false-attribution defect. Replaced with a
// real execution: spawn the hook against a real dirty file and read what it actually wrote.
test('R-1: the HOOK writes `d` and never `f` — executed, not asserted about', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-r1-'));
  const ledger = join(dir, 'led.jsonl');
  const REPO = fileURLToPath(new URL('../..', import.meta.url));
  // The hook derives its repo root from its OWN location and offers no override, so this cannot run
  // against a fixture repo. It therefore creates its own subject inside the real tree and removes it
  // — depending on a pre-existing dirty file made this test pass only while something else had
  // recently written one, which is how its first version passed and then failed an hour later.
  const probe = join(REPO, '.cw-fsdelta-probe.tmp');
  try {
    writeFileSync(probe, 'probe\n');                       // untracked ⇒ git status lists it
    const ev = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo probe' }, session_id: 'r1test00' });
    const r = spawnSync('node', [join(REPO, 'bin', 'touch-ledger.mjs')], {
      input: ev, encoding: 'utf8', cwd: REPO,
      env: { ...process.env, CW_LEDGER_FS_DELTA: '1', CW_TOUCH_LEDGER: ledger },
    });
    assert.equal(r.status, 0, `the hook must exit 0: ${r.stderr}`);
    const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).filter((x) => x.via === 'fs-delta');
    const mine = rows.find((x) => x.d === '.cw-fsdelta-probe.tmp');
    assert.ok(mine, `the hook must observe the file it just saw change; got ${rows.length} delta row(s)`);
    assert.equal(mine.f, undefined, '`f` would make every existing reader treat this as authorship');
    assert.equal(mine.access, 'undetermined', 'a delta can never be write evidence');
    for (const row of rows) assert.equal(row.f, undefined, 'no delta row may occupy `f`');
  } finally {
    try { rmSync(probe, { force: true }); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-1: every existing reader drops a row with no `f` — the fix is safe by construction', () => {
  // Both live readers guard on `f` before anything else; this pins that contract so a future reader
  // cannot start consuming `d` as ownership without deliberately changing this test.
  const core = readFileSync(new URL('../gate-tests-core.mjs', import.meta.url), 'utf8');
  assert.match(core, /if \(!r\.f\) continue/, 'attributeFiles must still drop rows without f');
  const spine = readFileSync(new URL('../gate-spine.mjs', import.meta.url), 'utf8');
  assert.match(spine, /\.map\(\(r\) => r\.f\)\.filter\(Boolean\)/,
    'the spine gate must still drop rows without f — this is what makes `d` invisible to it');
});
