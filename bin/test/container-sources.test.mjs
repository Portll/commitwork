// node --test bin/test/container-sources.test.mjs
//
// container/sources.mjs, the source bundle for a built image, without the network: one fetch per
// distinct source, a copyleft component without one reported rather than skipped, apt's printed
// URIs read with their digests, a Go module checked against its go.sum hash, and a tar that system
// tar reads and that is byte-identical on a re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plan, parsePrintUris, debSrc, bundlePath, tarHeader, writeTar, goRequirements, goSum, goEscape, zipFiles, dirHash, goModuleFiles } from '../../container/sources.mjs';

const index = (components) => ({ schema: 'commitwork-licenses/1', image: 'x', components });

test('a Debian source package is fetched once for all the binary packages built from it', () => {
  const { items, missing } = plan(index([
    { kind: 'debian', name: 'libc6', version: '2.36-9', licence: 'LGPL-2.1+', family: 'weak-copyleft', source: [{ debian: 'glibc', version: '2.36-9' }] },
    { kind: 'debian', name: 'libc-bin', version: '2.36-9', licence: 'GPL-2+', family: 'copyleft', source: [{ debian: 'glibc', version: '2.36-9' }] },
    { kind: 'python', name: 'semgrep', version: '1.0', licence: 'LGPL-2.1-or-later', family: 'weak-copyleft', source: [{ pypi: 'semgrep', version: '1.0' }, { github: 'semgrep/semgrep', tag: 'v1.0' }] },
    { kind: 'python', name: 'ruff', version: '0.1', licence: 'MIT', family: 'permissive', source: [] },
  ]));
  assert.deepEqual(missing, []);
  assert.deepEqual(items.map((i) => [i.key, i.components.map((c) => c.name)]), [
    ['debian glibc 2.36-9', ['libc6', 'libc-bin']], ['github semgrep/semgrep v1.0', ['semgrep']], ['pypi semgrep 1.0', ['semgrep']],
  ]);
});

test('a copyleft component the index names no source for is reported, not skipped', () => {
  const { items, missing } = plan(index([{ kind: 'component', name: 'tool', version: '1', licence: 'AGPL-3.0-only', family: 'copyleft', source: [] }]));
  assert.deepEqual(items, []);
  assert.equal(missing.length, 1);
  assert.match(missing[0].reason, /copyleft, and INDEX\.json names no source/);
});

test('apt-get --print-uris lines give the URL, file, size and SHA-256; other lines are ignored', () => {
  const got = parsePrintUris(`== git=1:2.39.5-0+deb12u3
'http://snapshot.debian.org/archive/debian/20261004T203145Z/pool/main/g/git/git_2.39.5-0%2bdeb12u3.dsc' git_2.39.5-0+deb12u3.dsc 3523 SHA256:${'a'.repeat(64)}
Reading package lists...
'http://x/y.orig.tar.xz' y.orig.tar.xz 7 SHA256:${'b'.repeat(64)}
`);
  assert.deepEqual(got.map((f) => [f.file, f.size, f.sha256[0]]), [['git_2.39.5-0+deb12u3.dsc', 3523, 'a'], ['y.orig.tar.xz', 7, 'b']]);
  assert.match(got[0].url, /^http:\/\/snapshot\.debian\.org\/archive\/debian\/20261004T203145Z\//);
});

test('the image\'s binary apt sources become source stanzas for the same snapshot', () => {
  const s = 'Types: deb\nURIs: http://snapshot.debian.org/archive/debian/20261004T203145Z\nSuites: bookworm\n\nTypes: deb\nURIs: http://snapshot.debian.org/archive/debian-security/20261004T220601Z\n';
  assert.equal(debSrc(s), s.replace(/Types: deb\n/g, 'Types: deb-src\n'));
});

test('bundle paths keep each source under its kind and name', () => {
  assert.equal(bundlePath({ debian: 'glibc' }, 'glibc_2.36.orig.tar.xz'), 'debian/glibc/glibc_2.36.orig.tar.xz');
  assert.equal(bundlePath({ pypi: 'certifi' }, 'certifi-1.tar.gz'), 'pypi/certifi/certifi-1.tar.gz');
  assert.equal(bundlePath({ github: 'o/r' }, 'r-v1.tar.gz'), 'github/o__r/r-v1.tar.gz');
});

test('a ustar header carries a valid checksum and splits a long path into prefix and name', () => {
  const h = tarHeader(`${'d'.repeat(120)}/file.txt`, 5);
  const sum = [...h].reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
  assert.equal(parseInt(h.subarray(148, 154).toString(), 8), sum);
  assert.equal(h.subarray(0, 8).toString(), 'file.txt');
  assert.equal(h.subarray(345, 465).toString().replace(/\0+$/, ''), 'd'.repeat(120));
  assert.throws(() => tarHeader(`${'x'.repeat(200)}`, 1), /too long for ustar/);
});

test('the tar is read by system tar, and the same files give the same bytes', { skip: process.platform === 'win32' && 'system tar' }, async (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-sources-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'a.orig.tar.xz'), Buffer.alloc(1000, 7));
  const entries = [{ path: 'SOURCES.json', data: Buffer.from('{}\n') }, { path: 'debian/a/a.orig.tar.xz', file: join(d, 'a.orig.tar.xz') }];
  await writeTar(join(d, 'one.tar'), entries);
  await writeTar(join(d, 'two.tar'), entries);
  assert.deepEqual(readFileSync(join(d, 'one.tar')), readFileSync(join(d, 'two.tar')));
  assert.deepEqual(execFileSync('tar', ['-tf', join(d, 'one.tar')], { encoding: 'utf8' }).trim().split('\n'), ['SOURCES.json', 'debian/a/a.orig.tar.xz']);
  assert.equal(execFileSync('tar', ['-xOf', join(d, 'one.tar'), 'SOURCES.json'], { encoding: 'utf8' }), '{}\n');
  assert.equal(readFileSync(join(d, 'one.tar')).length % 512, 0);
});

const GOMOD = `module example.test/m

go 1.24

replace github.com/a/old => github.com/fork/old v1.2.8 // patched

replace (
\tgithub.com/b/pinned v0.1.0 => github.com/b/pinned v0.1.1
\tgithub.com/c/local => ./third_party/c
)

require github.com/Single/Line v1.0.0

require (
\tgithub.com/a/old v1.0.0
\tgithub.com/b/pinned v0.1.0 // indirect
\tgithub.com/c/local v0.0.0
)
`;

test('go.mod requirements come with their replace directives applied, and a local path has no version', () => {
  assert.deepEqual(goRequirements(GOMOD), [
    { module: 'github.com/fork/old', version: 'v1.2.8' }, { module: 'github.com/b/pinned', version: 'v0.1.1' },
    { module: './third_party/c', version: null }, { module: 'github.com/Single/Line', version: 'v1.0.0' },
  ]);
  assert.equal(goEscape('github.com/Single/Line'), 'github.com/!single/!line');
});

test('a module the go.sum does not pin is reported, and a pinned one gets its .mod and .zip', () => {
  const sum = `github.com/fork/old v1.2.8 h1:zip=\ngithub.com/fork/old v1.2.8/go.mod h1:mod=\ngithub.com/Single/Line v1.0.0/go.mod h1:x=\n`;
  assert.equal(goSum(sum).get('github.com/fork/old v1.2.8/go.mod'), 'h1:mod=');
  const { modules, unpinned } = goModuleFiles(GOMOD, sum);
  assert.deepEqual(unpinned, ['github.com/b/pinned@v0.1.1', 'github.com/Single/Line@v1.0.0']);
  assert.deepEqual(modules.map((m) => m.files.map((f) => f.path)), [['go/github.com/fork/old/@v/v1.2.8.mod', 'go/github.com/fork/old/@v/v1.2.8.zip']]);
  assert.equal(modules[0].files[0].check(Buffer.from('module github.com/fork/old\n')), false, 'a go.mod that is not the pinned one fails its check');
});

test('dirHash reproduces a go.sum hash the Go ecosystem published', () => {
  // github.com/pkg/errors v0.9.1/go.mod, as every go.sum that requires it records.
  assert.equal(dirHash([{ name: 'go.mod', data: Buffer.from('module github.com/pkg/errors\n') }]), 'h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEl0=');
});

test('zipFiles reads stored and deflated entries, and dirHash ignores their order in the zip', { skip: process.platform === 'win32' && 'zip' }, (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-sources-zip-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'b.txt'), 'b'.repeat(2000));
  writeFileSync(join(d, 'a.txt'), 'a');
  execFileSync('zip', ['-qX', join(d, 'one.zip'), 'b.txt', 'a.txt'], { cwd: d });
  execFileSync('zip', ['-qX0', join(d, 'two.zip'), 'a.txt', 'b.txt'], { cwd: d });
  const one = zipFiles(readFileSync(join(d, 'one.zip'))), two = zipFiles(readFileSync(join(d, 'two.zip')));
  assert.deepEqual(one.map((f) => [f.name, f.data.length]), [['b.txt', 2000], ['a.txt', 1]]);
  assert.equal(dirHash(one), dirHash(two));
  assert.throws(() => zipFiles(Buffer.from('not a zip')), /not a zip/);
});
