// The package observables from a repo's latest syft SBOM (monitor/observables.mjs collectRepoSbom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRepoSbom } from '../observables.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const NOTE = "tier=derived \u2014 syft's resolution, not a committed claim";
const prov = (packages) => ({ packages, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false });
const pkg = (value, repo) => ({ type: 'package', value, where: `${repo}/sbom-syft.json`, tier: 'derived' });
const sbomPath = (reportsDir, batch, repo) => join(reportsDir, batch, repo, 'sbom-syft.json');
const purls = (...list) => JSON.stringify({ components: list.map((purl) => ({ purl })) });

function withReports(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'collectRepoSbom-'));
  try {
    fn(join(dir, 'reports'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSbom(reportsDir, batch, repo, text) {
  const path = sbomPath(reportsDir, batch, repo);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}

const absent = (repo) => ({
  repo,
  observables: [],
  unknown: true,
  unknownReason: 'absent',
  unknownDetail: `no sbom-syft.json for ${repo}`,
});

test('An empty reports directory reports the SBOM as absent', () => {
  withReports((reportsDir) => {
    mkdirSync(reportsDir, { recursive: true });
    assert.deepEqual(collectRepoSbom(reportsDir, 'myrepo'), absent('myrepo'));
  });
});

test('A missing reports directory reports the SBOM as absent', () => {
  withReports((reportsDir) => {
    assert.deepEqual(collectRepoSbom(reportsDir, 'myrepo'), absent('myrepo'));
  });
});

test('A reports path that is a file throws the directory listing error', () => {
  withReports((reportsDir) => {
    writeFileSync(reportsDir, 'x', 'utf8');
    assert.throws(() => collectRepoSbom(reportsDir, 'myrepo'), {
      name: 'Error',
      message: `ENOTDIR: not a directory, scandir '${reportsDir}'`,
    });
  });
});

test('A valid SBOM yields derived packages and counts a component without a purl as unnamed', () => {
  withReports((reportsDir) => {
    const text = JSON.stringify({
      components: [{ purl: 'pkg:npm/lodash@4.17.21' }, { purl: 'pkg:pypi/requests@2.31.0' }, { name: 'no-purl' }],
    });
    const path = writeSbom(reportsDir, '2024-01-01', 'myrepo', text);
    assert.deepEqual(collectRepoSbom(reportsDir, 'myrepo'), {
      repo: 'myrepo',
      path,
      observables: [pkg('lodash', 'myrepo'), pkg('requests', 'myrepo')],
      provenance: prov(2),
      byEcosystem: { npm: 1, pypi: 1 },
      unnamed: 1,
      excluded: 0,
      note: `${NOTE}; 1 component(s) carried no purl`,
    });
  });
});

test('Maven names join with a colon and an undeclared ecosystem is counted as excluded', () => {
  withReports((reportsDir) => {
    const text = purls('pkg:maven/com.example/lib@1.0.0', 'pkg:golang/github.com/foo/bar@v1.2.3', 'pkg:deb/debian/curl@7.88.1');
    const path = writeSbom(reportsDir, '2024-06-15', 'svc', text);
    assert.deepEqual(collectRepoSbom(reportsDir, 'svc'), {
      repo: 'svc',
      path,
      observables: [pkg('com.example:lib', 'svc'), pkg('github.com/foo/bar', 'svc')],
      provenance: prov(2),
      byEcosystem: { maven: 1, golang: 1 },
      unnamed: 0,
      excluded: 1,
      note: NOTE,
    });
  });
});

test('An SBOM path that cannot be read reports the error code as not-permitted', () => {
  withReports((reportsDir) => {
    const path = sbomPath(reportsDir, '2024-02-01', 'locked');
    mkdirSync(path, { recursive: true });
    assert.deepEqual(collectRepoSbom(reportsDir, 'locked'), {
      repo: 'locked',
      observables: [],
      unknown: true,
      unknownReason: 'not-permitted',
      unknownDetail: `${path}: EISDIR`,
    });
  });
});

test('A JSON document without components is reported as unstated', () => {
  withReports((reportsDir) => {
    writeSbom(reportsDir, '2024-03-01', 'empty', JSON.stringify({ spec: '1.4' }));
    assert.deepEqual(collectRepoSbom(reportsDir, 'empty'), {
      repo: 'empty',
      observables: [],
      unknown: true,
      unknownReason: 'unstated',
      unknownDetail: 'empty/sbom-syft.json: no components[] \u2014 not a CycloneDX document this reader knows',
    });
  });
});

test('Invalid JSON is reported as unparseable with the parser message', () => {
  withReports((reportsDir) => {
    const text = '{not valid json';
    writeSbom(reportsDir, '2024-04-01', 'badjson', text);
    let message = '';
    try { JSON.parse(text); } catch (e) { message = e.message; }
    assert.deepEqual(collectRepoSbom(reportsDir, 'badjson'), {
      repo: 'badjson',
      observables: [],
      unknown: true,
      unknownReason: 'unparseable',
      unknownDetail: `badjson/sbom-syft.json: ${message}`,
    });
  });
});

test('The last batch in sorted order wins when several hold the repo', () => {
  withReports((reportsDir) => {
    writeSbom(reportsDir, '2024-01-01', 'multi', purls('pkg:npm/old@1.0.0'));
    const path = writeSbom(reportsDir, '2024-05-01', 'multi', purls('pkg:npm/new@2.0.0'));
    assert.deepEqual(collectRepoSbom(reportsDir, 'multi'), {
      repo: 'multi',
      path,
      observables: [pkg('new', 'multi')],
      provenance: prov(1),
      byEcosystem: { npm: 1 },
      unnamed: 0,
      excluded: 0,
      note: NOTE,
    });
  });
});

test('An artifacts list is read from the only batch that holds the repo', () => {
  withReports((reportsDir) => {
    const text = JSON.stringify({ artifacts: [{ purl: 'pkg:cargo/serde@1.0.0' }] });
    const path = writeSbom(reportsDir, '2024-01-01', 'solo', text);
    writeSbom(reportsDir, '2024-02-01', 'other', purls('pkg:npm/later@1.0.0'));
    assert.deepEqual(collectRepoSbom(reportsDir, 'solo'), {
      repo: 'solo',
      path,
      observables: [pkg('serde', 'solo')],
      provenance: prov(1),
      byEcosystem: { cargo: 1 },
      unnamed: 0,
      excluded: 0,
      note: NOTE,
    });
  });
});
