// node --test bin/test/ — via:'exec' records, the CLI-written-store attribution added 2026-08-24.
//
// THE CASE THAT MOTIVATED THIS IS TEST 1 and it is written from the real command line, verbatim.
// A session ran `node monitor/sweep.mjs all 100randomrepos --jobs 4`, was compacted, lost its own
// memory of the launch, and then told the operator the running sweep was another session's work.
// Nothing in the ledger could contradict it. If that command stops producing a record, this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execScriptsFrom, execWritesFrom, fitCommand, MAX_CMD_CHARS, ledgerChainPaths } from '../lib/touch-ledger-core.mjs';

const HOOK = presolve(dirname(fileURLToPath(import.meta.url)), '..', 'touch-ledger.mjs');

/** Run the hook on one payload against a scratch ledger; return the parsed records. */
function runHook(ev, tag) {
  const L = join(tmpdir(), `touch-exec-${tag}-${process.pid}.jsonl`);
  rmSync(L, { force: true });
  execFileSync('node', [HOOK], { input: JSON.stringify(ev), env: { ...process.env, CW_TOUCH_LEDGER: L }, encoding: 'utf8' });
  let rows = [];
  try { rows = readFileSync(L, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* none written */ }
  rmSync(L, { force: true });
  return rows;
}

// The repo-membership oracle, as a set — the hook injects an existsSync-backed check instead.
const REPO_SCRIPTS = new Set([
  'monitor/sweep.mjs', 'monitor/rollup.mjs', 'bin/scorecard-scan.sh',
  'bin/depscan-scan.sh', 'bin/projectstatus.mjs', 'cra/watch.mjs',
]);
// The oracle both decides and normalises; here it also maps an absolute path back to repo-relative,
// which is what the hook's resolve()/relative() pair does against the real root.
const REPO = '/work/Repositories/Portll/commitwork';
const inRepo = (tok) => {
  const r = tok.startsWith(`${REPO}/`) ? tok.slice(REPO.length + 1) : tok;
  return REPO_SCRIPTS.has(r) ? r : null;
};

test('the sweep that went unattributed is recorded', () => {
  const found = execScriptsFrom('node monitor/sweep.mjs all 100randomrepos --jobs 4', inRepo);
  assert.deepEqual(found, ['monitor/sweep.mjs'],
    'the launch that this whole record type exists for must produce exactly one row');
});

test('a $VAR-prefixed path resolves by its repo-relative remainder', () => {
  // The real invocations in bin/*.sh look like this; a literal-path-only matcher would miss them all.
  assert.deepEqual(execScriptsFrom('bash $CW_ROOT/bin/scorecard-scan.sh', inRepo), ['bin/scorecard-scan.sh']);
  assert.deepEqual(execScriptsFrom('CW_MONITOR_OUT=$OUT node $R/monitor/rollup.mjs $R/reports/x', inRepo),
    ['monitor/rollup.mjs']);
});

test('a path that is NOT a repo script is DROPPED, never guessed', () => {
  // An invented row in an ownership ledger is worse than a missing one.
  assert.deepEqual(execScriptsFrom('node /tmp/scratch.mjs', inRepo), []);
  assert.deepEqual(execScriptsFrom('node ../other-repo/monitor/sweep.mjs', inRepo), []);
  assert.deepEqual(execScriptsFrom('python3 ~/elsewhere/tool.py', inRepo), []);
});

test('commands that write nothing produce no rows at all', () => {
  // The hook fires on EVERY Bash call. A ledger that records `ls` is noise that hides the signal.
  for (const c of ['git status --porcelain', 'ls -lt reports/', 'rg -n foo monitor/', 'docker ps']) {
    assert.deepEqual(execScriptsFrom(c, inRepo), [], `"${c}" must not produce a row`);
  }
});

test('several writers in one command line are each recorded, once', () => {
  const found = execScriptsFrom('node monitor/sweep.mjs all && node monitor/rollup.mjs && node monitor/rollup.mjs', inRepo);
  assert.deepEqual(found, ['monitor/sweep.mjs', 'monitor/rollup.mjs'], 'order preserved, duplicates collapsed');
});

test('the command is bounded — and a command, unlike a path, may be clipped', () => {
  const short = fitCommand('  node   monitor/sweep.mjs   all  ');
  assert.equal(short.cmd, 'node monitor/sweep.mjs all', 'whitespace collapsed to keep the record one line');
  assert.equal(short.clipped, false);

  const long = fitCommand(`node monitor/sweep.mjs ${'x'.repeat(5000)}`);
  assert.equal(long.cmd.length, MAX_CMD_CHARS);
  assert.equal(long.clipped, true, 'a clipped command must SAY it was clipped');
  assert.ok(long.cmd.startsWith('node monitor/sweep.mjs'),
    'the head carries the entry point — clipping must never cost the identifying part');
});

test('a heredoc body cannot smuggle a newline into the ledger line', () => {
  // touches.jsonl is JSONL with no lock; a raw newline in a field would tear the file for everyone.
  const { cmd } = fitCommand("node monitor/rollup.mjs <<'EOF'\nline two\nline three\nEOF");
  assert.ok(!cmd.includes('\n'), 'no raw newline may reach the record');
});

test('an ABSOLUTE invocation is matched and normalised to the same key as a relative one', () => {
  // This is the case the vacuity test below caught: the matcher had no leading `/?`, so every
  // absolute invocation silently produced no record — and absolute paths are the ordinary form for
  // any command that does not assume a cwd.
  assert.deepEqual(execScriptsFrom(`node ${REPO}/monitor/rollup.mjs`, inRepo), ['monitor/rollup.mjs']);
  assert.deepEqual(
    execScriptsFrom(`node monitor/rollup.mjs && node ${REPO}/monitor/rollup.mjs`, inRepo),
    ['monitor/rollup.mjs'],
    'one file must occupy ONE ledger key however it was typed — otherwise the oracle answers '
    + 'differently depending on the spelling of the command');
});

// ---- the field contract: an exec record must be INVISIBLE to every ownership reader -------------
// This is the defect the first version shipped with and it was live for ~20 minutes. `f` means
// "this session wrote this file"; ~40 sites read it and none inspects `via`. Putting an executed
// script under `f` made `node --test x.test.mjs` claim ownership of x.test.mjs, and recorded a
// co-session as having touched three files it had only RUN. Filtering at each reader is the fragile
// fix — the one that forgets produces a wrong blame. These tests pin the field, not the filter.

test('an exec record carries NO `f` — an ownership reader must not see it at all', () => {
  const rows = runHook({
    session_id: 'cafebabe9999', tool_name: 'Bash',
    tool_input: { command: 'node monitor/sweep.mjs all 100randomrepos --jobs 4' }, tool_response: 'ok',
  }, 'nof');
  assert.equal(rows.length, 1, 'the launch must still be recorded — the fix must not silence it');
  const [r] = rows;
  assert.equal(r.via, 'exec');
  assert.equal(r.x, 'monitor/sweep.mjs', 'the script belongs under `x`');
  assert.ok(!('f' in r),
    '`f` means "wrote this file". attributeFiles() matches on it and never checks `via`, so an '
    + 'exec record carrying `f` silently converts "ran it" into "owns it".');
  assert.ok(r.cmd.includes('100randomrepos'), 'the command line is what makes it recoverable');
});

test('an EDIT still carries `f` — the fix must not break real attribution', () => {
  // Guards the obvious over-correction: dropping `f` everywhere would make the ledger useless.
  const rows = runHook({
    session_id: 'cafebabe9999', tool_name: 'Edit',
    tool_input: { file_path: join(presolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'monitor/sweep.mjs'), old_string: 'a', new_string: 'b' },
  }, 'edit');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].f, 'monitor/sweep.mjs', 'a real edit must still land under `f`');
  assert.ok(!('x' in rows[0]), 'and must not gain an `x`');
  assert.equal(rows[0].t, 'edit');
});

test('NOT VACUOUS: the oracle is what decides, so a wrong oracle fails loudly', () => {
  // If execScriptsFrom ignored its oracle and returned every path-shaped token, the DROPPED tests
  // above would still pass by accident on some inputs. Prove the oracle is actually consulted.
  assert.deepEqual(execScriptsFrom('node monitor/sweep.mjs all', () => null), [],
    'an oracle that says no must produce nothing');
  assert.deepEqual(execScriptsFrom('node /tmp/anything.mjs', (t) => t), ['/tmp/anything.mjs'],
    'an oracle that says yes must produce the row — this is what caught the missing leading slash');
});

// ---- P16 regression: a path NAMED is not a path RUN ---------------------------------------------
// Published as taxonomy class P16 "Attribution to an untouched subject". The instance is real and
// its ground truth is doubly established: the author identified themselves, and the true target was
// known independently. SCRIPT_RE's delimiter class accepted a quote, so a path inside a string
// literal was recorded as an execution.
//
// Both directions are asserted separately, because only one of them lies to you: a fix that made
// execScriptsFrom return [] for everything would pass the false-positive half alone.
test('P16: a script named inside a string literal is not recorded as invoked', () => {
  const real = "cd /repo python3 - <<'PYEOF' import io p='sitemap/README.md'; s=io.open('admin/serve.mjs').read()";
  assert.deepEqual(execScriptsFrom(real, (t) => t), [],
    'a path read by the command is not a path the command ran');

  for (const c of [
    "grep -n foo admin/serve.mjs",
    "rg --files-with-matches 'x' bin/gate-tests.mjs",
    "cat monitor/sweep.mjs | head -20",
    "echo 'see bin/scan.sh for details'",
  ]) {
    assert.deepEqual(execScriptsFrom(c, (t) => t), [], `"${c}" names a script, it does not run one`);
  }
});

test('P16 second witness: narrowing did not empty the invoked set', () => {
  // The false-negative direction. Without this, returning [] unconditionally passes the test above.
  for (const [cmd, want] of [
    ['node monitor/sweep.mjs all', ['monitor/sweep.mjs']],
    ['bash bin/scorecard-scan.sh', ['bin/scorecard-scan.sh']],
    ['python3 tools/render.py --out x', ['tools/render.py']],
    ['CW_OUT=/tmp node monitor/rollup.mjs', ['monitor/rollup.mjs']],
    ['node --experimental-strip-types bin/x.mjs', ['bin/x.mjs']],
    ['node a.mjs && node b.mjs', ['a.mjs', 'b.mjs']],
  ]) {
    assert.deepEqual(execScriptsFrom(cmd, (t) => t), want, `"${cmd}" IS an invocation`);
  }
});

// ---- P16 second half: a shell-mediated WRITE is a write ------------------------------------------
// Narrowing `x` was half a fix. Measured the same day: a session holding 23 rows, all via:exec and
// none carrying `f`, against 15 files it had just committed — and gate-tests-core.mjs:82 skips every
// row without `f`. These assert the derivation only; the PRODUCER additionally confirms each
// candidate against the filesystem before recording, because syntax alone would repeat P16.
test('P16b: redirections and output flags are writes', () => {
  const id = (t) => t;
  for (const [cmd, want] of [
    ['node x.mjs > out.json', ['out.json']],
    ['node x.mjs >> out.json', ['out.json']],
    ['nuclei -u $U -o reports/n.jsonl >reports/n.log 2>&1', ['reports/n.jsonl', 'reports/n.log']],
    ['thing | tee build.log', ['build.log']],
    ['gen --output=dist/a.html', ['dist/a.html']],
  ]) {
    assert.deepEqual(execWritesFrom(cmd, id), want, `"${cmd}" writes ${want.join(', ')}`);
  }
});

test('P16b second witness: descriptors, sinks and reads are NOT writes', () => {
  // The false-positive direction, asserted apart from the one above. A fix returning every token
  // would satisfy the test above on its own, and a descriptor read as a filename is exactly the
  // plausible-wrong-row shape the whole class is about.
  const id = (t) => t;
  for (const cmd of [
    'cmd 2>&1',
    'cmd >&2',
    'cmd > /dev/null',
    'grep -n foo admin/serve.mjs',
    'cat monitor/sweep.mjs | head -20',
    'node --test bin/test/x.test.mjs',
  ]) {
    assert.deepEqual(execWritesFrom(cmd, id), [], `"${cmd}" writes nothing`);
  }
});

test('P16b: a path outside the repo is not recorded', () => {
  // The oracle is the repo-membership test, same as execScriptsFrom's.
  assert.deepEqual(execWritesFrom('node x.mjs > /tmp/scratch.json', () => null), []);
});

// ── heredoc bodies are DATA, not shell (2026-08-29) ─────────────────────────────────────────────
// Found by three sessions arriving at it from different directions and all describing it wrongly:
// 44 read a ledger row `{"x":"admin/serve.mjs","via":"exec","cmd":"… p='sitemap/README.md' …"}` and
// concluded `x` "takes a path-like token from the command rather than the target"; 96 found the
// ledger silent about a file it had demonstrably edited and read that as the same defect. Neither
// was right, because `x` never claimed to name an edit — `f` means WROTE, `x` means RAN, and the
// header above records that separating them is what stopped the first version misattributing.
//
// The real mechanism is narrower and is reproduced below: the whole command was split on
// ;/&&/|/newline INCLUDING heredoc bodies, so a data line whose first word resolved to a repo file
// was recorded as an executed script. The consequence is not misassigned authorship — it is
// execution history naming a module the command never ran, which is the "confident wrong name"
// this file's header forbids and the reason the reader is never prompted to look further.
test('a heredoc body is data — a repo path inside one is not an invocation', () => {
  const cmd = "python3 - <<'PYEOF'\nimport io\nmonitor/sweep.mjs\nPYEOF";
  assert.deepEqual(execScriptsFrom(cmd, inRepo), [],
    'a bare repo path on a data line inside a heredoc executed nothing; recording it names an innocent module');
});

test('the closing delimiter ends the body — a real invocation after it is still recorded', () => {
  const cmd = "python3 - <<'PYEOF'\nmonitor/sweep.mjs\nPYEOF\nnode monitor/rollup.mjs";
  assert.deepEqual(execScriptsFrom(cmd, inRepo), ['monitor/rollup.mjs'],
    'stripping the body must not swallow the rest of the command — that would trade a wrong name for a blind spot');
});

test('an unterminated heredoc drops the remainder rather than guessing', () => {
  // fitCommand truncates long commands, so a clipped heredoc reaches this function with no closing
  // tag. Silence is recoverable by looking at `cmd`, which is retained in full on every row.
  assert.deepEqual(execScriptsFrom("python3 - <<'PYEOF'\nmonitor/sweep.mjs", inRepo), []);
});

test('unquoted and dash-suppressed heredoc tags are both bodies', () => {
  assert.deepEqual(execScriptsFrom('cat <<EOF\nmonitor/sweep.mjs\nEOF', inRepo), []);
  assert.deepEqual(execScriptsFrom('cat <<-EOF\n\tmonitor/sweep.mjs\n\tEOF', inRepo), []);
});

test('a command with no heredoc is untouched by the stripper', () => {
  assert.deepEqual(execScriptsFrom('node monitor/sweep.mjs all && node monitor/rollup.mjs', inRepo),
    ['monitor/sweep.mjs', 'monitor/rollup.mjs']);
});

// ---- the rotation chain: depth is unbounded, and .10 is not between .1 and .2 -------------------
// ledgerChainPaths returned a fixed [livePath.1, livePath] while shiftArchives shifts .N to .N+1
// with no cap. Measured on the live store 2026-08-29: 22,808 rows existed across the chain and the
// two-file window covered 6,140 of them. The live consumer (gate-tests.mjs) had already been fixed
// to enumerate; this had not, and nothing failed — which is why it is pinned here rather than
// trusted to stay right.
test('the chain is enumerated to any depth, oldest generation first', () => {
  const dir = () => ['touches.jsonl', 'touches.jsonl.1', 'touches.jsonl.2', 'touches.jsonl.3'];
  assert.deepEqual(ledgerChainPaths('/s/touches.jsonl', { readdirSync: dir }), [
    '/s/touches.jsonl.3', '/s/touches.jsonl.2', '/s/touches.jsonl.1', '/s/touches.jsonl',
  ], 'higher N is older, so it must come first');
});

test('generations sort NUMERICALLY — .10 is older than .2, not between .1 and .2', () => {
  // The bug a lexical sort would produce, and the reason this is asserted separately: string order
  // puts "10" after "1" and before "2", which silently reorders the chain once it passes nine.
  const dir = () => ['touches.jsonl', 'touches.jsonl.1', 'touches.jsonl.2', 'touches.jsonl.10'];
  assert.deepEqual(ledgerChainPaths('/s/touches.jsonl', { readdirSync: dir }), [
    '/s/touches.jsonl.10', '/s/touches.jsonl.2', '/s/touches.jsonl.1', '/s/touches.jsonl',
  ]);
});

test('only this ledger\'s generations are returned — the false-positive direction', () => {
  // Asserted separately because a matcher that returned everything in the directory would satisfy
  // the two tests above on its own.
  const dir = () => ['touches.jsonl', 'touches.jsonl.1', 'spine.jsonl.1', 'touches.jsonl.bak', 'README'];
  assert.deepEqual(ledgerChainPaths('/s/touches.jsonl', { readdirSync: dir }),
    ['/s/touches.jsonl.1', '/s/touches.jsonl']);
});
