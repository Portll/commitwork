// Every assertion runs against a real throwaway repository: a mocked git would agree with whatever it
// was told and prove nothing about the bytes a commit actually yields.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { EXIT, MANIFEST_NAME, build } from '../release-build.mjs';

const CLI = fileURLToPath(new URL('../release-build.mjs', import.meta.url));
const COMMIT_TIME = 1700000000;
const LONG = `deep/${'a'.repeat(60)}/${'b'.repeat(60)}/file.txt`;
const git = (cwd, args, env = {}) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, ...env },
}).trim();

function fixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-relbuild-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'demo', version: '1.2.3' }, null, 2)}\n`);
  writeFileSync(join(dir, 'README.md'), 'line one\nline two\n');
  writeFileSync(join(dir, 'run.sh'), '#!/bin/sh\necho hi\n');
  mkdirSync(join(dir, LONG, '..'), { recursive: true });
  writeFileSync(join(dir, LONG), 'long path\n');
  git(dir, ['add', '.']);
  git(dir, ['update-index', '--chmod=+x', 'run.sh']);
  // a symlink entry built in the index, so the fixture is the same on a filesystem without links
  const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: 'README.md', encoding: 'utf8' }).trim();
  git(dir, ['update-index', '--add', '--cacheinfo', `120000,${oid},link.md`]);
  const date = `@${COMMIT_TIME} +0000`;
  git(dir, ['commit', '-q', '-m', 'fixture'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  git(dir, ['tag', 'v1.2.3']);
  return dir;
}

// node -e keeps argv[1] as the script, so the CLI's main guard still fires after the umask is set
function cli(args, { repo, env = {}, umask = 0o022 } = {}) {
  return spawnSync(process.execPath, ['-e', `process.umask(${umask}); import(process.argv[1]);`, CLI, ...args], {
    encoding: 'utf8', env: { ...process.env, CW_REPO_ROOT: repo, ...env },
  });
}

const filesIn = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f))]));

// { path, mode, uid, gid, mtime, type, linkname, data } per entry; pax `path` replaces the next name
function readTar(buf) {
  const out = [];
  let pax = {};
  for (let at = 0; at + 512 <= buf.length;) {
    const h = buf.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const str = (o, l) => h.subarray(o, o + l).toString('utf8').replace(/\0.*$/s, '');
    const num = (o, l) => parseInt(str(o, l).trim() || '0', 8);
    const size = num(124, 12);
    const data = buf.subarray(at + 512, at + 512 + size);
    const type = str(156, 1);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const rec of data.toString('utf8').split('\n').filter(Boolean)) {
        const [k, ...v] = rec.slice(rec.indexOf(' ') + 1).split('=');
        pax[k] = v.join('=');
      }
      continue;
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    assert.equal(num(148, 8), sum, `header checksum of ${str(0, 100)}`);
    out.push({ path: pax.path ?? str(0, 100), mode: num(100, 8), uid: num(108, 8), gid: num(116, 8),
      mtime: num(136, 12), type, linkname: pax.linkpath ?? str(157, 100), data });
    pax = {};
  }
  return out;
}

test('two builds with different clocks, umask, TZ, git config and working tree yield the same bytes', async () => {
  const repo = fixtureRepo();
  const a = mkdtempSync(join(tmpdir(), 'cw-relbuild-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cw-relbuild-b-'));
  try {
    const r1 = cli(['--ref', 'v1.2.3', '--out', a], { repo, env: { TZ: 'UTC' }, umask: 0o022 });
    assert.equal(r1.status, EXIT.OK, r1.stderr);

    // everything a build must not read changes before the second one
    await new Promise((r) => setTimeout(r, 1100));
    writeFileSync(join(repo, 'README.md'), 'an uncommitted edit\r\n');
    writeFileSync(join(repo, 'untracked.txt'), 'not committed\n');
    chmodSync(join(repo, 'run.sh'), 0o600);
    utimesSync(join(repo, 'package.json'), 1, 1);
    git(repo, ['config', 'core.autocrlf', 'true']);
    writeFileSync(join(repo, '.gitattributes'), '* text eol=crlf\n*.md export-ignore\n');
    const r2 = cli(['--ref', 'v1.2.3', '--out', b], { repo, env: { TZ: 'Pacific/Chatham', LC_ALL: 'C' }, umask: 0o077 });
    assert.equal(r2.status, EXIT.OK, r2.stderr);

    const fa = filesIn(a);
    const fb = filesIn(b);
    assert.deepEqual(Object.keys(fa), ['demo-1.2.3-source.tar', 'demo-1.2.3-source.tar.gz', MANIFEST_NAME]);
    for (const f of Object.keys(fa)) assert.ok(fa[f].equals(fb[f]), `${f} differs between the two builds`);
  } finally {
    for (const d of [repo, a, b]) rmSync(d, { recursive: true, force: true });
  }
});

test('the tar holds the commit content with fixed owners, modes and the commit time', () => {
  const repo = fixtureRepo();
  try {
    writeFileSync(join(repo, 'README.md'), 'working tree only\n');
    const { manifest, files } = build('v1.2.3', repo);
    const tar = files.get('demo-1.2.3-source.tar');
    const entries = readTar(tar);
    const by = Object.fromEntries(entries.map((e) => [e.path, e]));
    assert.deepEqual(entries.map((e) => e.path), [...entries.map((e) => e.path)].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))));
    for (const e of entries) {
      assert.equal(e.mtime, COMMIT_TIME, `${e.path} mtime`);
      assert.equal(e.uid, 0);
      assert.equal(e.gid, 0);
    }
    assert.equal(by['demo-1.2.3/README.md'].data.toString(), 'line one\nline two\n', 'the committed blob, not the working tree');
    assert.equal(by['demo-1.2.3/README.md'].mode, 0o644);
    assert.equal(by['demo-1.2.3/run.sh'].mode, 0o755);
    assert.equal(by['demo-1.2.3/link.md'].type, '2');
    assert.equal(by['demo-1.2.3/link.md'].linkname, 'README.md');
    assert.equal(by[`demo-1.2.3/${LONG}`].data.toString(), 'long path\n', 'a path over 100 bytes survives through pax');
    assert.equal(by['demo-1.2.3/deep/'].type, '5');
    assert.equal(tar.length % 10240, 0);

    const gz = files.get('demo-1.2.3-source.tar.gz');
    assert.equal(gz[3], 0, 'no FNAME or other optional header field');
    assert.equal(gz.readUInt32LE(4), 0, 'gzip mtime 0');
    assert.equal(gz[9], 0xff, 'gzip OS byte normalised');
    assert.ok(gunzipSync(gz).equals(tar));

    assert.equal(manifest.source.ref, 'v1.2.3');
    assert.equal(manifest.source.commit, git(repo, ['rev-parse', 'HEAD']));
    assert.equal(manifest.source.sourceDateEpoch, COMMIT_TIME);
    assert.equal(manifest.files, 5);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('--verify rebuilds and matches, and names the file a tampered byte is in', () => {
  const repo = fixtureRepo();
  const out = mkdtempSync(join(tmpdir(), 'cw-relbuild-v-'));
  try {
    assert.equal(cli(['--ref', 'v1.2.3', '--out', out], { repo }).status, EXIT.OK);
    const manifest = join(out, MANIFEST_NAME);
    const ok = cli(['--verify', manifest, '--json'], { repo });
    assert.equal(ok.status, EXIT.OK, ok.stderr);
    const v = JSON.parse(ok.stdout);
    assert.deepEqual(v.results.map((r) => r.published), ['match', 'match']);

    const gzPath = join(out, 'demo-1.2.3-source.tar.gz');
    const pristine = readFileSync(gzPath);
    const bad = Buffer.from(pristine);
    bad[bad.length - 20] ^= 0x01;
    writeFileSync(gzPath, bad);
    const tampered = cli(['--verify', manifest], { repo });
    assert.equal(tampered.status, EXIT.MISMATCH);
    assert.match(tampered.stderr, /demo-1\.2\.3-source\.tar\.gz: published sha256 [0-9a-f]{64} differs/);
    assert.match(tampered.stderr, new RegExp(`first differing byte against the rebuild: ${bad.length - 20}`));
    assert.doesNotMatch(tampered.stderr, /demo-1\.2\.3-source\.tar:/, 'the untouched tar is not blamed');

    // a manifest edited to claim other bytes fails against the rebuild, even with no file beside it
    writeFileSync(gzPath, pristine);
    rmSync(gzPath);
    const m = JSON.parse(readFileSync(manifest, 'utf8'));
    m.artefacts[0].sha256 = '0'.repeat(64);
    writeFileSync(manifest, JSON.stringify(m));
    const forged = cli(['--verify', manifest, '--json'], { repo });
    assert.equal(forged.status, EXIT.MISMATCH);
    const fv = JSON.parse(forged.stdout);
    assert.equal(fv.results[1].published, 'absent', 'an absent file is reported absent, never a match');
    assert.match(fv.problems.join('\n'), /demo-1\.2\.3-source\.tar: rebuilt sha256/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('a tag moved to another commit is a mismatch', () => {
  const repo = fixtureRepo();
  const out = mkdtempSync(join(tmpdir(), 'cw-relbuild-m-'));
  try {
    assert.equal(cli(['--ref', 'v1.2.3', '--out', out], { repo }).status, EXIT.OK);
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'later']);
    git(repo, ['tag', '-f', 'v1.2.3']);
    const r = cli(['--verify', join(out, MANIFEST_NAME)], { repo });
    assert.equal(r.status, EXIT.MISMATCH);
    assert.match(r.stderr, /ref v1\.2\.3 now names/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('unreadable inputs exit 21 and write nothing; bad arguments exit 22', () => {
  const repo = fixtureRepo();
  const out = mkdtempSync(join(tmpdir(), 'cw-relbuild-u-'));
  try {
    const noRef = cli(['--ref', 'no-such-ref', '--out', out], { repo });
    assert.equal(noRef.status, EXIT.UNREADABLE);
    assert.deepEqual(readdirSync(out), []);
    assert.equal(cli(['--verify', join(out, 'absent.json')], { repo }).status, EXIT.UNREADABLE);
    writeFileSync(join(out, 'garbage.json'), '{ not json');
    assert.equal(cli(['--verify', join(out, 'garbage.json')], { repo }).status, EXIT.UNREADABLE);
    writeFileSync(join(out, 'other.json'), JSON.stringify({ schema: 'something-else' }));
    assert.equal(cli(['--verify', join(out, 'other.json')], { repo }).status, EXIT.UNREADABLE);

    writeFileSync(join(repo, 'package.json'), '{ broken');
    git(repo, ['commit', '-q', '-am', 'break the manifest']);
    assert.equal(cli(['--ref', 'HEAD', '--out', out], { repo }).status, EXIT.UNREADABLE, 'an unparseable package.json is not a missing one');

    for (const args of [[], ['--ref', 'HEAD'], ['--out', out], ['--verify'], ['--verify', 'x', '--ref', 'HEAD'], ['--bogus']]) {
      assert.equal(cli(args, { repo }).status, EXIT.USAGE, args.join(' '));
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
