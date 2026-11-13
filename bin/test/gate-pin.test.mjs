// bin/lib/gate-pin.mjs + the pin half of bin/install-commit-msg.mjs: an installed commit-msg gate
// runs an exported copy of a COMMITTED commitwork revision, and an uncommitted edit in the
// checkout changes nothing until it is committed AND re-exported.
//
// Two witnesses, because they cannot share a failure mode. The synthetic commitwork tree below is
// a real git repository whose gate is a stub, so the pin, the refresh, the ledger and the
// refusals are asserted by RUNNING the installed hook on real commits. The last test pins THIS
// repository and runs the real gate out of the export, which is the only way to know the
// whole-tree export actually carries the gate's import closure — bin/commit-msg.mjs reaches
// bin/commit-phase.mjs reaches bin/lib/store-paths.mjs reaches monitor/store-paths.mjs, so an
// export of bin/ and lib/ alone loads no gate at all.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installOne, refresh } from '../install-commit-msg.mjs';
import { exportDir, gateScript, ledgerPath, pinFor, readLedger, resolveRevision, verifyExport } from '../lib/gate-pin.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const git = (dir, ...args) => execFileSync('git', ['-C', dir,
  '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', ...args],
{ encoding: 'utf8' }).trim();

// The stub gate the synthetic commitwork tree commits. It refuses a Co-Authored-By trailer, which
// is what gate-pin's export check requires of any copy, and otherwise obeys one token so that a
// CHANGE to it is visible in a verdict. `process.exitCode`, never process.exit: an exit() can
// truncate the piped stderr the assertions read.
const stubGate = (token) => `import { readFileSync } from 'node:fs';
const msg = readFileSync(process.argv[2], 'utf8');
const refuse = (why) => { console.error(\`commit-msg: REFUSED. \${why}\`); process.exitCode = 1; };
if (/^Co-Authored-By:/mi.test(msg)) refuse('the message carries a Co-Authored-By trailer');
else if (!msg.includes('${token}')) refuse('the message does not say ${token}');
`;

/** A synthetic commitwork checkout whose committed gate obeys `token`. */
function commitwork(t, token = 'ALPHA') {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-cw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'commit-msg.mjs'), stubGate(token));
  git(dir, 'add', 'bin/commit-msg.mjs');
  git(dir, 'commit', '-q', '-m', 'the gate');
  return dir;
}

/** A repository to install the gate into, with one staged file to commit. */
function target(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-tgt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'f'), 'a\n');
  git(dir, 'add', 'f');
  return dir;
}

/** The gate dir for one test, through the documented override. */
function gateHome(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-dir-'));
  const before = process.env.CW_GATE_DIR;
  process.env.CW_GATE_DIR = dir;
  t.after(() => {
    if (before === undefined) delete process.env.CW_GATE_DIR; else process.env.CW_GATE_DIR = before;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const hookPath = (tgt) => join(tgt, '.git', 'hooks', 'commit-msg');

// A real commit, so the verdict asserted is the one a person would get: git runs the hook through
// its own shell (the only portable way to run it — a `.git/hooks/commit-msg` spawned directly has
// no interpreter on Windows), and a refusal means nothing was committed. Each attempt stages a new
// file so a refused one leaves work for the next.
let staged = 0;
const commit = (tgt, message) => {
  const f = `f${staged++}`;
  writeFileSync(join(tgt, f), 'x\n');
  git(tgt, 'add', f);
  const r = spawnSync('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=test',
    '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message], { cwd: tgt, encoding: 'utf8' });
  return { status: r.status, err: String(r.stderr || '') };
};

function capture(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { code: fn(), out: lines.join('\n') }; } finally { Object.assign(console, { log, error }); }
}

describe('the gate runs a committed revision, not a working tree', () => {
  test('an uncommitted edit changes nothing; committing and refreshing moves the gate', (t) => {
    gateHome(t);
    const cw = commitwork(t, 'ALPHA');
    const tgt = target(t);
    const first = resolveRevision(cw).revision;

    const r = installOne(`${tgt}=commitwork`, { write: true, cw });
    assert.equal(r.ok, true, r.line);
    assert.match(readFileSync(hookPath(tgt), 'utf8'), new RegExp(first), 'the hook must name the revision it runs');
    assert.equal(readLedger(cw).repos[0].revision, first);
    assert.equal(commit(tgt, 'feat: ALPHA\n').status, 0, 'the committed gate accepts its own token');
    assert.notEqual(commit(tgt, 'feat: BETA\n').status, 0);

    // The defect this pin exists for: the checkout's gate now says the opposite.
    writeFileSync(join(cw, 'bin', 'commit-msg.mjs'), stubGate('BETA'));
    assert.equal(commit(tgt, 'feat: ALPHA\n').status, 0, 'an uncommitted edit must not reach the gate');
    assert.notEqual(commit(tgt, 'feat: BETA\n').status, 0, 'an uncommitted edit must not reach the gate');

    // Control, so the four assertions above cannot pass by the hook simply not running: the same
    // install WITHOUT the pin — what every hook did before — obeys that edit at once.
    const loose = target(t);
    assert.equal(installOne(`${loose}=commitwork`, { write: true, unpinned: true, cw }).ok, true);
    assert.equal(commit(loose, 'feat: BETA\n').status, 0, 'control: an unpinned gate follows the working tree');
    assert.notEqual(commit(loose, 'feat: ALPHA\n').status, 0);

    // Committed but not refreshed: still the old revision. A pin that follows the trunk on its own
    // would be the same defect one commit later.
    git(cw, 'commit', '-q', '-am', 'the gate, inverted');
    const second = resolveRevision(cw).revision;
    assert.notEqual(second, first);
    assert.equal(commit(tgt, 'feat: ALPHA\n').status, 0, 'a commit alone must not move an installed gate');

    const ref = capture(() => refresh({ write: true, cw }));
    assert.equal(ref.code, 0, ref.out);
    assert.equal(commit(tgt, 'feat: BETA\n').status, 0, 'after --refresh the gate is the new commit');
    assert.notEqual(commit(tgt, 'feat: ALPHA\n').status, 0);
    assert.match(readFileSync(hookPath(tgt), 'utf8'), new RegExp(second));
    assert.equal(readLedger(cw).repos[0].revision, second);
    assert.equal(existsSync(exportDir(cw, first)), false, 'the export no gate names is removed');
  });

  test('a refresh with nothing new writes nothing and says nothing moved', (t) => {
    gateHome(t);
    const cw = commitwork(t);
    const tgt = target(t);
    assert.equal(installOne(`${tgt}=commitwork`, { write: true, cw }).ok, true);
    const hook = readFileSync(hookPath(tgt), 'utf8');
    const ledger = readFileSync(ledgerPath(cw), 'utf8');
    const first = capture(() => refresh({ cw }));           // dry run
    assert.equal(first.code, 0);
    assert.match(first.out, /DRY RUN, would pin to [0-9a-f]{40} \(already there\)/);
    assert.equal(capture(() => refresh({ write: true, cw })).code, 0);
    assert.equal(readFileSync(hookPath(tgt), 'utf8'), hook, 'an idempotent refresh rewrites the same bytes');
    assert.equal(readFileSync(ledgerPath(cw), 'utf8'), ledger);
  });

  test('a missing export refuses the commit and names --refresh', (t) => {
    gateHome(t);
    const cw = commitwork(t);
    const tgt = target(t);
    assert.equal(installOne(`${tgt}=commitwork`, { write: true, cw }).ok, true);
    rmSync(exportDir(cw, resolveRevision(cw).revision), { recursive: true, force: true });
    const r = commit(tgt, 'feat: ALPHA\n');
    assert.equal(r.status, 1, 'a gate that cannot run must refuse the commit');
    assert.match(r.err, /commit-msg: REFUSED\./);
    assert.match(r.err, /--refresh --write/, 'the refusal must name the command that fixes it');
  });

  test('a commitwork tree with no history is refused, naming --unpinned', (t) => {
    gateHome(t);
    const tgt = target(t);
    const bare = mkdtempSync(join(tmpdir(), 'cw-gate-nogit-'));
    t.after(() => rmSync(bare, { recursive: true, force: true }));
    const r = installOne(`${tgt}=commitwork`, { write: true, cw: bare });
    assert.equal(r.ok, false);
    assert.match(r.line, /no committed gate to pin/);
    assert.match(r.line, /--unpinned/);
    assert.equal(existsSync(hookPath(tgt)), false, 'nothing may be installed when the pin is refused');
    // The opt-out is explicit, and it says what it did.
    const u = installOne(`${tgt}=commitwork`, { write: true, unpinned: true, cw: bare });
    assert.equal(u.ok, true, u.line);
    assert.match(u.line, /UNPINNED/);
    assert.equal(readLedger(bare).repos.length, 0, 'an unpinned install is not refreshable, so it is not recorded');
  });
});

describe('the export check is what stands between a broken commit and every repository', () => {
  test('a revision whose gate cannot load is not exported, and no gate moves', (t) => {
    gateHome(t);
    const cw = commitwork(t, 'ALPHA');
    const tgt = target(t);
    assert.equal(installOne(`${tgt}=commitwork`, { write: true, cw }).ok, true);
    const good = resolveRevision(cw).revision;

    writeFileSync(join(cw, 'bin', 'commit-msg.mjs'), "import { nope } from './gone.mjs';\n");
    git(cw, 'commit', '-q', '-am', 'the gate, broken');
    const r = capture(() => refresh({ write: true, cw }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /does not run/);
    assert.equal(existsSync(exportDir(cw, resolveRevision(cw).revision)), false, 'a copy that cannot run must not be installed');
    assert.match(readFileSync(hookPath(tgt), 'utf8'), new RegExp(good), 'the working gate must stay installed');
    assert.equal(commit(tgt, 'feat: ALPHA\n').status, 0);
  });

  test('a gate that accepts a forbidden trailer fails the check — the direction that lies', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-gate-ver-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const script = join(dir, 'gate.mjs');
    writeFileSync(script, 'process.exitCode = 0;\n');
    const permissive = verifyExport(script);
    assert.equal(permissive.ok, false);
    assert.match(permissive.why, /Co-Authored-By/);
    // and the other direction, asserted separately: a gate that refuses it passes
    writeFileSync(script, stubGate('ALPHA'));
    assert.equal(verifyExport(script).ok, true);
  });

  test('a ledger that cannot be read is not an empty one', (t) => {
    gateHome(t);
    const cw = commitwork(t);
    const tgt = target(t);
    assert.equal(installOne(`${tgt}=commitwork`, { write: true, cw }).ok, true);
    const hook = readFileSync(hookPath(tgt), 'utf8');
    writeFileSync(ledgerPath(cw), '{"repos": [\n');
    const r = capture(() => refresh({ write: true, cw }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /REFUSED/);
    assert.equal(readFileSync(hookPath(tgt), 'utf8'), hook, 'a refusal must leave the installed gate alone');
    // Absent is the one state that IS empty.
    rmSync(ledgerPath(cw));
    const none = capture(() => refresh({ write: true, cw }));
    assert.equal(none.code, 0, none.out);
    assert.match(none.out, /nothing to refresh/);
  });
});

describe('the real gate, exported', () => {
  test("this repository's committed gate runs out of its export, trailer refusal and all", (t) => {
    const dir = gateHome(t);
    const before = process.env.CW_GATE_REF;
    process.env.CW_GATE_REF = 'HEAD';   // this worktree's own commit, whatever branch it sits on
    t.after(() => { if (before === undefined) delete process.env.CW_GATE_REF; else process.env.CW_GATE_REF = before; });

    const pin = pinFor(REPO, { write: true });
    assert.equal(pin.ok, true, pin.why);
    assert.equal(pin.script, gateScript(REPO, pin.revision));
    assert.ok(existsSync(pin.script), 'the export must carry bin/commit-msg.mjs');
    assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('.export-')), [], 'no half-extracted tree may be left behind');

    // The export runs the REAL gate: a verdict on an ordinary message, a refusal of the trailer.
    const msg = join(dir, 'MSG');
    const run = (text) => {
      writeFileSync(msg, text);
      const r = spawnSync(process.execPath, [pin.script, msg], { cwd: dir, encoding: 'utf8' });
      return { status: r.status, err: String(r.stderr || '') };
    };
    const plain = run('feat(gates): pin the commit-msg gate to a committed revision\n');
    assert.equal(plain.status, 0, plain.err);
    const trailer = run('feat(gates): pin the gate\n\nCo-Authored-By: nobody <nobody@example.invalid>\n');
    assert.equal(trailer.status, 1);
    assert.match(trailer.err, /Co-Authored-By/);

    // Idempotent: the same revision is reused rather than re-exported.
    assert.equal(pinFor(REPO, { write: true }).exported, false);
  });
});
