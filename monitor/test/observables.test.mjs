// node --test monitor/test/ — observables.mjs: the corpus feeder. The load-bearing assertions are
// NON-VACUITY (an extractor that silently returns [] is the documented GuardDog failure) and that
// every ecosystem present in the fleet is either extracted or DECLARED unread.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXTRACTORS, DECLARED_VOIDS, npmNameFromPath,
  extractNpmLock, extractPackageJson, extractGoMod, extractCargoLock,
  extractRequirements, extractYarnLock, extractGradleLockfile,
  extractPnpmLock, pnpmPackageName, parsePnpmFlowMapping,
  extractGemfileLock, extractByJsonSpec, JSON_LOCK_SPECS,
  extractSyftSbom, parsePurl, findSbom, TIER, extractGradleVerificationMetadata,
  collectRepo, collectFleet, hostDistribution,
} from '../observables.mjs';
import { OBSERVABLE } from '../indicators.mjs';
import { isUnknown } from '../unknown.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-obs-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

const typesOf = (r) => new Set(r.observables.map((o) => o.type));
const valuesOf = (r, type) => r.observables.filter((o) => o.type === type).map((o) => o.value);

describe('npm lockfiles — all three generations, and NONE of them may return [] quietly', () => {
  // v3: the graph is in packages{}, keyed by install path. GuardDog read `dependencies` here,
  // found nothing, exited 0, and 158 runs recorded clean trees.
  const v3 = JSON.stringify({
    name: 'x', lockfileVersion: 3,
    packages: {
      '': { name: 'x', version: '1.0.0' },
      'node_modules/left-pad': {
        version: '1.3.0',
        resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
        integrity: 'sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA==',
      },
      'node_modules/@scope/pkg': { version: '2.0.0', resolved: 'https://registry.npmjs.org/@scope/pkg/-/pkg-2.0.0.tgz' },
    },
  });

  const v1 = JSON.stringify({
    name: 'x', lockfileVersion: 1,
    dependencies: {
      'left-pad': {
        version: '1.3.0',
        resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
        integrity: 'sha1-0LmiSVGaX3Xr6R8dmbEZO0PgxCk=',
        dependencies: { 'nested-dep': { version: '0.1.0', resolved: 'https://registry.npmjs.org/nested-dep/-/nested-dep-0.1.0.tgz' } },
      },
    },
  });

  test('v3 yields packages, URLs, hosts and digests — NEVER zero', () => {
    const r = extractNpmLock(v3, 'repo/package-lock.json');
    assert.ok(r.observables.length > 0, 'a v3 extractor that returns nothing is the documented silent-clean defect');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['@scope/pkg', 'left-pad']);
    assert.deepEqual(valuesOf(r, OBSERVABLE.DOMAIN), ['registry.npmjs.org', 'registry.npmjs.org']);
    assert.equal(valuesOf(r, OBSERVABLE.SHA512).length, 1);
  });

  test('the ROOT entry ("") is not a dependency', () => {
    assert.ok(!valuesOf(extractNpmLock(v3, 'w'), OBSERVABLE.PACKAGE).includes('x'));
  });

  test('v1 yields packages — and RECURSES, because a squat hides in a transitive', () => {
    const r = extractNpmLock(v1, 'repo/package-lock.json');
    const pkgs = valuesOf(r, OBSERVABLE.PACKAGE).sort();
    assert.deepEqual(pkgs, ['left-pad', 'nested-dep'], 'a non-recursive v1 walk misses exactly where a squat lives');
    assert.equal(valuesOf(r, OBSERVABLE.SHA1).length, 1);
  });

  test('v2 carries BOTH shapes and is read once, not twice', () => {
    const v2 = JSON.stringify({
      lockfileVersion: 2,
      packages: { '': {}, 'node_modules/left-pad': { resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz' } },
      dependencies: { 'left-pad': { resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz' } },
    });
    const r = extractNpmLock(v2, 'w');
    assert.equal(valuesOf(r, OBSERVABLE.PACKAGE).length, 1, 'reading both blocks doubles every count downstream');
  });

  test('a lockfile with NEITHER block is `unstated` and says which — not an empty tree', () => {
    const r = extractNpmLock(JSON.stringify({ lockfileVersion: 9 }), 'repo/package-lock.json');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unstated');
    assert.match(r.unknownDetail, /shape this extractor does not read/);
  });

  test('an unparseable lockfile is unparseable, never an empty extraction', () => {
    const r = extractNpmLock('{ broken', 'w');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unparseable');
    assert.equal(r.observables, undefined);
  });

  test('npmNameFromPath keeps scopes and takes the LAST node_modules segment', () => {
    assert.equal(npmNameFromPath('node_modules/left-pad'), 'left-pad');
    assert.equal(npmNameFromPath('node_modules/@scope/pkg'), '@scope/pkg');
    assert.equal(npmNameFromPath('node_modules/a/node_modules/b'), 'b', 'the nested copy is package b, not a');
  });
});

describe('a local specifier asserts no origin', () => {
  test('file:, link: and portal: contribute no URL and no host', () => {
    const r = extractNpmLock(JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/local': { resolved: 'file:../local' }, 'node_modules/w': { resolved: 'link:./w' } },
    }), 'w');
    assert.equal(typesOf(r).has(OBSERVABLE.URL), false);
    assert.equal(typesOf(r).has(OBSERVABLE.DOMAIN), false);
    assert.equal(valuesOf(r, OBSERVABLE.PACKAGE).length, 2, 'the names are still corpus');
  });
});

describe('go.mod', () => {
  const mod = `module example.com/x

go 1.22

require (
	github.com/stretchr/testify v1.9.0 // indirect
	go.uber.org/zap v1.27.0
)

require golang.org/x/net v0.24.0
`;
  test('block and single-line requires both parse, and the module host is extracted', () => {
    const r = extractGoMod(mod, 'repo/go.mod');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(),
      ['github.com/stretchr/testify', 'go.uber.org/zap', 'golang.org/x/net']);
    assert.deepEqual([...new Set(valuesOf(r, OBSERVABLE.DOMAIN))].sort(),
      ['github.com', 'go.uber.org', 'golang.org']);
  });
  test('the `module` and `go` lines are not requirements', () => {
    assert.ok(!valuesOf(extractGoMod(mod, 'w'), OBSERVABLE.PACKAGE).includes('example.com/x'));
  });
});

describe('Cargo.lock', () => {
  const lock = `# auto-generated
[[package]]
name = "serde"
version = "1.0.197"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "3fb1c873e1b9b056a4dc4c0c198b24c3ffa059243875552b2bd0933b1aee4ce2"

[[package]]
name = "local-crate"
version = "0.1.0"

[metadata]
irrelevant = "x"
`;
  test('names, checksums and the registry source are extracted; [metadata] is not a package', () => {
    const r = extractCargoLock(lock, 'repo/Cargo.lock');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['local-crate', 'serde']);
    assert.equal(valuesOf(r, OBSERVABLE.SHA256).length, 1);
    assert.deepEqual(valuesOf(r, OBSERVABLE.DOMAIN), ['github.com']);
  });
  test('a path-only crate contributes a name and no origin', () => {
    const r = extractCargoLock(lock, 'w');
    assert.equal(valuesOf(r, OBSERVABLE.URL).length, 1, 'only the crate WITH a source asserts one');
  });
});

describe('requirements.txt', () => {
  test('pins, extras, direct URLs and PEP 508 @ forms', () => {
    const r = extractRequirements(
      '# comment\nrequests==2.31.0\nflask[async]>=2\n-r other.txt\n--index-url https://example.test/simple\n'
      + 'mypkg @ https://files.example.test/mypkg-1.0.tgz\nhttps://files.example.test/bare-1.0.whl\n',
      'repo/requirements.txt',
    );
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['flask', 'mypkg', 'requests']);
    assert.equal(valuesOf(r, OBSERVABLE.URL).length, 2);
    // `-r` and `--index-url` are directives, not requirements — an index URL is configuration.
    assert.ok(!valuesOf(r, OBSERVABLE.PACKAGE).includes('other.txt'));
  });
});

describe('yarn.lock — v1 read, Berry DECLARED unread', () => {
  test('v1 entries yield names, resolved URLs and integrity', () => {
    const r = extractYarnLock(
      '# yarn lockfile v1\n\n"left-pad@^1.3.0", "left-pad@~1.3.0":\n  version "1.3.0"\n'
      + '  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz#abc"\n'
      + '  integrity sha512-XI5MPzVNApjAyhQzphX8Bkm==\n',
      'repo/yarn.lock',
    );
    assert.deepEqual([...new Set(valuesOf(r, OBSERVABLE.PACKAGE))], ['left-pad']);
    assert.deepEqual(valuesOf(r, OBSERVABLE.DOMAIN), ['registry.yarnpkg.com']);
    assert.equal(valuesOf(r, OBSERVABLE.SHA512).length, 1);
    assert.ok(!valuesOf(r, OBSERVABLE.URL)[0].includes('#'), 'the fragment is not part of the origin');
  });

  test('a Berry lockfile is refused BY NAME rather than partially read', () => {
    const r = extractYarnLock('__metadata:\n  version: 8\n\n"left-pad@npm:^1.3.0":\n  version: 1.3.0\n', 'repo/yarn.lock');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unexaminable');
    assert.match(r.unknownDetail, /Berry/);
  });

  test('a scoped v1 entry keeps its scope — the LAST @ separates name from range', () => {
    const r = extractYarnLock('# yarn lockfile v1\n\n"@babel/core@^7.0.0":\n  version "7.1.0"\n', 'w');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE), ['@babel/core']);
  });
});

describe('package.json contributes names and says what it does NOT contribute', () => {
  test('all four dependency fields, and the note is explicit', () => {
    const r = extractPackageJson(JSON.stringify({
      dependencies: { a: '^1' }, devDependencies: { b: '^1' },
      optionalDependencies: { c: '^1' }, peerDependencies: { d: '^1' },
    }), 'repo/package.json');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['a', 'b', 'c', 'd']);
    assert.match(r.note, /no resolved version, no origin/);
    assert.equal(typesOf(r).has(OBSERVABLE.URL), false);
  });
});

describe('hostDistribution counts REFERENCES, not distinct entries', () => {
  test('a deduplicated corpus still reports real magnitudes', () => {
    // Written the obvious way this returned 1 for every host, including github.com, and the
    // resulting flat alphabetical list looked entirely plausible.
    const corpus = [
      { type: OBSERVABLE.DOMAIN, value: 'github.com', occurrences: 12770 },
      { type: OBSERVABLE.DOMAIN, value: 'registry.npmmirror.com', occurrences: 47 },
      { type: OBSERVABLE.PACKAGE, value: 'left-pad', occurrences: 3 },
    ];
    assert.deepEqual(hostDistribution(corpus), [
      { host: 'github.com', references: 12770 },
      { host: 'registry.npmmirror.com', references: 47 },
    ]);
  });

  test('a distribution where every bar is equal height is the tell — assert it is not', () => {
    const corpus = [
      { type: OBSERVABLE.DOMAIN, value: 'a.test', occurrences: 5 },
      { type: OBSERVABLE.DOMAIN, value: 'b.test', occurrences: 1 },
    ];
    const counts = hostDistribution(corpus).map((h) => h.references);
    assert.notEqual(new Set(counts).size, 1);
  });
});

describe('SBOM-derived observables carry a WEAKER tier', () => {
  const sbom = JSON.stringify({
    bomFormat: 'CycloneDX',
    components: [
      { purl: 'pkg:pypi/requests@2.31.0' },
      { purl: 'pkg:maven/org.slf4j/slf4j-api@2.0.9' },
      { purl: 'pkg:npm/%40babel/core@7.24.0' },
      { purl: 'pkg:github/actions/checkout@v4' },
      { name: 'no-purl-here' },
    ],
  });

  test('a purl becomes a package, and maven joins group:artifact like gradle.lockfile does', () => {
    const r = extractSyftSbom(sbom, 'repo/sbom-syft.json');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(),
      ['@babel/core', 'org.slf4j:slf4j-api', 'requests']);
  });

  test('GitHub Actions are excluded — a workflow action is not a dependency of the software', () => {
    const r = extractSyftSbom(sbom, 'w');
    assert.ok(!valuesOf(r, OBSERVABLE.PACKAGE).includes('actions/checkout'));
    assert.equal(r.excluded, 1);
  });

  test('a component with no purl is COUNTED as unnamed, never guessed at from `name`', () => {
    assert.equal(extractSyftSbom(sbom, 'w').unnamed, 1);
  });

  test('every observable is tier `derived`', () => {
    const r = extractSyftSbom(sbom, 'w');
    assert.ok(r.observables.every((o) => o.tier === TIER.DERIVED));
    assert.equal(r.provenance.canOrigin, false, 'an SBOM asserts neither an origin URL nor a digest here');
  });

  test('a document with no components[] is `unstated`, not empty', () => {
    const r = extractSyftSbom(JSON.stringify({ bomFormat: 'CycloneDX' }), 'w');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unstated');
  });

  test('parsePurl handles scopes, versions, qualifiers and refuses what it cannot read', () => {
    assert.deepEqual(parsePurl('pkg:npm/%40scope/name@1.0.0'), { ecosystem: 'npm', name: '@scope/name' });
    assert.deepEqual(parsePurl('pkg:pypi/requests'), { ecosystem: 'pypi', name: 'requests' });
    assert.deepEqual(parsePurl('pkg:maven/g/a@1?type=jar'), { ecosystem: 'maven', name: 'g:a' });
    assert.equal(parsePurl('not-a-purl'), null);
    assert.equal(parsePurl(undefined), null);
  });
});

describe('findSbom must NAME the repo', () => {
  test('a batch-level sbom is NOT attributed to an arbitrary repo', () => withTmp((d) => {
    // The first version accepted reports/<batch>/sbom-syft.json as a fallback for any repo name.
    // Every repo then reported "has an SBOM" pointing at one file, and one repo's dependency list
    // would have been attributed to the whole fleet.
    mkdirSync(join(d, 'batch-1'), { recursive: true });
    writeFileSync(join(d, 'batch-1', 'sbom-syft.json'), JSON.stringify({ components: [{ purl: 'pkg:npm/a@1' }] }));
    assert.equal(findSbom(d, 'some-other-repo'), null, 'a wrong SBOM is worse than a missing one');
  }));

  test('an sbom under the repo\'s own directory IS found, newest batch winning', () => withTmp((d) => {
    for (const b of ['sweep-20260101', 'sweep-20260202']) {
      mkdirSync(join(d, b, 'myrepo'), { recursive: true });
      writeFileSync(join(d, b, 'myrepo', 'sbom-syft.json'), JSON.stringify({ components: [] }));
    }
    assert.match(findSbom(d, 'myrepo'), /sweep-20260202/);
  }));

  test('a missing reports dir is null, not a throw', () => {
    assert.equal(findSbom(join(tmpdir(), 'cw-obs-no-reports'), 'x'), null);
  });
});

describe('tiers are never summed into one number', () => {
  test('a name in BOTH a lockfile and an SBOM keeps the stronger tier', () => withTmp((d) => {
    const repo = join(d, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { shared: '^1' } }));
    const reports = join(d, 'reports');
    mkdirSync(join(reports, 'b1', 'repo'), { recursive: true });
    writeFileSync(join(reports, 'b1', 'repo', 'sbom-syft.json'),
      JSON.stringify({ components: [{ purl: 'pkg:npm/shared@1.0.0' }, { purl: 'pkg:npm/onlyderived@1.0.0' }] }));

    const r = collectFleet([{ name: 'repo', path: repo }], { sbomDir: reports });
    assert.equal(r.corpus.find((o) => o.value === 'shared').tier, TIER.DECLARED,
      'a committed claim is not weakened by a tool also noticing it');
    assert.equal(r.corpus.find((o) => o.value === 'onlyderived').tier, TIER.DERIVED);
    assert.equal(r.byTier.declared, 1);
    assert.equal(r.byTier.derived, 1);
  }));

  test('manifest coverage does NOT count SBOM-only repos — the guard caught this live', () => withTmp((d) => {
    // Counting them put observed (131) above population (121) and denominator.mjs threw rather
    // than render a coverage above 1.
    const repo = join(d, 'repo'); mkdirSync(repo);          // no manifest at all
    const reports = join(d, 'reports');
    mkdirSync(join(reports, 'b1', 'repo'), { recursive: true });
    writeFileSync(join(reports, 'b1', 'repo', 'sbom-syft.json'), JSON.stringify({ components: [{ purl: 'pkg:npm/x@1' }] }));

    const r = collectFleet([{ name: 'repo', path: repo }], { sbomDir: reports });
    assert.equal(r.corpusSize, 1, 'the derived observable is still in the corpus');
    assert.ok(r.coverage.observed <= r.coverage.population, 'and never inflates manifest coverage');
  }));

  test('without a sbomDir nothing is derived and `sbom` is null', () => withTmp((d) => {
    const repo = join(d, 'repo'); mkdirSync(repo);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: { a: '^1' } }));
    const r = collectFleet([{ name: 'repo', path: repo }]);
    assert.equal(r.sbom, null);
    assert.equal(r.byTier.derived, undefined);
  }));
});

describe('Gemfile.lock — indentation is load-bearing', () => {
  const lock = `GIT
  remote: https://github.com/haines/pg-aws_rds_iam.git
  revision: fb91b92
  specs:
    pg-aws_rds_iam (0.7.0)
      aws-sdk-rds (~> 1.0)
      pg (~> 1.3)

GEM
  remote: https://rubygems.org/
  specs:
    addressable (2.9.0)
      public_suffix (>= 2.0.2, < 8.0)
    afm (1.0.0)

PLATFORMS
  ruby

DEPENDENCIES
  addressable
`;

  test('four-space lines are resolved gems; six-space lines are CONSTRAINTS, not packages', () => {
    const r = extractGemfileLock(lock, 'repo/Gemfile.lock');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['addressable', 'afm', 'pg-aws_rds_iam']);
    assert.ok(!valuesOf(r, OBSERVABLE.PACKAGE).some((v) => /[()<>~]/.test(v)),
      'reading constraint lines mints entries like `public_suffix (>= 2.0.2, < 8.0)` and triples the count');
  });

  test('each section carries its OWN remote — GIT and GEM are different origins', () => {
    const r = extractGemfileLock(lock, 'w');
    assert.deepEqual([...new Set(valuesOf(r, OBSERVABLE.DOMAIN))].sort(), ['github.com', 'rubygems.org']);
  });

  test('the DEPENDENCIES and PLATFORMS sections are not specs', () => {
    assert.equal(valuesOf(extractGemfileLock(lock, 'w'), OBSERVABLE.PACKAGE).includes('ruby'), false);
  });

  test('no digest is claimed — this format carries none', () => {
    const r = extractGemfileLock(lock, 'w');
    assert.equal(r.provenance.canDigest, false);
    assert.equal(r.provenance.withOrigin, 3);
  });
});

describe('composer.lock via the declarative JSON spec', () => {
  const spec = JSON_LOCK_SPECS['composer.lock'];
  const lock = JSON.stringify({
    packages: [{
      name: 'composer/ca-bundle',
      dist: { url: 'https://api.github.com/repos/composer/ca-bundle/zipball/961a5e', shasum: '' },
      source: { url: 'https://github.com/composer/ca-bundle.git' },
    }],
    'packages-dev': [{ name: 'phpunit/phpunit', dist: { url: 'https://example.test/p.zip', shasum: 'abc123' } }],
  });

  test('both arrays are read — dev dependencies are dependencies', () => {
    const r = extractByJsonSpec(spec, lock, 'repo/composer.lock');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['composer/ca-bundle', 'phpunit/phpunit']);
  });

  test('dist wins over source — provenance is where the BYTES came from', () => {
    const r = extractByJsonSpec(spec, lock, 'w');
    const urls = valuesOf(r, OBSERVABLE.URL);
    assert.ok(urls.some((u) => u.includes('zipball')));
    assert.ok(!urls.some((u) => u.endsWith('.git')), 'the source repo is not the artifact');
  });

  test('an EMPTY shasum is not a digest — composer writes them constantly', () => {
    const r = extractByJsonSpec(spec, lock, 'w');
    assert.equal(r.provenance.withDigest, 1, 'one real shasum, one blank');
    assert.deepEqual(valuesOf(r, OBSERVABLE.SHA1), ['abc123']);
  });

  test('a file with none of the declared arrays is `unstated`, not empty', () => {
    const r = extractByJsonSpec(spec, JSON.stringify({ _readme: [] }), 'w');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unstated');
  });

  test('every JSON_LOCK_SPECS entry is dispatched — a spec nothing runs would be a lie', () => {
    for (const file of Object.keys(JSON_LOCK_SPECS)) {
      assert.ok(EXTRACTORS[file], `${file} has a spec and no extractor`);
    }
  });

  test('a spec declares all four paths it needs', () => {
    for (const [file, s] of Object.entries(JSON_LOCK_SPECS)) {
      assert.ok(Array.isArray(s.arrays) && s.arrays.length, `${file}: no arrays`);
      assert.ok(typeof s.name === 'string', `${file}: no name path`);
      assert.equal(typeof s.canOrigin, 'boolean', `${file}: capability must be declared, not inferred`);
      assert.equal(typeof s.canDigest, 'boolean', `${file}: capability must be declared, not inferred`);
    }
  });
});

describe('pnpm — a restricted reader that REFUSES rather than approximates', () => {
  const v9 = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

packages:

  '@babel/core@7.24.0':
    resolution: {integrity: sha512-AAAA==}
    engines: {node: '>=6.9.0'}
    os: [linux, darwin]
    cpu: [x64]

  'left-pad@1.3.0':
    resolution: {integrity: sha512-BBBB==}

  'foo@1.0.0(react@18.0.0)':
    resolution: {integrity: sha512-CCCC==}

  '@jsr/std__assert@1.0.19':
    resolution: {tarball: https://npm.jsr.io/~/11/@jsr/std__assert/1.0.19.tgz}

snapshots:
  '@babel/core@7.24.0': {}
`;

  test('names, integrity and the tarball origin come out of the packages block', () => {
    const r = extractPnpmLock(v9, 'repo/pnpm-lock.yaml');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(),
      ['@babel/core', '@jsr/std__assert', 'foo', 'left-pad']);
    assert.equal(valuesOf(r, OBSERVABLE.SHA512).length, 3);
    assert.deepEqual(valuesOf(r, OBSERVABLE.DOMAIN), ['npm.jsr.io']);
  });

  test('a peer suffix is stripped BEFORE the last-@ split', () => {
    assert.equal(pnpmPackageName('foo@1.0.0(react@18.0.0)'), 'foo',
      'splitting first yields `foo@1.0.0(react`');
    assert.equal(pnpmPackageName('@babel/core@7.24.0'), '@babel/core');
    assert.equal(pnpmPackageName('plain@1.0.0'), 'plain');
  });

  test('flow SEQUENCES are tolerated and ignored — os/cpu appear thousands of times', () => {
    const r = extractPnpmLock(v9, 'w');
    assert.ok(!valuesOf(r, OBSERVABLE.PACKAGE).includes('linux'), 'a platform constraint is not a package');
    assert.equal(r.observables.length > 0, true, 'refusing them would have rejected every modern lockfile');
  });

  test('the snapshots block is not read as packages', () => {
    assert.equal(valuesOf(extractPnpmLock(v9, 'w'), OBSERVABLE.PACKAGE).filter((v) => v === '@babel/core').length, 1);
  });

  test('a leading `---` is a single document and parses', () => {
    const r = extractPnpmLock(`---\n${v9}`, 'w');
    assert.ok(r.observables.length > 0, 'bluesky-social_atproto opens with one and is otherwise ordinary');
  });

  test('claims NO origin for registry packages — that lives in .npmrc, not the lockfile', () => {
    const r = extractPnpmLock(v9, 'w');
    assert.equal(r.provenance.canOrigin, false);
    assert.equal(r.provenance.canDigest, true, 'integrity IS in the lockfile, so a gap there is real');
    assert.equal(r.provenance.withDigest, 3);
  });
});

describe('pnpm refusals — each costs a declared gap, never a shorter corpus', () => {
  const wrap = (body) => `lockfileVersion: '9.0'\n\npackages:\n\n${body}`;

  test('an anchor is refused BY NAME', () => {
    const r = extractPnpmLock("lockfileVersion: '9.0'\ndefaults: &d\n  a: b\npackages:\n", 'w');
    assert.equal(isUnknown(r), true);
    assert.match(r.unknownDetail, /anchor/);
  });

  test('a merge key is refused', () => {
    const r = extractPnpmLock("lockfileVersion: '9.0'\nx:\n  <<: *d\npackages:\n", 'w');
    assert.equal(isUnknown(r), true);
  });

  test('a block scalar on an IGNORED key is skipped, and later entries still read', () => {
    // logseq_logseq carries exactly one of these, on `deprecated`, and a blanket refusal cost the
    // whole repo — 1,195 packages — for a field this module never reads.
    const r = extractPnpmLock(wrap(
      "  'a@1.0.0':\n    deprecated: |-\n      some long\n      multiline text\n    resolution: {integrity: sha512-AAAA==}\n\n"
      + "  'b@2.0.0':\n    resolution: {integrity: sha512-BBBB==}\n",
    ), 'w');
    assert.equal(isUnknown(r), false, r.unknownDetail || '');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['a', 'b']);
    assert.equal(valuesOf(r, OBSERVABLE.SHA512).length, 2, 'the entry AFTER the block scalar must survive');
  });

  test('a block scalar as a RESOLUTION is still refused — it would hide the payload', () => {
    const r = extractPnpmLock(wrap("  'a@1.0.0':\n    resolution: |-\n      integrity: sha512-AAAA==\n"), 'w');
    assert.equal(isUnknown(r), true);
    assert.match(r.unknownDetail, /block scalar/);
  });

  test('TWO documents each declaring packages: is refused, naming the count', () => {
    // bluesky-social_atproto is literally two lockfiles concatenated.
    const r = extractPnpmLock(`${wrap("  'a@1.0.0':\n    resolution: {integrity: sha512-A==}\n")}\n---\n${wrap("  'b@1.0.0':\n    resolution: {integrity: sha512-B==}\n")}`, 'w');
    assert.equal(isUnknown(r), true);
    assert.match(r.unknownDetail, /2 documents/);
  });

  test('a NESTED flow mapping is refused, not flattened', () => {
    const r = extractPnpmLock(wrap("  'a@1.0.0':\n    resolution: {integrity: {v: sha512-A==}}\n"), 'w');
    assert.equal(isUnknown(r), true);
    assert.match(r.unknownDetail, /nested flow/);
  });

  test('no packages: block is `unstated` — not a lockfile with no packages', () => {
    const r = extractPnpmLock("lockfileVersion: '9.0'\nsettings:\n  a: b\n", 'w');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unstated');
  });

  test('parsePnpmFlowMapping returns null on nesting so the caller can refuse', () => {
    assert.equal(parsePnpmFlowMapping('integrity: {a: b}'), null);
    assert.deepEqual(parsePnpmFlowMapping("integrity: sha512-A==, tarball: https://x/y"),
      { integrity: 'sha512-A==', tarball: 'https://x/y' });
  });
});

describe('gradle.lockfile — the resolved JVM graph that is already in the tree', () => {
  const lock = `# This is a Gradle generated file for dependency locking.
# Manual edits can break the build and are not advised.
# This file is expected to be part of source control.
ch.qos.logback:logback-classic:1.5.38=compileClasspath,runtimeClasspath
com.ecwid.consul:consul-api:1.4.5=compileClasspath
empty=annotationProcessor,testAnnotationProcessor
`;

  test('coordinates are extracted at group:artifact — the pair is the identity', () => {
    const r = extractGradleLockfile(lock, 'repo/gradle.lockfile');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(),
      ['ch.qos.logback:logback-classic', 'com.ecwid.consul:consul-api']);
  });

  test('the `empty=` sentinel is NOT a package — it appears in most real lockfiles', () => {
    const names = valuesOf(extractGradleLockfile(lock, 'w'), OBSERVABLE.PACKAGE);
    assert.ok(!names.includes('empty'), 'reading it would mint a dependency called `empty` in every JVM repo');
  });

  test('comments are skipped and a malformed coordinate is dropped, not padded', () => {
    const r = extractGradleLockfile('# hdr\nnotacoordinate=x\na:b:1.0=c\n', 'w');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE), ['a:b']);
  });

  test('it claims NO origin — repositories live in build.gradle, which this does not read', () => {
    const r = extractGradleLockfile(lock, 'w');
    assert.equal(r.provenance.canOrigin, false, 'attributing these to Maven Central would be an assumption');
    assert.equal(r.provenance.canDigest, false, 'a lockfile pins versions; bytes are pinned in verification-metadata.xml');
    assert.equal(typesOf(r).has(OBSERVABLE.DOMAIN), false);
  });

  test('an empty or comment-only lockfile yields nothing and does not throw', () => {
    assert.deepEqual(extractGradleLockfile('# only a header\n', 'w').observables, []);
    assert.deepEqual(extractGradleLockfile('', 'w').observables, []);
  });
});

describe('provenance — CANNOT is not DID-NOT', () => {
  test('package.json declares itself incapable of both', () => {
    const p = extractPackageJson(JSON.stringify({ dependencies: { a: '^1' } }), 'w').provenance;
    assert.equal(p.canOrigin, false);
    assert.equal(p.canDigest, false);
    assert.equal(p.packages, 1);
  });

  test('an npm lock IS capable, so a gap in it is a real gap', () => {
    const p = extractNpmLock(JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/pinned': { resolved: 'https://registry.npmjs.org/p/-/p-1.tgz', integrity: 'sha512-AAA==' },
        'node_modules/bare': { version: '1.0.0' },
      },
    }), 'w').provenance;
    assert.equal(p.canOrigin, true);
    assert.equal(p.packages, 2);
    assert.equal(p.withOrigin, 1, 'the AlkaidLab shape: an entry with neither resolved nor integrity');
    assert.equal(p.withDigest, 1);
  });

  test('a file:/link: specifier is NOT an origin claim — a workspace is not provenanced', () => {
    const p = extractNpmLock(JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/local': { resolved: 'file:../local' } },
    }), 'w').provenance;
    assert.equal(p.withOrigin, 0);
  });

  test('go.mod is origin-capable structurally and digest-INcapable — go.sum is not read', () => {
    const p = extractGoMod('module x\n\nrequire github.com/a/b v1.0.0\n', 'w').provenance;
    assert.equal(p.canOrigin, true);
    assert.equal(p.withOrigin, 1, 'the module path IS the origin');
    assert.equal(p.canDigest, false);
  });

  test('requirements.txt is declared origin-INcapable, and the judgement is deliberate', () => {
    const p = extractRequirements('requests==2.31.0\n', 'w').provenance;
    assert.equal(p.canOrigin, false,
      'marking it capable put three ordinary Python repos at 0.0% and back atop the worst-first list');
  });

  test('fleet coverage is computed over the CAPABLE population only', () => withTmp((d) => {
    const a = join(d, 'a'); const b = join(d, 'b');
    mkdirSync(a); mkdirSync(b);
    // 2 packages that cannot assert an origin, 1 that can and does.
    writeFileSync(join(a, 'package.json'), JSON.stringify({ dependencies: { x: '^1', y: '^1' } }));
    writeFileSync(join(b, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/p': { resolved: 'https://registry.npmjs.org/p/-/p-1.tgz' } },
    }));
    const r = collectFleet([{ name: 'a', path: a }, { name: 'b', path: b }]);
    assert.equal(r.provenance.packages, 3);
    assert.equal(r.provenance.originCapable, 1, 'package.json entries are outside the denominator');
    assert.equal(r.originCoverage.population, 1);
    assert.equal(r.originCoverage.complete, true, '1 of 1 capable entries asserted an origin');
  }));
});

describe('collectRepo', () => {
  test('a missing repo dir is absent — not a repo with no dependencies', () => {
    const r = collectRepo(join(tmpdir(), 'cw-obs-not-here'));
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'absent');
    assert.deepEqual(r.observables, []);
  });

  test('a present-but-unextracted ecosystem lands in voids, with its reason', () => withTmp((d) => {
    // Was pnpm-lock.yaml until 2026-08-26, when pnpm stopped being a void. A test that names a
    // specific void goes stale exactly when the void is closed, which is the good direction.
    writeFileSync(join(d, 'build.gradle'), 'dependencies { implementation "a:b:1.0" }\n');
    const r = collectRepo(d, { name: 'x' });
    assert.deepEqual(r.observables, []);
    assert.equal(r.voids.length, 1);
    assert.equal(r.voids[0].file, 'build.gradle');
    assert.match(r.voids[0].why, /running gradle, which evaluates build logic/);
  }));

  test('a corrupt manifest is recorded on `sources` and does not take the repo down', () => withTmp((d) => {
    writeFileSync(join(d, 'package-lock.json'), '{ broken');
    writeFileSync(join(d, 'go.mod'), 'module x\n\nrequire github.com/a/b v1.0.0\n');
    const r = collectRepo(d, { name: 'x' });
    assert.ok(r.sources.some((s) => s.file === 'package-lock.json' && s.unknown));
    assert.ok(r.observables.length > 0, 'one bad manifest must not erase the ones that parsed');
  }));

  test('node_modules is NOT walked — a vendored lockfile is not this repo\'s declaration', () => withTmp((d) => {
    mkdirSync(join(d, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(d, 'node_modules', 'dep', 'package.json'), JSON.stringify({ dependencies: { vendored: '^1' } }));
    writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { top: '^1' } }));
    const r = collectRepo(d, { name: 'x' });
    assert.deepEqual(r.observables.map((o) => o.value), ['top']);
  }));
});

describe('collectFleet', () => {
  test('identity is (type, value) — the same package in two repos is one entry that spread', () => withTmp((d) => {
    const a = join(d, 'a'); const b = join(d, 'b');
    mkdirSync(a); mkdirSync(b);
    const pkg = JSON.stringify({ dependencies: { shared: '^1' } });
    writeFileSync(join(a, 'package.json'), pkg);
    writeFileSync(join(b, 'package.json'), pkg);
    const r = collectFleet([{ name: 'a', path: a }, { name: 'b', path: b }]);
    const entry = r.corpus.find((o) => o.value === 'shared');
    assert.equal(r.corpus.filter((o) => o.value === 'shared').length, 1);
    assert.equal(entry.occurrences, 2);
    assert.equal(entry.where.length, 2);
  }));

  test('coverage counts repos that YIELDED observables over repos that declared anything', () => withTmp((d) => {
    const a = join(d, 'a'); const b = join(d, 'b');
    mkdirSync(a); mkdirSync(b);
    writeFileSync(join(a, 'package.json'), JSON.stringify({ dependencies: { x: '^1' } }));
    writeFileSync(join(b, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');   // declares, yields nothing
    const r = collectFleet([{ name: 'a', path: a }, { name: 'b', path: b }]);
    assert.equal(r.coverage.population, 2);
    assert.equal(r.coverage.observed, 1);
    assert.equal(r.coverage.complete, false, 'an all-pnpm fleet must read as low coverage, not a small clean corpus');
  }));

  test('a repo declaring NOTHING is outside the denominator, not a coverage failure', () => withTmp((d) => {
    const a = join(d, 'a'); const empty = join(d, 'empty');
    mkdirSync(a); mkdirSync(empty);
    writeFileSync(join(a, 'package.json'), JSON.stringify({ dependencies: { x: '^1' } }));
    const r = collectFleet([{ name: 'a', path: a }, { name: 'empty', path: empty }]);
    assert.equal(r.coverage.population, 1);
    assert.equal(r.coverage.complete, true);
  }));

  test('the per-repo cap is counted, never silent', () => withTmp((d) => {
    const a = join(d, 'a'); mkdirSync(a);
    const deps = {};
    for (let i = 0; i < 30; i += 1) deps[`p${i}`] = '^1';
    writeFileSync(join(a, 'package.json'), JSON.stringify({ dependencies: deps }));
    const r = collectFleet([{ name: 'a', path: a }], { cap: 10 });
    assert.equal(r.truncated, 20);
    assert.equal(r.perRepo[0].observables, 30, 'the count stays whole');
  }));

  test('determinism — corpus order does not depend on repo order', () => withTmp((d) => {
    const a = join(d, 'a'); const b = join(d, 'b');
    mkdirSync(a); mkdirSync(b);
    writeFileSync(join(a, 'package.json'), JSON.stringify({ dependencies: { zeta: '^1' } }));
    writeFileSync(join(b, 'package.json'), JSON.stringify({ dependencies: { alpha: '^1' } }));
    const ra = collectFleet([{ name: 'a', path: a }, { name: 'b', path: b }]).corpus.map((o) => o.value);
    const rb = collectFleet([{ name: 'b', path: b }, { name: 'a', path: a }]).corpus.map((o) => o.value);
    assert.deepEqual(ra, rb);
  }));
});

describe('no ecosystem is in NEITHER table', () => {
  test('every manifest kind this module knows of is extracted or declared void', () => {
    const overlap = Object.keys(EXTRACTORS).filter((k) => k in DECLARED_VOIDS);
    assert.deepEqual(overlap, [], 'a filename in both tables makes the void count a lie');
  });

  test('every declared void carries a REASON, not just a name', () => {
    for (const [file, why] of Object.entries(DECLARED_VOIDS)) {
      assert.ok(typeof why === 'string' && why.length > 30,
        `${file} is declared void with no usable reason — "we did not get to it" is a reason, "" is not`);
    }
  });
});

describe('gradle verification-metadata — the only JVM source that pins BYTES', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<verification-metadata>
  <components>
    <component group="org.slf4j" name="slf4j-api" version="2.0.9">
      <artifact name="slf4j-api-2.0.9.jar">
        <sha256 value="0e6a2d0dcbbbf0d1e6a8b1e4a9e0d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7"/>
      </artifact>
    </component>
    <component group="nopin" name="thing" version="1.0"/>
  </components>
</verification-metadata>`;

  test('components become group:artifact, matching the lockfile and maven purl shape', () => {
    const r = extractGradleVerificationMetadata(xml, 'repo/verification-metadata.xml');
    assert.deepEqual(valuesOf(r, OBSERVABLE.PACKAGE).sort(), ['nopin:thing', 'org.slf4j:slf4j-api']);
  });

  test('a SELF-CLOSING component still counts — or this disagrees with the shell that generated it', () => {
    // bin/jvm-resolve.sh counts pins with `grep -c '<component '`, which sees both tag forms.
    // Matching only the paired form made two counts of the same thing disagree.
    const shellWouldCount = (xml.match(/<component /g) || []).length;
    const r = extractGradleVerificationMetadata(xml, 'w');
    assert.equal(valuesOf(r, OBSERVABLE.PACKAGE).length, shellWouldCount);
  });

  test('it is DIGEST-capable where a lockfile is not — that is why it is read at all', () => {
    const pins = extractGradleVerificationMetadata(xml, 'w').provenance;
    const lock = extractGradleLockfile('a:b:1.0=compileClasspath\n', 'w').provenance;
    assert.equal(pins.canDigest, true);
    assert.equal(lock.canDigest, false, 'a lockfile pins versions; only the pin list pins bytes');
    assert.equal(pins.withDigest, 1, 'the unpinned component contributes a name and no digest');
  });

  test('it claims NO origin — a pin says which bytes, never where they came from', () => {
    assert.equal(extractGradleVerificationMetadata(xml, 'w').provenance.canOrigin, false);
  });

  test('a document that is not a pin list is `unstated`, not empty', () => {
    const r = extractGradleVerificationMetadata('<other/>', 'w');
    assert.equal(isUnknown(r), true);
    assert.equal(r.unknownReason, 'unstated');
  });

  test('a malformed sha256 is not accepted as one', () => {
    const bad = '<verification-metadata><component group="g" name="a" version="1"><artifact name="x"><sha256 value="nothex"/></artifact></component></verification-metadata>';
    const r = extractGradleVerificationMetadata(bad, 'w');
    assert.equal(valuesOf(r, OBSERVABLE.SHA256).length, 0);
    assert.equal(r.provenance.withDigest, 0);
  });
});
