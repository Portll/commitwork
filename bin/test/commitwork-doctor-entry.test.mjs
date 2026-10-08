// `commitwork doctor` (bin/commitwork.mjs cmdDoctor) as a process, on a fixture manifest given by
// path and a PATH holding only fake tools plus the system dirs `sh` needs. `docker` is a fake too,
// so the daemon probe answers from the fixture (its cache is pointed into tmp) and no real daemon is
// asked. Pins: every tool the manifest requires is listed with ✓/✗ from PATH, the missing ones say
// "not on PATH" and point at `commitwork setup`; the daemon line follows `docker info`; the POSIX
// shell and target repo are reported; doctor is a report (exit 0), while an unreadable manifest or
// a missing repo path refuses (exit 2). Never --trust-repo-manifest: doctor executes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');
const POSIX = process.platform !== 'win32';
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const MANIFEST = {
  repo: 'fixture',
  checks: [
    { id: 'needs-present', local: ['true'], requires: { tools: ['cwfx-present-tool'] } },
    { id: 'needs-absent', local: ['true'], requires: { tools: ['cwfx-absent-tool', 'cwfx-present-tool'] } },
  ],
};

function sandbox(t, { dockerInfoExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-doctor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const tool = (name, body = 'exit 0') => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  for (const name of ['node', 'npm', 'act', 'cwfx-present-tool']) tool(name);
  tool('docker', `[ "$1" = info ] && exit ${dockerInfoExit}\nexit 0`);
  const repo = join(dir, 'target-repo'); mkdirSync(repo);
  const manifest = join(dir, 'fixture-manifest.json');
  writeFileSync(manifest, JSON.stringify(MANIFEST));
  return { dir, bin, repo, manifest };
}

function doctor(s, args) {
  // CW_REPORT_DIR and TMPDIR in the sandbox: the CLI mkdtemps a report dir at load when it is unset.
  // CW_SANDBOX=off pins the host-sandbox row, which otherwise follows whatever bwrap or sandbox-exec this host has.
  const env = { ...process.env, PATH: `${s.bin}:/usr/bin:/bin`, HOME: s.dir, TMPDIR: s.dir, CW_REPORT_DIR: join(s.dir, 'reports'),
    CW_SKIP_SETUP: '1', CW_SANDBOX: 'off', DOCKER_CONFIG: join(s.dir, 'docker-config'), CW_DOCKER_PROBE_CACHE: join(s.dir, 'docker-probe.json'), CW_DOCKER_PROBE_TTL_MS: '0' };
  for (const k of ['COMMITWORK_MANIFEST', 'COMMITWORK_REPO', 'COMMITWORK_TRUST_REPO_MANIFEST']) delete env[k];
  const r = spawnSync(process.execPath, [CLI, 'doctor', ...args], { encoding: 'utf8', env, cwd: s.dir });
  return { code: r.status, out: plain(r.stdout), err: plain(r.stderr) };
}

test('every required tool is listed from PATH; the missing one says so and points at setup', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  const r = doctor(s, ['--manifest', s.manifest, '--repo', s.repo]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^commitwork doctor\n\ntools:\n/);
  const toolLines = r.out.split('\n').filter((l) => /^ {2}[✓✗] /.test(l)).map((l) => l.trim());
  assert.deepEqual(toolLines.map((l) => l.split(/\s+/).slice(0, 2).join(' ')), [
    '✓ act', '✗ cwfx-absent-tool', '✓ cwfx-present-tool', '✓ docker', '✓ node', '✓ npm',
    '✓ Node.js', '✓ docker', '✗ host', '✓ POSIX',
  ], 'tools sorted, each once, then the services');
  assert.match(r.out, / {2}✗ cwfx-absent-tool {2}\(not on PATH\)\n/);
  assert.match(r.out, /→ `commitwork setup` installs the missing scanners/);
  assert.match(r.out, /services:\n {2}✓ Node\.js \S+ {2}\(package\.json requires >=\S+\)\n {2}✓ docker daemon\n {2}✗ host sandbox {2}\(CW_SANDBOX=off\)\n {6}lanes run unconfined and each row records isolation: none\n {2}✓ POSIX shell {2}\(\S*sh\)\n/);
  assert.ok(r.out.includes(`target repo: ${s.repo} (exists)`), r.out);
  assert.equal(existsSync(join(s.dir, 'docker-config')), false, 'an inherited DOCKER_CONFIG wins; nothing is created');
});

test('a daemon that does not answer `docker info` is reported down while the docker binary is present', { skip: !POSIX }, (t) => {
  const s = sandbox(t, { dockerInfoExit: 1 });
  const r = doctor(s, ['--manifest', s.manifest, '--repo', s.repo]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, / {2}✓ docker\n/);
  assert.match(r.out, /services:\n {2}✓ Node\.js .*\n {2}✗ docker daemon\n/);
});

test('with every required tool present there is no setup pointer', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  writeFileSync(join(s.bin, 'cwfx-absent-tool'), '#!/bin/sh\nexit 0\n'); chmodSync(join(s.bin, 'cwfx-absent-tool'), 0o755);
  const r = doctor(s, ['--manifest', s.manifest, '--repo', s.repo]);
  assert.equal(r.code, 0, r.err);
  const tools = r.out.slice(r.out.indexOf('tools:\n'), r.out.indexOf('\nservices:'));
  assert.ok(tools.length > 'tools:\n'.length, r.out);
  assert.doesNotMatch(tools, /✗/);
  assert.doesNotMatch(r.out, /commitwork setup/);
});

test('an unparseable or invalid manifest, or a repo path that does not exist, refuses with exit 2', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  writeFileSync(s.manifest, '{ "repo": ');
  const bad = doctor(s, ['--manifest', s.manifest, '--repo', s.repo]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /commitwork: could not parse manifest .*fixture-manifest\.json/);
  assert.doesNotMatch(bad.out, /tools:/);

  writeFileSync(s.manifest, JSON.stringify({ checks: [{ id: 'Bad Id', local: 'true' }] }));
  const invalid = doctor(s, ['--manifest', s.manifest, '--repo', s.repo]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.err, /invalid manifest .*\n {2}- repo \(string\) is required\n {2}- checks\[0\]: id must match/);

  writeFileSync(s.manifest, JSON.stringify(MANIFEST));
  const gone = doctor(s, ['--manifest', s.manifest, '--repo', join(s.dir, 'no-such-repo')]);
  assert.equal(gone.code, 2);
  assert.match(gone.err, /commitwork: repoPath does not exist: .*no-such-repo/);

  const missing = doctor(s, ['--manifest', join(s.dir, 'nope.json'), '--repo', s.repo]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /commitwork: manifest not found: .*nope\.json/);
});
