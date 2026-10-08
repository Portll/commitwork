// monitor/test/observables-resolved-formats.test.mjs — the 2026-08-27 widening.
//
// Every fixture below is the REAL shape probed 2026-08-26 against osv-scanner 2.5.1 (the formats
// the deps-osv gate fires on), not a shape imagined from documentation. Each reader's refusal
// branch is asserted beside its happy path, because a reader that approximates an unknown dialect
// is how a corpus fills with observables nobody can hold to anything.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractNugetLock, extractConanLock, extractMixLock, extractPubspecLock,
  extractPodfileLock, extractStackLock, extractCabalFreeze, extractVcpkgManifest,
  EXTRACTORS, JSON_LOCK_SPECS, DECLARED_VOIDS, SBOM_ECOSYSTEMS, extractSyftSbom,
} from '../observables.mjs';

const W = 'fx/repo';
const names = (r) => r.observables.filter((o) => o.type === 'package').map((o) => o.value);

test('NuGet packages.lock.json: packages + contentHash digests; Project references skipped; TFM duplicates collapse', () => {
  const r = extractNugetLock(JSON.stringify({
    version: 1,
    dependencies: {
      'net6.0': {
        'Newtonsoft.Json': { type: 'Direct', resolved: '12.0.1', contentHash: 'pBR3wCg==' },
        'My.Own.Project': { type: 'Project' },
      },
      'net8.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '12.0.1', contentHash: 'pBR3wCg==' } },
    },
  }), W);
  assert.deepEqual(names(r), ['Newtonsoft.Json']);
  assert.equal(r.provenance.withDigest, 1);
  assert.equal(extractNugetLock('{"version":1}', W).unknown, true, 'no dependencies{} refuses');
});

test('conan.lock: v2 requires and v1 graph_lock both read; recipe revisions are never digests', () => {
  const v2 = extractConanLock('{"version":"0.5","requires":["zlib/1.2.11#ffa77daf83a57094149707928bdce823%1692672717.049"]}', W);
  assert.deepEqual(names(v2), ['zlib']);
  assert.equal(v2.provenance.withDigest, 0, 'a recipe hash is not artifact provenance');
  const v1 = extractConanLock(JSON.stringify({ graph_lock: { nodes: { 0: { ref: 'probe/1.0' }, 1: { ref: 'zlib/1.2.11#ffa77daf83a57094149707928bdce823' } } }, version: '0.4' }), W);
  assert.deepEqual(names(v1).sort(), ['probe', 'zlib']);
  assert.equal(extractConanLock('{"lockfile":{}}', W).unknown, true);
});

test('mix.lock: hex entries carry the OUTER sha256; git entries carry origin + revision', () => {
  const body = `%{
  "plug": {:hex, :plug, "1.11.0", "f17217525597628298998bc3baed9f8ea1fa3f1160aa9871aee6df47a6e4d38e", [:mix], [], "hexpm", "2b8fbaa4b6b53a91f9bf05d3cd5d0eba32aae2d4f83e150ea165de5f0d5b25f8"},
  "my_fork": {:git, "https://github.com/example/my_fork.git", "532d8b529501fb73a2455b179e0bbb6d49b652ed", [tag: "v1.0"]},
}
`;
  const r = extractMixLock(body, W);
  assert.deepEqual(names(r).sort(), ['my_fork', 'plug']);
  const sha256s = r.observables.filter((o) => o.type === 'sha256').map((o) => o.value);
  assert.deepEqual(sha256s, ['2b8fbaa4b6b53a91f9bf05d3cd5d0eba32aae2d4f83e150ea165de5f0d5b25f8'],
    'the LAST 64-hex on a :hex line is the registry tarball digest — the inner contents hash is not double-counted');
  assert.ok(r.observables.some((o) => o.type === 'domain' && o.value === 'github.com'));
  assert.ok(r.observables.some((o) => o.type === 'sha1'));
  assert.equal(extractMixLock('not a mix map', W).unknown, true);
  assert.equal(extractMixLock('%{\n  "weird": {:path, "../local"},\n}', W).unknown, true, 'a map with nothing recognisable refuses rather than reading empty');
});

test('pubspec.lock: packages with registry origin and archive sha256', () => {
  const body = `packages:
  idna:
    dependency: transitive
    description:
      name: idna
      sha256: "9ecdbbd083b06798ae1e86adcbfe8ab1479cf864e4ee30fe4e46a003d12491ca"
      url: "https://pub.dev"
    source: hosted
    version: "3.6.0"
sdks:
  dart: ">=2.19.0 <4.0.0"
`;
  const r = extractPubspecLock(body, W);
  assert.deepEqual(names(r), ['idna']);
  assert.equal(r.provenance.withOrigin, 1);
  assert.equal(r.provenance.withDigest, 1);
  assert.ok(r.observables.some((o) => o.type === 'domain' && o.value === 'pub.dev'));
  assert.equal(extractPubspecLock('sdks:\n  dart: x\n', W).unknown, true);
});

test('Podfile.lock: pods from PODS:, subspecs collapse to the pod, podspec checksums never count as provenance', () => {
  const body = `PODS:
  - AFNetworking (4.0.1):
    - AFNetworking/AFError (= 4.0.1)
  - AFNetworking/AFError (4.0.1)

DEPENDENCIES:
  - AFNetworking

SPEC CHECKSUMS:
  AFNetworking: 3bd23d814e976cd148d7d44c3ab78017b744cd58

COCOAPODS: 1.15.2
`;
  const r = extractPodfileLock(body, W);
  assert.deepEqual(names(r), ['AFNetworking']);
  assert.equal(r.provenance.withDigest, 0, 'a podspec digest is not artifact provenance');
  assert.ok(r.observables.some((o) => o.type === 'sha1'), 'but the checksum IS emitted for indicator matching');
  assert.equal(extractPodfileLock('DEPENDENCIES:\n  - x\n', W).unknown, true);
});

test('stack.yaml.lock: hackage pins carry the pantry sha256; snapshot-only files refuse', () => {
  const body = `packages:
- completed:
    hackage: aeson-1.4.7.1@sha256:6d8c2e91d4bcf4ba96c7d0d4a2c1e5eb9dbf5b1efe99fbe5539090df2ec6a4c1,7565
  original:
    hackage: aeson-1.4.7.1
snapshots: []
`;
  const r = extractStackLock(body, W);
  assert.deepEqual(names(r), ['aeson']);
  assert.equal(r.provenance.withDigest, 1);
  assert.equal(extractStackLock('packages:\n- completed:\n    git: x\nsnapshots: []\n', W).unknown, true);
});

test('cabal.project.freeze: ==-pinned packages only', () => {
  const r = extractCabalFreeze('constraints: any.aeson ==1.4.7.1,\n             any.base ==4.14.0.0,\n             foo +flagonly\n', W);
  assert.deepEqual(names(r).sort(), ['aeson', 'base']);
  assert.equal(extractCabalFreeze('flags: none', W).unknown, true);
});

test('vcpkg.json: names without versions, declared as exactly that', () => {
  const r = extractVcpkgManifest('{"name":"probe","dependencies":["zlib",{"name":"openssl","features":["tools"]}]}', W);
  assert.deepEqual(names(r).sort(), ['openssl', 'zlib']);
  assert.equal(r.provenance.canOrigin, false);
  assert.equal(r.provenance.canDigest, false);
  assert.match(r.note, /names only/);
  assert.equal(extractVcpkgManifest('{"name":"probe"}', W).unknown, true);
});

test('Package.resolved v2 reads via the declarative table; v1 refuses as unstated', () => {
  const spec = JSON_LOCK_SPECS['Package.resolved'];
  assert.ok(spec, 'the spec exists, so the EXTRACTORS derivation dispatches it');
  const fn = EXTRACTORS['Package.resolved'];
  const v2 = fn(JSON.stringify({
    pins: [{ identity: 'swift-log', kind: 'remoteSourceControl', location: 'https://github.com/apple/swift-log.git', state: { revision: '532d8b529501fb73a2455b179e0bbb6d49b652ed', version: '1.5.3' } }],
    version: 2,
  }), W);
  assert.deepEqual(names(v2), ['swift-log']);
  assert.ok(v2.observables.some((o) => o.type === 'sha1'), 'the pinned git revision is the identity of the bytes fetched');
  assert.ok(v2.observables.some((o) => o.type === 'domain' && o.value === 'github.com'));
  const v1 = fn(JSON.stringify({ object: { pins: [{ package: 'swift-log' }] }, version: 1 }), W);
  assert.equal(v1.unknown, true, 'the v1 nesting is refused, never half-read');
});

test('every new format is dispatched, and the declaring faces are declared voids with reasons', () => {
  for (const f of ['packages.lock.json', 'conan.lock', 'mix.lock', 'pubspec.lock', 'Podfile.lock', 'stack.yaml.lock', 'cabal.project.freeze', 'vcpkg.json', 'Package.resolved']) {
    assert.ok(EXTRACTORS[f], `${f} must be in EXTRACTORS`);
  }
  for (const f of ['Package.swift', 'CMakeLists.txt', 'cabal.project', 'conanfile.py']) {
    assert.ok(DECLARED_VOIDS[f], `${f} must be a DECLARED void — rejecting it silently is the shape this module forbids`);
  }
});

test('the SBOM allowlist admits the six previously-dropped ecosystems, still refuses unknown ones', () => {
  for (const e of ['pub', 'hex', 'swift', 'cocoapods', 'conan', 'hackage']) {
    assert.ok(SBOM_ECOSYSTEMS.has(e), `${e} purls must reach the corpus`);
  }
  const doc = JSON.stringify({ components: [
    { purl: 'pkg:hex/plug@1.11.0' },
    { purl: 'pkg:pub/idna@3.6.0' },
    { purl: 'pkg:mystery/thing@1.0' },
  ] });
  const r = extractSyftSbom(doc, W);
  assert.deepEqual(names(r).sort(), ['idna', 'plug']);
  assert.ok(r.observables.every((o) => o.tier === 'derived'), 'SBOM observables stay tier derived — they can never sum with declared');
});

test('byte-determinism: same input, identical output, for every new reader', () => {
  const cases = [
    [extractMixLock, '%{\n  "plug": {:hex, :plug, "1.11.0", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", [:mix], [], "hexpm", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},\n}'],
    [extractCabalFreeze, 'constraints: any.base ==4.14.0.0'],
    [extractVcpkgManifest, '{"dependencies":["zlib"]}'],
  ];
  for (const [fn, input] of cases) {
    assert.equal(JSON.stringify(fn(input, W)), JSON.stringify(fn(input, W)));
  }
});

test('one unreadable repo must not take down the fleet collection', async () => {
  // Measured 2026-08-27: the registry declared repos whose bulk-clone had not landed, and
  // collectFleet died dereferencing the provenance an unknown-branch collectRepo never returns.
  const { collectFleet } = await import('../observables.mjs');
  const r = collectFleet([
    { name: 'ghost', path: '/nonexistent/path/for/this/test' },
  ], {});
  const ghost = r.perRepo.find((x) => x.repo === 'ghost');
  assert.ok(ghost, 'the unreadable repo still appears, carrying its unknown');
  assert.equal(ghost.unknown, true);
  assert.equal(r.provenance.packages, 0, 'and contributes zero, not a crash');
});
