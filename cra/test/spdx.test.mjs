// cra/test/spdx.test.mjs — SPDX 2.3 projection of a CycloneDX SBOM: same component set,
// deterministic bytes, caveats carried, and refusal for anything that is not CycloneDX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cdxToSpdx, SpdxInputError } from '../spdx.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'spdx.mjs');
const AT = '2026-01-02T03:04:05.678Z';
const cdx = () => ({
  bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: {
    timestamp: AT,
    component: { type: 'application', name: 'example-product', version: '1.2.0', 'bom-ref': 'product:example' },
    properties: [{ name: 'commitwork:provenance-caveat', value: 'unverified, not verified-clean' }],
  },
  components: [
    { name: 'zeta', version: '2.0.0', purl: 'pkg:npm/zeta@2.0.0', 'bom-ref': 'z',
      licenses: [{ license: { id: 'MIT' } }], hashes: [{ alg: 'SHA-256', content: 'ABCD' }],
      properties: [{ name: 'commitwork:repo', value: 'example-repo' }, { name: 'syft:package:type', value: 'npm' }] },
    { name: 'alpha', version: '1.0.0', purl: 'pkg:npm/alpha@1.0.0', 'bom-ref': 'a',
      licenses: [{ expression: 'Apache-2.0 OR MIT' }], cpe: 'cpe:2.3:a:example:alpha:1.0.0:*:*:*:*:*:*:*' },
    { group: 'org.example', name: 'lib', version: '3.1', licenses: [{ license: { name: 'Custom licence' } }] },
  ],
  dependencies: [{ ref: 'z', dependsOn: ['a'] }],
});

test('every CycloneDX component becomes one SPDX package; the product is described and contains them', () => {
  const doc = cdxToSpdx(cdx());
  assert.equal(doc.spdxVersion, 'SPDX-2.3');
  assert.equal(doc.dataLicense, 'CC0-1.0');
  assert.equal(doc.SPDXID, 'SPDXRef-DOCUMENT');
  assert.equal(doc.name, 'example-product-1.2.0');
  const comps = doc.packages.filter((p) => p.SPDXID.startsWith('SPDXRef-Package-'));
  assert.deepEqual(comps.map((p) => p.name).sort(), ['alpha', 'org.example/lib', 'zeta']);
  const product = doc.packages.find((p) => p.SPDXID.startsWith('SPDXRef-Product-'));
  assert.equal(product.name, 'example-product');
  assert.ok(doc.relationships.some((r) => r.spdxElementId === 'SPDXRef-DOCUMENT' && r.relationshipType === 'DESCRIBES' && r.relatedSpdxElement === product.SPDXID));
  assert.equal(doc.relationships.filter((r) => r.relationshipType === 'CONTAINS').length, 3);
  const zeta = comps.find((p) => p.name === 'zeta');
  const alpha = comps.find((p) => p.name === 'alpha');
  assert.ok(doc.relationships.some((r) => r.spdxElementId === zeta.SPDXID && r.relationshipType === 'DEPENDS_ON' && r.relatedSpdxElement === alpha.SPDXID));
  assert.deepEqual(zeta.externalRefs, [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:npm/zeta@2.0.0' }]);
  assert.deepEqual(zeta.checksums, [{ algorithm: 'SHA256', checksumValue: 'abcd' }]);
  assert.equal(zeta.licenseDeclared, 'MIT');
  assert.equal(zeta.comment, 'commitwork:repo=example-repo');
  assert.equal(alpha.licenseDeclared, 'Apache-2.0 OR MIT');
  assert.ok(alpha.externalRefs.some((r) => r.referenceType === 'cpe23Type'));
  assert.equal(comps.find((p) => p.name === 'org.example/lib').licenseDeclared, 'NOASSERTION', 'a name-only licence is not given an invented id');
  for (const p of doc.packages) {
    for (const k of ['downloadLocation', 'licenseConcluded', 'copyrightText']) assert.ok(p[k], `${p.name} lacks ${k}`);
    assert.match(p.SPDXID, /^SPDXRef-[A-Za-z0-9.-]+$/);
  }
});

test('created comes from the CycloneDX timestamp, then CW_NOW; SPDX time has no fractional seconds', () => {
  assert.equal(cdxToSpdx(cdx()).creationInfo.created, '2026-01-02T03:04:05Z');
  const noTs = cdx(); delete noTs.metadata.timestamp;
  assert.equal(cdxToSpdx(noTs, { env: { CW_NOW: '2026-05-06T07:08:09Z' } }).creationInfo.created, '2026-05-06T07:08:09Z');
});

test('deterministic: input order does not change the bytes, and the namespace follows content', () => {
  const a = cdx();
  const b = cdx(); b.components.reverse();
  assert.equal(JSON.stringify(cdxToSpdx(a)), JSON.stringify(cdxToSpdx(b)));
  const c = cdx(); c.components[0].version = '2.0.1'; c.components[0].purl = 'pkg:npm/zeta@2.0.1';
  assert.notEqual(cdxToSpdx(a).documentNamespace, cdxToSpdx(c).documentNamespace);
  const later = cdx(); later.metadata.timestamp = '2027-01-01T00:00:00Z';
  assert.equal(cdxToSpdx(a).documentNamespace, cdxToSpdx(later).documentNamespace, 'the namespace is content, not time');
});

test('duplicate components collapse to one package, never a repeated SPDXID', () => {
  const d = cdx(); d.components.push({ ...d.components[0] });
  const ids = cdxToSpdx(d).packages.map((p) => p.SPDXID);
  assert.equal(new Set(ids).size, ids.length);
});

test('document-level commitwork caveats survive the conversion', () => {
  assert.match(cdxToSpdx(cdx()).comment, /commitwork:provenance-caveat=unverified, not verified-clean/);
});

test('a document with no product component describes each package; zero components is a valid document', () => {
  const d = cdx(); delete d.metadata.component;
  const doc = cdxToSpdx(d);
  assert.equal(doc.relationships.filter((r) => r.relationshipType === 'DESCRIBES').length, 3);
  const empty = cdxToSpdx({ bomFormat: 'CycloneDX', specVersion: '1.5', metadata: { timestamp: AT } });
  assert.deepEqual(empty.packages, []);
});

test('anything that is not a CycloneDX document is refused', () => {
  for (const bad of [null, {}, { components: [] }, { bomFormat: 'CycloneDX', components: {} },
    { bomFormat: 'CycloneDX', components: [{ version: '1' }] }]) {
    assert.throws(() => cdxToSpdx(bad), SpdxInputError);
  }
});

test('CLI writes atomically, and refuses with exit 20 and no output for non-CycloneDX input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-spdx-'));
  try {
    const inp = join(dir, 'in.cdx.json');
    writeFileSync(inp, JSON.stringify(cdx()));
    const out = join(dir, 'o', 'out.spdx.json');
    const r = spawnSync(process.execPath, [CLI, inp, '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).spdxVersion, 'SPDX-2.3');
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    const refused = join(dir, 'o', 'refused.spdx.json');
    const r2 = spawnSync(process.execPath, [CLI, bad, '--out', refused], { encoding: 'utf8' });
    assert.equal(r2.status, 20);
    assert.equal(existsSync(refused), false);
    assert.equal(spawnSync(process.execPath, [CLI, join(dir, 'missing.json')], { encoding: 'utf8' }).status, 20);
    assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
