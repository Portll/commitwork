// Converts a CycloneDX BOM into an SPDX 2.3 document (cra/spdx.mjs cdxToSpdx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cdxToSpdx } from '../spdx.mjs';

const T = '2024-01-02T03:04:05.678Z';
const NS = 'https://commitwork.online/spdxdocs/';
const bom = (extra) => ({ bomFormat: 'CycloneDX', ...extra });
const rel = (a, type, b) => ({ spdxElementId: a, relationshipType: type, relatedSpdxElement: b });
const BASE = { supplier: 'NOASSERTION', downloadLocation: 'NOASSERTION', filesAnalyzed: false,
  licenseConcluded: 'NOASSERTION', licenseDeclared: 'NOASSERTION', copyrightText: 'NOASSERTION' };
const DOC = { spdxVersion: 'SPDX-2.3', dataLicense: 'CC0-1.0', SPDXID: 'SPDXRef-DOCUMENT' };
const checkNs = (r, name) => {
  assert.equal(r.documentNamespace.slice(0, NS.length + name.length + 1), `${NS}${name}-`);
  assert.equal(r.documentNamespace.length, NS.length + name.length + 33);
};
const idShape = (id) => [id.slice(0, 16), id.length];

test('input that is not a CycloneDX object is rejected', () => {
  const err = { name: 'SpdxInputError', message: 'not convertible to SPDX: bomFormat is not CycloneDX' };
  assert.throws(() => cdxToSpdx(null), err);
  assert.throws(() => cdxToSpdx('CycloneDX'), err);
  assert.throws(() => cdxToSpdx({ bomFormat: 'SPDX' }), err);
  assert.throws(() => cdxToSpdx(Object.assign(() => {}, { bomFormat: 'CycloneDX' })), err);
});

test('missing or empty components give an empty document stamped with the created option', () => {
  const err = { name: 'SpdxInputError', message: 'not convertible to SPDX: components is not an array' };
  assert.throws(() => cdxToSpdx(bom({ components: {} })), err);
  assert.throws(() => cdxToSpdx(bom({ components: null })), err);
  const metadata = { timestamp: '2020-01-01T00:00:00.999Z' };
  const r = cdxToSpdx(bom({ metadata }), { created: '2024-01-02T05:04:05.500+02:00', env: {} });
  assert.deepEqual(r, {
    ...DOC, name: 'sbom', documentNamespace: r.documentNamespace,
    creationInfo: { created: '2024-01-02T03:04:05Z', creators: ['Tool: commitwork'] },
    packages: [], relationships: [],
  });
  checkNs(r, 'sbom');
  assert.deepEqual(cdxToSpdx(bom({ metadata, components: [] }), { created: T, env: {} }), r);
});

test('a component that is null, not an object or nameless is rejected with its index', () => {
  const err = (i) => ({ name: 'SpdxInputError', message: `not convertible to SPDX: component ${i} has no name` });
  assert.throws(() => cdxToSpdx(bom({ components: [{ name: 'a' }, null] })), err(1));
  assert.throws(() => cdxToSpdx(bom({ components: [function named() {}] })), err(0));
  assert.throws(() => cdxToSpdx(bom({ components: ['str'] })), err(0));
  assert.throws(() => cdxToSpdx(bom({ components: [{ name: 'a' }, { name: 'b' }, { name: '' }] })), err(2));
});

test('a component maps to a package with download location, sorted checksums, refs, licences and notes', () => {
  const comp = {
    group: 'acme', name: 'lib', version: '2.0.0', supplier: { name: 'Acme' },
    purl: 'pkg:npm/acme/lib@2.0.0', cpe: 'cpe:2.3:a:acme:lib:2.0.0',
    externalReferences: [null, { type: 'distribution' }, { type: 'website', url: 'https://w.example' },
      { type: 'distribution', url: 'https://d.example/lib.tgz' }, { type: 'distribution', url: 'https://e.example' }],
    hashes: [null, { alg: 'SHA-256', content: 'ABCD' }, { alg: 'SHA-1' }, { alg: 'SHA-999', content: '00' }, { alg: 'MD5', content: 'EF01' }],
    properties: [null, { name: 'commitwork:z', value: '1' }, { value: 'v' }, { name: 'npm:x', value: '2' }, { name: 'commitwork:a', value: '3' }],
    licenses: [{ expression: 'MIT' }, { expression: 'A OR B' }],
  };
  const metadata = { timestamp: '2023-05-06T07:08:09.123Z',
    properties: [null, { name: 'commitwork:provenance', value: 'unenriched' }, { name: 'x', value: 'y' }, { name: 'commitwork:a', value: '1' }] };
  const r = cdxToSpdx(bom({ metadata, components: [comp] }), { env: {} });
  const id = r.packages[0].SPDXID;
  assert.deepEqual(idShape(id), ['SPDXRef-Package-', 32]);
  assert.deepEqual(r, {
    ...DOC, name: 'sbom', documentNamespace: r.documentNamespace,
    creationInfo: { created: '2023-05-06T07:08:09Z', creators: ['Tool: commitwork'] },
    packages: [{
      ...BASE, SPDXID: id, name: 'acme/lib', versionInfo: '2.0.0', supplier: 'Organization: Acme',
      downloadLocation: 'https://d.example/lib.tgz', licenseDeclared: 'MIT AND (A OR B)',
      checksums: [{ algorithm: 'MD5', checksumValue: 'ef01' }, { algorithm: 'SHA256', checksumValue: 'abcd' }],
      externalRefs: [
        { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:npm/acme/lib@2.0.0' },
        { referenceCategory: 'SECURITY', referenceType: 'cpe23Type', referenceLocator: 'cpe:2.3:a:acme:lib:2.0.0' },
      ],
      comment: 'commitwork:a=3\ncommitwork:z=1',
    }],
    relationships: [rel('SPDXRef-DOCUMENT', 'DESCRIBES', id)],
    comment: 'commitwork:provenance=unenriched\ncommitwork:a=1',
  });
  checkNs(r, 'sbom');
});

test('without a named root the document describes every package, in key order', () => {
  const r = cdxToSpdx(bom({ metadata: { component: { version: '9' } }, components: [
    { name: 'y', version: '1', licenses: [{ license: { name: 'Custom' } }] }, { name: 'x', licenses: [{ expression: 'MIT OR ISC' }] }] }), { created: T });
  const [x, y] = r.packages.map((p) => p.SPDXID);
  assert.deepEqual(r.packages, [{ ...BASE, SPDXID: x, name: 'x', licenseDeclared: 'MIT OR ISC' }, { ...BASE, SPDXID: y, name: 'y', versionInfo: '1' }]);
  assert.deepEqual(r.relationships, [rel('SPDXRef-DOCUMENT', 'DESCRIBES', x), rel('SPDXRef-DOCUMENT', 'DESCRIBES', y)]);
  assert.equal(r.name, 'sbom');
});

test('components sharing a key collapse to the one with the smaller serialised body in any input order', () => {
  const lo = { name: 'dup', version: '1', supplier: { name: 'A' } };
  const hi = { name: 'dup', version: '1', supplier: { name: 'B' } };
  for (const components of [[lo, hi], [hi, lo], [lo, { ...lo }]]) {
    const r = cdxToSpdx(bom({ components }), { created: T });
    assert.deepEqual(r.packages.map((p) => [p.name, p.versionInfo, p.supplier]), [['dup', '1', 'Organization: A']]);
    assert.deepEqual(r.relationships, [rel('SPDXRef-DOCUMENT', 'DESCRIBES', r.packages[0].SPDXID)]);
  }
  const o = { name: 'o', purl: 'pkg:npm/q@1' };
  const p = { name: 'p', purl: 'pkg:npm/q@1' };
  const ref = { referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: 'pkg:npm/q@1' };
  for (const components of [[o, p], [p, o]]) {
    const r = cdxToSpdx(bom({ components }), { created: T });
    assert.deepEqual(r.packages.map((x) => [x.name, x.externalRefs]), [['o', [ref]]]);
  }
});

test('a named root contains every component and carries sorted, deduplicated dependencies', () => {
  const r = cdxToSpdx(bom({
    metadata: { component: { name: 'app', version: '3', 'bom-ref': 'app' } },
    components: [{ name: 'b', 'bom-ref': 'rb' }, { name: 'a', 'bom-ref': 'ra' }],
    dependencies: [null, { ref: 'app', dependsOn: ['ra', 'missing', 'app', 'ra'] },
      { ref: 'nope', dependsOn: ['ra'] }, { ref: 'ra', dependsOn: ['rb'] }, { ref: 'rb' }],
  }), { created: T });
  const [root, a, b] = r.packages.map((p) => p.SPDXID);
  assert.deepEqual([root, a, b].map(idShape), [['SPDXRef-Product-', 32], ['SPDXRef-Package-', 32], ['SPDXRef-Package-', 32]]);
  assert.deepEqual(r.packages, [
    { ...BASE, SPDXID: root, name: 'app', versionInfo: '3' },
    { ...BASE, SPDXID: a, name: 'a' },
    { ...BASE, SPDXID: b, name: 'b' },
  ]);
  assert.deepEqual(r.relationships, [
    rel('SPDXRef-DOCUMENT', 'DESCRIBES', root),
    rel(root, 'CONTAINS', a),
    rel(root, 'CONTAINS', b),
    rel(a, 'DEPENDS_ON', b),
    rel(root, 'DEPENDS_ON', a),
  ]);
  assert.equal(r.name, 'app-3');
  checkNs(r, 'app-3');
});

test('a lone unversioned root names the document after itself and contains nothing', () => {
  const r = cdxToSpdx(bom({ metadata: { component: { group: 'g', name: 'my app' } } }), { created: T });
  const id = r.packages[0].SPDXID;
  assert.deepEqual(idShape(id), ['SPDXRef-Product-', 32]);
  assert.deepEqual(r.packages, [{ ...BASE, SPDXID: id, name: 'g/my app' }]);
  assert.deepEqual(r.relationships, [rel('SPDXRef-DOCUMENT', 'DESCRIBES', id)]);
  assert.equal(r.name, 'my app');
  checkNs(r, 'my%20app');
});
