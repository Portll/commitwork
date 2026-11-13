import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ignoredToRegexes, scopeConfigText, DESCRIPTION } from '../gitleaks-scope-config.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'gitleaks-scope-config.mjs');
const BASE = join(CW, 'manifests', 'gitleaks.toml');

const scratch = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-glsc-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
// assembled at run time so no credential-shaped literal sits in the tree, and outside the default
// allowlist's example key, which gitleaks swallows
const KEY = ['AKIA', 'Z7Q3', 'M2K5', 'P4N6', 'W5TB'].join('');

function repo(t, { ignored = true } = {}) {
  const d = scratch(t);
  execFileSync('git', ['-C', d, 'init', '-q']);
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'tracked.txt'), `aws_access_key_id = ${KEY}\n`);
  if (ignored) {
    mkdirSync(join(d, 'localbuild')); mkdirSync(join(d, 'build (old)'));
    writeFileSync(join(d, 'localbuild', 'ignored.txt'), `aws_access_key_id = ${KEY}\n`);
    writeFileSync(join(d, 'build (old)', 'ignored.txt'), `aws_access_key_id = ${KEY}\n`);
    writeFileSync(join(d, '.env'), `AWS_KEY=${KEY}\n`);
    writeFileSync(join(d, '.gitignore'), 'localbuild/\nbuild (old)/\n.env\n');
    execFileSync('git', ['-C', d, 'add', '.gitignore']);
  }
  execFileSync('git', ['-C', d, 'add', 'src']);
  return d;
}

test('ignoredToRegexes: directory → anchored prefix, file → anchored whole, metacharacters escaped', () => {
  const { regexes, skipped } = ignoredToRegexes(['localbuild/', '.env', 'build (old)/', 'a+b/', 'x.y$z', './']);
  assert.deepEqual(regexes, ['^localbuild/', '^\\.env$', '^build \\(old\\)/', '^a\\+b/', '^x\\.y\\$z$']);
  assert.deepEqual(skipped, []);
  for (const r of regexes) new RegExp(r);
  assert.ok(new RegExp(regexes[2]).test('build (old)/deep/f.txt') && !new RegExp(regexes[2]).test('src/build (old)'));
});

test('scopeConfigText extends the base and carries one allowlist block of literal strings', () => {
  const txt = scopeConfigText('/abs/base.toml', ['^localbuild/', '^\\.env$']);
  assert.match(txt, /^\[extend\]\npath = '\/abs\/base\.toml'$/m);
  assert.match(txt, new RegExp(`\\[\\[allowlists\\]\\]\\ndescription = "${DESCRIPTION.replace(/[()]/g, '\\$&')}"`));
  assert.match(txt, /'''\^localbuild\/''',\n  '''\^\\\.env\$''',/);
  assert.equal(txt.match(/\[extend\]/g).length, 1, 'one extend level only — a second level fails to load in gitleaks 8.30');
});

test('on a git target: writes <outDir>/gitleaks-scope.toml extending the absolute base, prints its path', (t) => {
  const d = repo(t);
  const out = join(d, 'report');
  const r = run(d, [BASE, out]);
  assert.equal(r.status, 0, r.stderr);
  const p = r.stdout.trim();
  assert.equal(p, join(out, 'gitleaks-scope.toml'));
  const txt = readFileSync(p, 'utf8');
  assert.ok(txt.includes(`path = '${BASE}'`), `extends the absolute base: ${txt}`);
  assert.ok(txt.includes("'''^localbuild/'''") && txt.includes("'''^\\.env$'''") && txt.includes("'''^build \\(old\\)/'''"), txt);
  assert.ok(!txt.includes('src'), 'tracked source is not allowlisted');
  assert.match(r.stderr, /3 gitignored path\(s\) excluded/);
  assert.deepEqual(readdirSync(out), ['gitleaks-scope.toml'], 'no tmp file left behind');
  const named = run(d, [BASE, out, 'gitleaks-mainframe-scope.toml']);
  assert.equal(named.stdout.trim(), join(out, 'gitleaks-mainframe-scope.toml'), 'a lane may name its own file so two lanes never share one');
});

test('a non-git target prints the base path unchanged, writes nothing, and SAYS so', (t) => {
  const d = scratch(t);
  const out = join(d, 'report');
  const r = run(d, [BASE, out]);
  assert.equal(r.status, 0, 'the scan must still run on the base config; this is a disclosure, not a refusal');
  assert.equal(r.stdout.trim(), BASE);
  assert.ok(!existsSync(out), 'nothing written');
  assert.match(r.stderr, /gitignored paths NOT excluded .*not a git repository/s);
});

test('git absent from PATH falls back the same way', (t) => {
  const d = repo(t);
  const empty = join(d, 'nobin'); mkdirSync(empty);
  const r = run(d, [BASE, join(d, 'report')], { PATH: empty, Path: empty });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), BASE);
  assert.match(r.stderr, /gitignored paths NOT excluded/);
});

test('a target with nothing gitignored prints the base path and says why', (t) => {
  const d = repo(t, { ignored: false });
  const r = run(d, [BASE, join(d, 'report')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), BASE);
  assert.match(r.stderr, /no gitignored paths/);
});

test('an unreadable base config exits 1 with nothing on stdout; usage exits 2', (t) => {
  const d = repo(t);
  const r = run(d, [join(d, 'absent.toml'), join(d, 'report')]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /base config .*absent\.toml is not readable/);
  assert.equal(run(d, [BASE]).status, 2);
});

test('the shipped lanes route gitleaks through the tool and keep the size backstop', () => {
  const m = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
  const gl = m.checks.find((c) => c.id === 'secrets-gitleaks');
  const cmd = gl.local.join(' ');
  assert.match(cmd, /CFG=\$\(node "\$CW_ROOT\/bin\/gitleaks-scope-config\.mjs" "\$CW_ROOT\/manifests\/gitleaks\$\{SFX\}\.toml" "\$CW_REPORT_DIR"/);
  assert.match(cmd, /gitleaks detect --no-git --source \. --config "\$CFG" --max-target-megabytes 50 /, 'scan-scope reads the size bound off this flag');
  assert.match(gl.description, /gitignored/, 'the lane description states the new bound');
  const mf = m.checks.find((c) => c.id === 'secrets-cobol-jcl');
  assert.ok(mf, 'the mainframe gitleaks lane exists');
  assert.match(mf.local.join(' '), /gitleaks-scope-config\.mjs" "\$cfg" "\$CW_REPORT_DIR" gitleaks-mainframe-scope\.toml/, 'the mainframe lane uses its own file name');
});

// the written file extends a base that itself carries `[extend] useDefault = true`, so both levels
// are measured rather than assumed
test('with gitleaks installed, a key in a gitignored file is NOT reported and the tracked one IS', (t) => {
  const which = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (which.error || which.status !== 0) return t.skip('gitleaks is not on PATH — the extend chain is unmeasured here, not passing');
  const d = repo(t);
  const out = join(d, 'report');
  const cfg = run(d, [BASE, out]).stdout.trim();
  const scan = (config, name) => {
    const g = spawnSync('gitleaks', ['detect', '--no-git', '--source', '.', '--config', config, '--report-format', 'json',
      '--report-path', join(out, name), '--redact', '--exit-code', '0'], { cwd: d, encoding: 'utf8' });
    assert.equal(g.status, 0, `gitleaks failed to run: ${g.stderr}`);
    return JSON.parse(readFileSync(join(out, name), 'utf8')).map((f) => f.File.replace(/\\/g, '/')).sort();
  };
  const unbounded = scan(BASE, 'base.json');
  assert.ok(unbounded.includes('src/tracked.txt') && unbounded.includes('localbuild/ignored.txt'),
    `the positive control: the base config alone reports both (${unbounded.join(', ')})`);
  assert.deepEqual(scan(cfg, 'scope.json'), ['src/tracked.txt'], 'only the tracked key survives the gitignore bound');
});
