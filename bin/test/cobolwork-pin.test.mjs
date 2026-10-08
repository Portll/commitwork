// bin/cobolwork-pin.mjs: an install takes only the pinned bytes, states the pinned commit and meets
// the capabilities contract, lands atomically, and is left alone once verified; --latest rewrites
// the pin from the release and nothing else. The release is a stand-in packed in process
// (lib/test/fixtures/cobolwork-pack.mjs), so nothing here touches the network.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, check, latest, readPackage, parseArgs } from '../cobolwork-pin.mjs';
import { resolveCobolwork } from '../../lib/cobolwork-resolve.mjs';
import { COMMIT, capabilitiesFor, packCobolwork, pinFor, tarball, writePins } from '../../lib/test/fixtures/cobolwork-pack.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'cobolwork-pin.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cobolwork-pin-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
// A fresh tools root, a pin naming `sha256`, and the tarball on disk.
function scene({ pack = packCobolwork(), sha256 = pack.sha256, commit = COMMIT } = {}) {
  const dir = join(TMP, `s${++n}`);
  const root = join(dir, 'tools');
  const pins = writePins(mkdirp(dir), pinFor({ sha256, commit }));
  const tgz = join(dir, 'cobolwork-9.9.9.tgz');
  writeFileSync(tgz, pack.tgz);
  return { dir, root, pins, tgz, env: { ...process.env, CW_TOOLS_ROOT: root, CW_TOOL_PINS: pins, CW_COBOLWORK_BIN: '' } };
}
function mkdirp(d) { mkdirSync(d, { recursive: true }); return d; }

test('bytes whose sha256 is not the pin\'s are refused before anything is extracted, and nothing is written', async () => {
  const s = scene({ sha256: 'f'.repeat(64) });
  const r = await install({ env: s.env, from: s.tgz });
  assert.equal(r.ok, false);
  assert.match(r.reason, /has sha256 [0-9a-f]{64}, and the pin says f{64}; nothing was extracted or written/);
  assert.equal(existsSync(s.root), false, 'the tools root was not even created');
});

test('a package whose lib/revision.json states another commit is refused, and nothing is written', async () => {
  const pack = packCobolwork({ stated: 'b'.repeat(40) });
  const s = scene({ pack });
  const r = await install({ env: s.env, from: s.tgz });
  assert.equal(r.ok, false);
  assert.match(r.reason, /the package states commit b{40}, and the pin says c0b01a+; nothing was written/);
  assert.equal(existsSync(s.root), false);
});

test('a package whose capabilities break the contract is refused, and no install directory is left', async () => {
  for (const [caps, why] of [
    [{ ...capabilitiesFor(), schemaVersion: 2 }, /capabilities schemaVersion is 2, and commitwork reads only 1/],
    [{ ...capabilitiesFor(), identity: { version: 'cobolwork/v2' } }, /fingerprint identity is "cobolwork\/v2"/],
    [{ ...capabilitiesFor(), toolVersion: '9.9.8' }, /version "9\.9\.8", and the pin says 9\.9\.9/],
    [{ ...capabilitiesFor(), toolRevision: { commit: COMMIT, dirty: true, from: 'checkout' } }, /not the release at c0b01/],
  ]) {
    const s = scene({ pack: packCobolwork({ caps }) });
    const r = await install({ env: s.env, from: s.tgz });
    assert.equal(r.ok, false, JSON.stringify(caps).slice(0, 80));
    assert.match(r.reason, why);
    assert.deepEqual(readdirSync(join(s.root, 'cobolwork')), [], 'the stage was removed and nothing was published');
  }
});

test('a tarball holding a path outside package/, a link or a duplicate is refused whole', () => {
  const base = [{ path: 'package/package.json', data: '{}' }];
  for (const [extra, why] of [
    [{ path: 'package/../../escape', data: 'x' }, /is not a path under package\//],
    [{ path: '/etc/passwd', data: 'x' }, /is not a path under package\//],
    [{ path: 'package/lib/link', type: '2', link: '/etc/passwd' }, /of type "2", not a file or a directory/],
    [{ path: 'package/PACKAGE.JSON', data: '{}' }, /appears twice/],
  ]) assert.throws(() => readPackage(tarball([...base, extra])), why);
  assert.throws(() => readPackage(Buffer.from('not gzip')), /not a gzip stream/);
});

test('a verified install is published whole, verifies by itself, and a second install leaves it alone', async () => {
  const s = scene();
  const first = await install({ env: s.env, from: s.tgz });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.installed, true);
  const dir = join(s.root, 'cobolwork', '9.9.9');
  assert.equal(first.dir, dir);
  assert.deepEqual(readdirSync(join(s.root, 'cobolwork')), ['9.9.9'], 'no stage directory is left beside it');
  const receipt = JSON.parse(readFileSync(join(dir, 'install.json'), 'utf8'));
  assert.equal(receipt.commit, COMMIT);
  assert.equal(receipt.capabilities.identity, 'cobolwork/v1');
  assert.ok(statSync(join(dir, 'package', 'bin', 'cobolwork.mjs')).mode & 0o100, 'the bin a lane runs is executable');
  const before = statSync(join(dir, 'install.json')).mtimeMs;

  const again = await install({ env: s.env, from: join(s.dir, 'no-such.tgz') });
  assert.equal(again.ok, true, again.reason);
  assert.equal(again.installed, false, 'it did not even read --from');
  assert.match(again.note, /already installed and verified; nothing written/);
  assert.equal(statSync(join(dir, 'install.json')).mtimeMs, before);

  const c = check({ env: s.env });
  assert.equal(c.ok, true, c.reason);
  assert.equal(c.capabilities.toolRevision.commit, COMMIT);
});

test('an installed file edited afterwards fails verification, and a second install refuses rather than overwrite it', async () => {
  const s = scene();
  assert.equal((await install({ env: s.env, from: s.tgz })).ok, true);
  const bin = join(s.root, 'cobolwork', '9.9.9', 'package', 'bin', 'cobolwork.mjs');
  writeFileSync(bin, `${readFileSync(bin, 'utf8')}// edited\n`);
  const c = check({ env: s.env });
  assert.equal(c.ok, false);
  assert.match(c.reason, /are not the ones installed from cobolwork-9\.9\.9\.tgz/);
  assert.equal(resolveCobolwork({ env: s.env }).ok, false, 'the resolver will not run it either');
  const r = await install({ env: s.env, from: s.tgz });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exists and does not verify .*remove it and run --install again/);
});

test('--dry-run names what it would install and writes nothing', async () => {
  const s = scene();
  const r = await install({ env: s.env, dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.source, pinFor({ sha256: 'x' }).url);
  assert.equal(existsSync(s.root), false);
});

// A gh that answers the two API calls --latest makes, from a file the test writes.
function fakeGh(dir, { tag = 'v9.10.0', digest, sha = 'd'.repeat(40), assetName } = {}) {
  const version = tag.replace(/^v/, '');
  const name = assetName || `cobolwork-${version}.tgz`;
  const release = { tag_name: tag, draft: false, prerelease: false, assets: [{ name, digest, browser_download_url: `https://github.com/Portll/cobolwork/releases/download/${tag}/${name}` }] };
  const gh = join(dir, 'gh.mjs');
  writeFileSync(gh, [
    `const release = ${JSON.stringify(release)};`,
    'const a = process.argv.slice(2);',
    `if (a[0] === 'api' && a[1] === 'repos/Portll/cobolwork/releases/latest') process.stdout.write(JSON.stringify(release));`,
    `else if (a[0] === 'api' && a[1] === 'repos/Portll/cobolwork/commits/${tag}') process.stdout.write(JSON.stringify({ sha: ${JSON.stringify(sha)} }));`,
    "else { process.stderr.write(`gh: unexpected ${a.join(' ')}\\n`); process.exitCode = 1; }",
  ].join('\n'));
  return gh;
}

test('--latest rewrites the pin from the release it reads, prints the change, and installs and commits nothing', () => {
  const s = scene();
  const gh = fakeGh(s.dir, { digest: `sha256:${'e'.repeat(64)}` });
  const r = spawnSync(process.execPath, [CLI, '--latest'], { encoding: 'utf8', env: { ...s.env, CW_GH_BIN: gh } });
  assert.equal(r.status, 0, r.stderr);
  const pin = JSON.parse(readFileSync(s.pins, 'utf8')).tools.cobolwork;
  assert.deepEqual(pin, {
    repo: 'Portll/cobolwork', version: '9.10.0', tag: 'v9.10.0', asset: 'cobolwork-9.10.0.tgz',
    url: 'https://github.com/Portll/cobolwork/releases/download/v9.10.0/cobolwork-9.10.0.tgz',
    sha256: 'e'.repeat(64), commit: 'd'.repeat(40),
  });
  assert.match(r.stdout, /version +9\.9\.9 +-> +9\.10\.0/);
  assert.match(r.stdout, /commit +c0b01a+ +-> +d{40}/);
  assert.match(r.stdout, /Nothing was installed or committed/);
  assert.equal(existsSync(s.root), false);

  const bytes = readFileSync(s.pins);
  const again = latest({ env: { ...s.env, CW_GH_BIN: gh } });
  assert.equal(again.ok, true);
  assert.equal(again.changed, false);
  assert.deepEqual(readFileSync(s.pins), bytes, 'an unchanged pin is not rewritten');
});

test('--latest refuses a release with no sha256 digest, and one older than the pin, writing nothing', () => {
  const s = scene();
  const bytes = readFileSync(s.pins);
  const nodigest = latest({ env: { ...s.env, CW_GH_BIN: fakeGh(s.dir, {}) } });
  assert.equal(nodigest.ok, false);
  assert.match(nodigest.reason, /states no sha256 digest for cobolwork-9\.10\.0\.tgz/);
  const older = latest({ env: { ...s.env, CW_GH_BIN: fakeGh(s.dir, { tag: 'v9.8.0', digest: `sha256:${'e'.repeat(64)}` }) } });
  assert.equal(older.ok, false);
  assert.match(older.reason, /older than the pinned 9\.9\.9/);
  assert.deepEqual(readFileSync(s.pins), bytes);
});

test('the CLI refuses an unknown argument without doing anything, and --check exits 1 until the pin is installed', async () => {
  const s = scene();
  const bad = spawnSync(process.execPath, [CLI, '--instal'], { encoding: 'utf8', env: s.env });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument --instal/);
  assert.throws(() => parseArgs(['--from', 'x.tgz']), /go with --install/);
  assert.throws(() => parseArgs(['--install', '--latest']), /cannot be combined/);
  const before = spawnSync(process.execPath, [CLI, '--check'], { encoding: 'utf8', env: s.env });
  assert.equal(before.status, 1);
  assert.match(before.stdout, /not installed and verified: nothing is installed at .*\n {2}install it: node bin\/cobolwork-pin\.mjs --install/);
  const inst = spawnSync(process.execPath, [CLI, '--install', '--from', s.tgz, '--json'], { encoding: 'utf8', env: s.env });
  assert.equal(inst.status, 0, inst.stdout);
  assert.equal(JSON.parse(inst.stdout).installed, true);
  const now = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env: s.env });
  assert.equal(now.status, 0, now.stdout);
  assert.match(now.stdout, /cobolwork 9\.9\.9 \(c0b01aaaaaaa\) is installed and verified/);
});
