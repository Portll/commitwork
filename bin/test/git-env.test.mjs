// gitChildEnv: a child git acts on the repository its -C names, whatever its caller exported.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { gitChildEnv, localEnvVars } from '../lib/git-env.mjs';

const clean = gitChildEnv();
const git = (args, env) => spawnSync('git', args, { encoding: 'utf8', env });

test('drops every variable git itself lists as repository-local, and keeps identity and PATH', () => {
  const listed = git(['rev-parse', '--local-env-vars'], clean).stdout.split(/\s+/).filter(Boolean);
  assert.ok(listed.includes('GIT_DIR'), 'git listed nothing; this test would pass vacuously');
  const env = { PATH: '/bin', GIT_AUTHOR_EMAIL: 'a@b', GIT_CONFIG_KEY_0: 'x', GIT_CONFIG_VALUE_0: 'y' };
  for (const k of listed) env[k] = '/somewhere';
  const out = gitChildEnv(env);
  for (const k of listed) assert.equal(out[k], undefined, `${k} survived`);
  assert.equal(out.GIT_CONFIG_KEY_0, undefined);
  assert.equal(out.PATH, '/bin');
  assert.equal(out.GIT_AUTHOR_EMAIL, 'a@b', 'the commit identity is set through the environment and must survive');
  assert.ok(localEnvVars().includes('GIT_COMMON_DIR'));
});

test('under an exported GIT_DIR, git -C writes where -C points only with the scrubbed env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-git-env-'));
  try {
    for (const r of ['hooked', 'target']) {
      git(['init', '-q', join(dir, r)], clean);
      git(['-C', join(dir, r), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', r], clean);
    }
    const hookEnv = { ...clean, GIT_DIR: join(dir, 'hooked', '.git') };
    const where = (env) => git(['-C', join(dir, 'target'), 'rev-parse', '--absolute-git-dir'], env).stdout.trim();
    assert.match(where(hookEnv), /hooked/, 'the control failed: an inherited GIT_DIR no longer overrides -C, so the next assertion proves nothing');
    assert.match(where(gitChildEnv(hookEnv)), /target/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// fact: a scanned repo's executable config stays inert under scannedGit / review 2026-10-07 D6 (expiry: never, prev: broken)
test('scannedGit runs status on a tree whose core.fsmonitor would execute, and it does not; plain git is the control', { skip: process.platform === 'win32' ? 'POSIX hook' : false }, async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const { writeFileSync, chmodSync, existsSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-scanned-git-'));
  try {
    const repo = join(dir, 'repo');
    const fired = join(dir, 'fired');
    const hook = join(dir, 'hook.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch "${fired}"\nexit 1\n`);
    chmodSync(hook, 0o755);
    assert.equal(git(['init', '-q', repo], clean).status, 0);
    git(['-C', repo, 'config', 'core.fsmonitor', hook], clean);
    writeFileSync(join(repo, 'a.txt'), 'a');
    const r = scannedGit(repo, ['status', '--porcelain']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\?\? a\.txt/, 'status read nothing, so the hook not firing proves nothing');
    assert.ok(!existsSync(fired), 'core.fsmonitor ran under scannedGit');
    git(['-C', repo, 'status', '--porcelain'], clean);
    assert.ok(existsSync(fired), 'plain git status never ran the hook: the fixture is not armed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── a scanned repo whose every executable setting writes a marker ────────────────────────────────
// Each case runs its command through scannedGit on a fresh copy of one armed repo, then with a plain
// git on another copy: the plain run must fire, or a quiet marker directory proves nothing. A copy
// has new inodes, so its index is stat-dirty and status and diff must re-read (and clean) the files.
// Cases share one marker directory, so they run one at a time (node:test's default within a file).
const POSIX = { skip: process.platform === 'win32' ? 'POSIX scripts' : false };
const scratchEnv = (dir) => ({ PATH: process.env.PATH || '', HOME: join(dir, 'home'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' });

let template = null;
async function armedTemplate() {
  if (template) return template;
  const { writeFileSync, chmodSync, mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-armed-git-'));
  const marks = join(dir, 'marks');
  mkdirSync(marks); mkdirSync(join(dir, 'home'));
  const env = scratchEnv(dir);
  const repo = join(dir, 'repo');
  const g = (...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `fixture: git ${args.join(' ')}: ${r.stderr}`);
  };
  const script = (name, body) => {
    const p = join(dir, `${name}.sh`);
    writeFileSync(p, `#!/bin/sh\ntouch "${join(marks, name)}"\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', repo], { env }).status, 0);
  const put = (f, t) => writeFileSync(join(repo, f), t);
  put('.gitattributes', '*.f filter=evil diff=evil\n*.p filter=evilp\n');
  put('a.f', 'a\n'); put('b.p', 'p\n'); put('c.txt', 'x\n');
  g('add', '-A'); g('commit', '-qm', 'one');
  put('a.f', 'a2\n'); put('b.p', 'p2\n'); g('commit', '-qam', 'two');
  g('checkout', '-qb', 'side'); put('a.f', 'a3\n'); put('b.p', 'p3\n'); g('commit', '-qam', 'three'); g('checkout', '-q', 'main');
  // armed only once the history exists, so building it ran none of them
  g('config', 'filter.evil.clean', script('clean', 'cat'));
  g('config', 'filter.evil.smudge', script('smudge', 'cat'));
  g('config', 'filter.evilp.process', script('process', 'exit 1'));
  g('config', 'diff.evil.textconv', script('textconv', 'cat "$1"'));
  g('config', 'diff.external', script('extdiff', 'exit 0'));
  g('config', 'core.fsmonitor', script('fsmonitor', 'exit 1'));
  for (const h of ['post-merge', 'post-checkout', 'reference-transaction', 'pre-auto-gc']) {
    const p = join(repo, '.git', 'hooks', h);
    writeFileSync(p, `#!/bin/sh\nexec "${script(`hook-${h}`, 'exit 0')}"\n`); chmodSync(p, 0o755);
  }
  put('c.txt', 'y\n');
  template = { dir, repo, marks, env, script };
  return template;
}
test.after(() => { if (template) rmSync(template.dir, { recursive: true, force: true }); });

async function armedRepo() {
  const { cpSync, readdirSync } = await import('node:fs');
  const t = await armedTemplate();
  const dir = mkdtempSync(join(tmpdir(), 'cw-armed-copy-'));
  const repo = join(dir, 'repo');
  cpSync(t.repo, repo, { recursive: true });
  const g = (...args) => spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...args], { encoding: 'utf8', env: t.env }).stdout;
  const fired = () => readdirSync(t.marks).sort();
  const reset = () => { rmSync(t.marks, { recursive: true, force: true }); mkdirSync(t.marks); };
  reset();
  return { dir, repo, env: t.env, fired, reset, script: t.script, g, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// armed: what the plain-git control must run, so each command is proven to reach the drivers it claims
const READS = [
  { args: ['status', '--porcelain'], saw: (o) => /^ M c\.txt$/m.test(o), armed: ['clean', 'fsmonitor', 'process'] },
  { args: ['ls-files', '-m'], saw: (o) => /^c\.txt$/m.test(o), armed: ['clean', 'fsmonitor', 'process'] },
  { args: ['diff'], saw: (o) => /^\+y$/m.test(o), armed: ['clean', 'fsmonitor', 'process'] },
  { args: ['diff', '--', 'c.txt'], saw: (o) => /^\+y$/m.test(o), armed: ['extdiff', 'fsmonitor'] },
  { args: ['log', '-p', '-1'], saw: (o) => /^\+a2$/m.test(o), armed: ['smudge', 'textconv'] },
  { args: ['show', 'HEAD'], saw: (o) => /^\+a2$/m.test(o), armed: ['smudge', 'textconv'] },
  { args: ['blame', 'a.f'], saw: (o) => /\) a2$/m.test(o), armed: ['clean', 'fsmonitor', 'smudge', 'textconv'] },
  { args: ['archive', 'HEAD'], saw: (o) => o.includes('a2\n'), armed: ['process', 'smudge'] },
  { args: ['ls-files'], saw: (o) => /^a\.f$/m.test(o), armed: ['fsmonitor'] },
];

for (const { args, saw, armed } of READS) {
  test(`scannedGit ${args.join(' ')} runs none of the repo's ${armed.join(', ')}`, POSIX, async () => {
    const { scannedGit } = await import('../lib/git-env.mjs');
    const fx = await armedRepo();
    try {
      const r = scannedGit(fx.repo, args, { env: fx.env });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(saw(r.stdout), `the read returned nothing recognisable, so a quiet marker directory proves nothing:\n${r.stdout.slice(0, 300)}`);
      assert.deepEqual(fx.fired(), [], 'a repo-configured command ran under scannedGit');
    } finally { fx.done(); }
    const control = await armedRepo();
    try {
      spawnSync('git', ['-C', control.repo, ...args], { encoding: 'utf8', env: control.env });
      for (const m of armed) assert.ok(control.fired().includes(m), `plain git ${args.join(' ')} did not run ${m} (ran ${control.fired()}): the fixture is not armed for this command`);
    } finally { control.done(); }
  });
}

test('scannedGit merge --ff-only moves HEAD and the files, and runs no hook, filter or fsmonitor', POSIX, async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const { readFileSync } = await import('node:fs');
  const fx = await armedRepo();
  try {
    const side = fx.g('rev-parse', 'side').trim();
    fx.reset();
    const r = scannedGit(fx.repo, ['merge', '--ff-only', '--no-edit', 'side'], { env: fx.env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fx.g('rev-parse', 'HEAD').trim(), side);
    assert.equal(readFileSync(join(fx.repo, 'a.f'), 'utf8'), 'a3\n', 'the checkout wrote the blob as it is, with no smudge');
    assert.deepEqual(fx.fired(), []);
  } finally { fx.done(); }
  const control = await armedRepo();
  try {
    spawnSync('git', ['-C', control.repo, 'merge', '--ff-only', 'side'], { env: control.env });
    assert.ok(control.fired().some((m) => m.startsWith('hook-')), `plain merge ran no hook: ${control.fired()}`);
    assert.ok(control.fired().includes('clean') || control.fired().includes('process'), `plain merge ran no filter: ${control.fired()}`);
  } finally { control.done(); }
});

test('a tool that spawns its own git (gitleaks) inherits the neutralising config through scannedGitEnv', POSIX, async () => {
  const { scannedGitEnv } = await import('../lib/git-env.mjs');
  const fx = await armedRepo();
  try {
    const { env, error } = scannedGitEnv(fx.repo, fx.env);
    assert.equal(error, undefined);
    const r = spawnSync('git', ['-C', fx.repo, 'log', '-p', '--all'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^\+a3$/m);
    assert.deepEqual(fx.fired(), []);
    spawnSync('git', ['-C', fx.repo, 'log', '-p', '--all'], { encoding: 'utf8', env: fx.env });
    assert.ok(fx.fired().includes('textconv'), 'the same log without the env ran no textconv: the control is not armed');
  } finally { fx.done(); }
});

test('the operator\'s own driver is left alone: only repo-scoped config is neutralised', POSIX, async () => {
  const { scannedConfigOverrides } = await import('../lib/git-env.mjs');
  const fx = await armedRepo();
  try {
    const { writeFileSync } = await import('node:fs');
    const global = join(fx.dir, 'global.gitconfig');
    writeFileSync(global, '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n[diff "word"]\n\ttextconv = docx2txt\n');
    const o = scannedConfigOverrides(fx.repo, { ...fx.env, GIT_CONFIG_GLOBAL: global });
    const keys = o.pairs.map(([k]) => k);
    assert.ok(keys.includes('filter.evil.clean') && keys.includes('diff.evil.textconv') && keys.includes('diff.external'), keys.join(' '));
    assert.ok(!keys.some((k) => k.startsWith('filter.lfs.') || k.startsWith('diff.word.')), `a global driver was neutralised: ${keys}`);
  } finally { fx.done(); }
});

test('status and diff do not recurse into a submodule, whose own drivers scannedGit cannot see', POSIX, async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const { writeFileSync, chmodSync, mkdirSync, readdirSync, utimesSync } = await import('node:fs');
  const build = () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-armed-sub-'));
    mkdirSync(join(dir, 'home')); mkdirSync(join(dir, 'marks'));
    const env = scratchEnv(dir);
    const g = (cwd, ...args) => {
      const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', '-C', cwd, ...args], { encoding: 'utf8', env });
      assert.equal(r.status, 0, `fixture: git ${args.join(' ')}: ${r.stderr}`);
    };
    const src = join(dir, 'subsrc');
    spawnSync('git', ['init', '-q', '-b', 'main', src], { env });
    writeFileSync(join(src, '.gitattributes'), '*.s filter=subevil\n'); writeFileSync(join(src, 'x.s'), 'x\n');
    g(src, 'add', '-A'); g(src, 'commit', '-qm', 's');
    const sup = join(dir, 'sup');
    spawnSync('git', ['init', '-q', '-b', 'main', sup], { env });
    g(sup, 'submodule', 'add', '-q', src, 'sub'); g(sup, 'commit', '-qm', 'sub');
    const clean = join(dir, 'clean.sh');
    writeFileSync(clean, `#!/bin/sh\ntouch "${join(dir, 'marks', 'subclean')}"\ncat\n`); chmodSync(clean, 0o755);
    g(join(sup, 'sub'), 'config', 'filter.subevil.clean', clean);
    g(sup, 'config', 'submodule.sub.ignore', 'none'); // the superproject asks for full recursion
    const t = new Date(Date.now() + 60_000); utimesSync(join(sup, 'sub', 'x.s'), t, t);
    return { dir, sup, env, fired: () => readdirSync(join(dir, 'marks')) };
  };
  for (const args of [['status', '--porcelain'], ['diff'], ['diff-index', 'HEAD']]) {
    const fx = build();
    try {
      const r = scannedGit(fx.sup, args, { env: fx.env });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(fx.fired(), [], `scannedGit ${args.join(' ')} ran the submodule's clean filter`);
      spawnSync('git', ['-C', fx.sup, ...args], { env: fx.env });
      assert.deepEqual(fx.fired(), ['subclean'], `plain ${args.join(' ')} did not recurse: the control is not armed`);
    } finally { rmSync(fx.dir, { recursive: true, force: true }); }
  }
});

test('ls-remote and credential lookups run none of the repo\'s transport commands', POSIX, async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const { mkdirSync, readdirSync, writeFileSync, chmodSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-armed-remote-'));
  try {
    mkdirSync(join(dir, 'home')); mkdirSync(join(dir, 'marks'));
    const env = scratchEnv(dir);
    const marker = (name) => { const p = join(dir, `${name}.sh`); writeFileSync(p, `#!/bin/sh\ntouch "${join(dir, 'marks', name)}"\nexit 1\n`); chmodSync(p, 0o755); return p; };
    const up = join(dir, 'up');
    spawnSync('git', ['init', '-q', up], { env });
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', up, 'commit', '-q', '--allow-empty', '-m', 'x'], { env });
    const cases = {
      'core.sshCommand': [['core.sshCommand', marker('ssh')], ['remote.origin.url', 'ssh://example.invalid/x']],
      'remote uploadpack': [['remote.origin.url', up], ['remote.origin.uploadpack', `${marker('uploadpack')}; git-upload-pack`]],
      'ext:: transport': [['protocol.allow', 'always'], ['remote.origin.url', `ext::${marker('ext')}`]],
      'core.gitProxy': [['core.gitProxy', marker('gitproxy')], ['remote.origin.url', 'git://example.invalid/x']],
    };
    for (const [name, config] of Object.entries(cases)) {
      const repo = join(dir, name.replace(/\W/g, '-'));
      spawnSync('git', ['init', '-q', repo], { env });
      for (const [k, v] of config) spawnSync('git', ['-C', repo, 'config', k, v], { env });
      scannedGit(repo, ['ls-remote', 'origin'], { env, timeout: 30_000 });
      assert.deepEqual(readdirSync(join(dir, 'marks')), [], `${name} ran under scannedGit`);
      spawnSync('git', ['-C', repo, 'ls-remote', 'origin'], { env, timeout: 30_000 });
      assert.equal(readdirSync(join(dir, 'marks')).length, 1, `plain ls-remote did not run ${name}: the control is not armed`);
      rmSync(join(dir, 'marks'), { recursive: true }); mkdirSync(join(dir, 'marks'));
    }
    const repo = join(dir, 'cred');
    spawnSync('git', ['init', '-q', repo], { env });
    spawnSync('git', ['-C', repo, 'config', 'credential.https://example.invalid.helper', `!${marker('cred')}`], { env });
    const input = 'protocol=https\nhost=example.invalid\n\n';
    scannedGit(repo, ['credential', 'fill'], { env, input });
    assert.deepEqual(readdirSync(join(dir, 'marks')), [], 'a repo credential helper ran under scannedGit');
    spawnSync('git', ['-C', repo, 'credential', 'fill'], { env, input });
    assert.deepEqual(readdirSync(join(dir, 'marks')), ['cred'], 'plain credential fill ran no helper: the control is not armed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('log on a signed-looking commit runs the repo\'s gpg.program only without scannedGit', POSIX, async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const fx = await armedRepo();
  try {
    fx.g('config', 'gpg.program', fx.script('gpg', 'exit 1'));
    fx.g('config', 'log.showSignature', 'true');
    const body = fx.g('cat-file', 'commit', 'HEAD').replace(/^(committer .*)$/m, '$1\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n -----END PGP SIGNATURE-----');
    const sha = spawnSync('git', ['-C', fx.repo, 'hash-object', '-t', 'commit', '-w', '--stdin'], { input: body, encoding: 'utf8', env: fx.env }).stdout.trim();
    fx.g('update-ref', 'refs/heads/main', sha);
    fx.reset(); // the fixture's own update-ref ran the reference-transaction hook
    const r = scannedGit(fx.repo, ['log', '-1', '--format=%H'], { env: fx.env });
    assert.equal(r.stdout.trim(), sha, r.stderr);
    assert.deepEqual(fx.fired(), []);
    spawnSync('git', ['-C', fx.repo, 'log', '-1'], { env: fx.env });
    assert.deepEqual(fx.fired(), ['gpg'], 'plain log ran no gpg.program: the control is not armed');
  } finally { fx.done(); }
});

test('a config git cannot read refuses the command instead of running it unneutralised', async () => {
  const { scannedGit } = await import('../lib/git-env.mjs');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'cw-bad-config-'));
  try {
    const env = scratchEnv(dir);
    const repo = join(dir, 'repo');
    spawnSync('git', ['init', '-q', repo], { env });
    writeFileSync(join(repo, '.git', 'config'), '[core\n\trepositoryformatversion = 0\n[filter "x"\n');
    const r = scannedGit(repo, ['status'], { env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /scannedGit refused to run: could not read the repository config/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
