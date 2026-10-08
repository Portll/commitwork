import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRaw, parseArgs, hookText, runArgs, redact, HOOK_MARKER, CHAINED, EXIT } from '../hook.mjs';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hook.mjs');
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');

// assembled at run time so this source carries no provider-shaped token
const KEY = ['AK', 'IA'].join('') + 'Q3T7XZ2LMN4PRV8W';
const PLANT = `aws_key = "${KEY}"\n`;

// No inherited GIT_* (a hook or a session identity would leak in), no global or system config: a
// machine-wide core.hooksPath must never route a test install into a real hooks directory.
function env(extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && !k.startsWith('CW_')) e[k] = v;
  return { ...e, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    CW_HOOK_SCRIPT: HOOK, ...extra };
}
const git = (cwd, args, extra) => spawnSync('git', args, { cwd, encoding: 'utf8', env: env(extra) });
const hook = (cwd, args, extra) => spawnSync(process.execPath, [HOOK, ...args], { cwd, encoding: 'utf8', env: env(extra) });

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-hook-test-')));
  const r = join(root, 'r');
  mkdirSync(r);
  git(r, ['init', '-q', '-b', 'main']);
  return { root, r, done: () => rmSync(root, { recursive: true, force: true }) };
}
const commit = (r, msg = 'c') => git(r, ['commit', '-q', '-m', msg]);

describe('hook run: the staged content, read from the index', () => {
  test('a clean staged set exits 0 and says every lane ran', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      const r = hook(t.r, ['run']);
      assert.equal(r.status, EXIT.CLEAN, r.stderr);
      assert.match(r.stderr, /clean — every lane ran/);
    } finally { t.done(); }
  });

  test('a secret in the index blocks even when the working copy no longer has it', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'cfg.env'), PLANT);
      git(t.r, ['add', 'cfg.env']);
      writeFileSync(join(t.r, 'cfg.env'), 'clean\n');
      const r = hook(t.r, ['run', '--json']);
      assert.equal(r.status, EXIT.FINDINGS);
      const out = JSON.parse(r.stdout);
      assert.equal(out.verdict, 'blocked-findings');
      assert.equal(out.lanes[0].findings[0].cls, 'provider-key/aws');
      assert.ok(!r.stdout.includes(KEY), 'the credential itself is redacted from the output');
    } finally { t.done(); }
  });

  test('a secret only in the working copy, not staged, does not block', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'cfg.env'), 'clean\n');
      git(t.r, ['add', 'cfg.env']);
      writeFileSync(join(t.r, 'cfg.env'), PLANT);
      assert.equal(hook(t.r, ['run']).status, EXIT.CLEAN);
    } finally { t.done(); }
  });

  test('a secret already in HEAD that moved lines is reported, not blocked; --block-existing blocks it', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'cfg.env'), PLANT);
      git(t.r, ['add', 'cfg.env']);
      commit(t.r);
      writeFileSync(join(t.r, 'cfg.env'), `# a line above\n${PLANT}`);
      git(t.r, ['add', 'cfg.env']);
      const r = hook(t.r, ['run']);
      assert.equal(r.status, EXIT.CLEAN, r.stderr);
      assert.match(r.stderr, /already in HEAD, not added by this commit: cfg\.env:2/);
      assert.equal(hook(t.r, ['run', '--block-existing']).status, EXIT.FINDINGS);
    } finally { t.done(); }
  });

  test('a lane that cannot run blocks by default and is never reported clean under --unrun warn', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      const missing = { CW_GITLEAKS: join(t.root, 'no-such-gitleaks') };
      const b = hook(t.r, ['run', '--lanes', 'secrets,gitleaks'], missing);
      assert.equal(b.status, EXIT.UNRUN);
      assert.match(b.stderr, /gitleaks {2}NOT RUN — .*not installed/);
      const w = hook(t.r, ['run', '--lanes', 'secrets,gitleaks', '--unrun', 'warn', '--json'], missing);
      assert.equal(w.status, EXIT.CLEAN);
      const out = JSON.parse(w.stdout);
      assert.equal(out.verdict, 'allowed-unchecked');
      assert.deepEqual(out.unrun, ['gitleaks']);
    } finally { t.done(); }
  });

  test('outside a repository the secrets lane cannot run, which blocks', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'cw-hook-norepo-')));
    try {
      const r = hook(root, ['run'], { GIT_CEILING_DIRECTORIES: dirname(root) });
      assert.equal(r.status, EXIT.UNRUN);
      assert.match(r.stderr, /secrets {2}NOT RUN/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a repo-local commitwork.json is never executed', () => {
    const t = repo();
    try {
      const canary = join(t.root, 'canary');
      writeFileSync(join(t.r, 'commitwork.json'), JSON.stringify({
        name: 'x', repoPath: '.', checks: [{ id: 'c', run: `touch ${canary}` }] }));
      git(t.r, ['add', 'commitwork.json']);
      hook(t.r, ['run']);
      assert.equal(existsSync(canary), false);
    } finally { t.done(); }
  });

  test('the real gitleaks lane reads the index too', { skip: spawnSync('gitleaks', ['version']).status !== 0 && 'gitleaks is not installed here' }, () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      assert.equal(hook(t.r, ['run', '--lanes', 'gitleaks']).status, EXIT.CLEAN);
      writeFileSync(join(t.r, 'cfg.env'), PLANT);
      git(t.r, ['add', 'cfg.env']);
      assert.equal(hook(t.r, ['run', '--lanes', 'gitleaks']).status, EXIT.FINDINGS);
    } finally { t.done(); }
  });
});

describe('hook install / uninstall', () => {
  test('an installed hook blocks a real commit, and catches `commit -a` through its temporary index', () => {
    const t = repo();
    try {
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      const i = hook(t.r, ['install']);
      assert.equal(i.status, 0, i.stderr);
      assert.equal(commit(t.r).status, 0, 'a clean commit lands');
      writeFileSync(join(t.r, 'a.txt'), PLANT);
      const c = git(t.r, ['commit', '-a', '-q', '-m', 'leak']);
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /BLOCKED — 1 finding/);
      assert.equal(git(t.r, ['rev-list', '--count', 'HEAD']).stdout.trim(), '1');
    } finally { t.done(); }
  });

  test('core.hooksPath is honoured, and a re-install is a byte-identical no-op', () => {
    const t = repo();
    try {
      git(t.r, ['config', 'core.hooksPath', '.githooks']);
      const i = hook(t.r, ['install']);
      assert.equal(i.status, 0, i.stderr);
      assert.match(i.stdout, /core\.hooksPath \.githooks/);
      const p = join(t.r, '.githooks', 'pre-commit');
      assert.ok(readFileSync(p, 'utf8').includes(HOOK_MARKER));
      assert.equal(existsSync(join(t.r, '.git', 'hooks', 'pre-commit')), false);
      assert.equal(statSync(p).mode & 0o111, 0o111);
      const before = readFileSync(p, 'utf8');
      assert.match(hook(t.r, ['install']).stdout, /unchanged/);
      assert.equal(readFileSync(p, 'utf8'), before);
    } finally { t.done(); }
  });

  test('a foreign hook is refused untouched; --chain keeps it running; uninstall restores it', () => {
    const t = repo();
    try {
      const p = join(t.r, '.git', 'hooks', 'pre-commit');
      const ran = join(t.root, 'foreign-ran');
      const foreign = `#!/bin/sh\ntouch '${ran}'\n`;
      writeFileSync(p, foreign, { mode: 0o755 });

      const refused = hook(t.r, ['install']);
      assert.equal(refused.status, EXIT.REFUSED);
      assert.match(refused.stderr, /not written by commitwork/);
      assert.equal(readFileSync(p, 'utf8'), foreign);
      assert.equal(hook(t.r, ['uninstall']).status, EXIT.REFUSED);

      assert.equal(hook(t.r, ['install', '--chain']).status, 0);
      assert.equal(readFileSync(join(t.r, '.git', 'hooks', CHAINED), 'utf8'), foreign);
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      assert.equal(commit(t.r).status, 0);
      assert.ok(existsSync(ran), 'the chained hook ran after the check');

      // a plain re-install keeps the chain rather than orphaning the moved-aside hook
      assert.equal(hook(t.r, ['install', '--fail-on-context']).status, 0);
      assert.ok(readFileSync(p, 'utf8').includes(CHAINED));

      assert.equal(hook(t.r, ['uninstall']).status, 0);
      assert.equal(readFileSync(p, 'utf8'), foreign);
      assert.equal(existsSync(join(t.r, '.git', 'hooks', CHAINED)), false);
    } finally { t.done(); }
  });

  test('--dry-run writes nothing; uninstall removes only its own hook', () => {
    const t = repo();
    try {
      const p = join(t.r, '.git', 'hooks', 'pre-commit');
      assert.match(hook(t.r, ['install', '--dry-run']).stdout, /DRY RUN — would install/);
      assert.equal(existsSync(p), false);
      hook(t.r, ['install']);
      assert.equal(hook(t.r, ['uninstall']).status, 0);
      assert.equal(existsSync(p), false);
    } finally { t.done(); }
  });

  test('a hook whose script is gone refuses the commit rather than passing it', () => {
    const t = repo();
    try {
      hook(t.r, ['install'], { CW_HOOK_SCRIPT: join(t.root, 'gone', 'hook.mjs') });
      writeFileSync(join(t.r, 'a.txt'), 'hello\n');
      git(t.r, ['add', 'a.txt']);
      const c = commit(t.r);
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /REFUSED\. The check cannot run/);
    } finally { t.done(); }
  });

  test('`commitwork hook` dispatches before the first-run setup prompt', () => {
    const t = repo();
    try {
      const r = spawnSync(process.execPath, [CLI, 'hook', 'run'], { cwd: t.r, encoding: 'utf8', env: env() });
      assert.equal(r.status, EXIT.CLEAN, r.stderr);
      assert.match(r.stderr, /commitwork pre-commit: clean/);
    } finally { t.done(); }
  });
});

describe('hook units', () => {
  test('parseRaw reads adds, renames and deletes from a -z raw diff', () => {
    const z = '0'.repeat(40);
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const raw = `:000000 100644 ${z} ${a} A\0new.txt\0:100644 100644 ${a} ${b} R090\0old.txt\0moved.txt\0:100644 000000 ${a} ${z} D\0gone.txt\0`;
    const e = parseRaw(Buffer.from(raw));
    assert.deepEqual(e.map((x) => [x.status, x.src, x.path]), [['A', 'new.txt', 'new.txt'], ['R', 'old.txt', 'moved.txt'], ['D', 'gone.txt', 'gone.txt']]);
    assert.throws(() => parseRaw(Buffer.from('garbage\0')), /unparseable/);
  });

  test('parseArgs refuses an unknown lane and an unknown --unrun policy', () => {
    assert.throws(() => parseArgs(['--lanes', 'trufflehog']), /unknown lane/);
    assert.throws(() => parseArgs(['--unrun', 'ignore']), /block or warn/);
    assert.deepEqual(runArgs(parseArgs(['--block-existing', '--lanes', 'secrets,gitleaks'])),
      ['--lanes', 'secrets,gitleaks', '--unrun', 'block', '--block-existing']);
  });

  test('hookText is deterministic and quotes paths for sh', () => {
    const a = hookText({ node: '/n', script: "/x/it's/hook.mjs", args: ['--lanes', 'secrets'], chain: false });
    assert.equal(a, hookText({ node: '/n', script: "/x/it's/hook.mjs", args: ['--lanes', 'secrets'], chain: false }));
    assert.ok(a.includes(`script='/x/it'\\''s/hook.mjs'`));
    assert.ok(!a.includes(CHAINED));
  });

  test('.pre-commit-hooks.yaml names the package bin and a subcommand that exists', () => {
    const root = resolve(dirname(HOOK), '..');
    const y = readFileSync(join(root, '.pre-commit-hooks.yaml'), 'utf8');
    const entry = y.match(/^\s*entry:\s*(.+)$/m)[1].trim().split(/\s+/);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.bin[entry[0]], 'bin/commitwork.mjs');
    assert.deepEqual(entry.slice(1), ['hook', 'run']);
    assert.match(y, /^\s*language:\s*node$/m);
    assert.match(y, /^\s*pass_filenames:\s*false$/m, 'the check reads the index itself');
  });

  test('redact keeps a prefix and the length, never the credential', () => {
    assert.equal(redact(KEY), `${KEY.slice(0, 4)}…(20 chars)`);
    assert.equal(redact('short'), '…');
  });
});
