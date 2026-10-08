import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrich, indexNative, purlWithQualifier } from '../sbom-provenance.mjs';

afterEach(() => { delete process.env.CW_SBOM_PROVENANCE; });

// Shapes verbatim from syft 1.51.0 over firebase/firebase-js-sdk's yarn.lock.
const native = () => ({ artifacts: [
  { name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0',
    metadata: { resolved: 'git+https://github.com/google/closure-net.git#6f48f578d3e80fe7a85e530a5d95b9351433d135' } },
  { name: 'rimraf', version: '2.7.1', purl: 'pkg:npm/rimraf@2.7.1',
    metadata: { resolved: 'https://registry.npmjs.org/rimraf/-/rimraf-2.7.1.tgz#35797f1' } },
] });

const cdx = () => ({ bomFormat: 'CycloneDX', components: [
  { type: 'library', name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0',
    properties: [{ name: 'syft:package:type', value: 'npm' }] },
  { type: 'library', name: 'rimraf', version: '2.7.1', purl: 'pkg:npm/rimraf@2.7.1' },
] });

describe('sbom-provenance — the purl must stop lying, not merely be annotated', () => {
  test('the measured case: a git-sourced component gains a vcs_url qualifier', () => {
    const { cdx: out, report } = enrich(cdx(), native());
    const c = out.components.find((x) => x.name === 'closure-net');
    assert.match(c.purl, /^pkg:npm\/closure-net@0\.0\.0\?vcs_url=/);
    assert.match(decodeURIComponent(c.purl.split('vcs_url=')[1]), /^git\+https:\/\/github\.com\/google\/closure-net\.git#6f48f578/);
    assert.equal(report.enriched, 1);
  });

  test('the corrected purl no longer collides with a registry package of the same name', () => {
    // cra/sbom.mjs dedupes components on purl, so the false identity was also the merge key: a
    // git checkout and a registry package sharing name@version collapsed into one row.
    const { cdx: out } = enrich(cdx(), native());
    const git = out.components.find((x) => x.name === 'closure-net');
    assert.notEqual(git.purl, 'pkg:npm/closure-net@0.0.0');
  });

  test('a CycloneDX consumer finds it where it looks — externalReferences type vcs', () => {
    const { cdx: out } = enrich(cdx(), native());
    const c = out.components.find((x) => x.name === 'closure-net');
    assert.equal(c.externalReferences.length, 1);
    assert.equal(c.externalReferences[0].type, 'vcs');
    assert.match(c.externalReferences[0].url, /^git\+https:\/\/github\.com\/google/);
    assert.ok(c.externalReferences[0].comment.length > 30, 'a correction with no reason is not evidence');
    assert.deepEqual(c.properties.find((p) => p.name === 'commitwork:resolution'), { name: 'commitwork:resolution', value: 'git' });
  });

  test('a REGISTRY component is left byte-identical — the bare purl already says it', () => {
    const before = JSON.stringify(cdx().components.find((c) => c.name === 'rimraf'));
    const { cdx: out } = enrich(cdx(), native());
    assert.equal(JSON.stringify(out.components.find((c) => c.name === 'rimraf')), before);
  });

  test('NO COMPONENT IS EVER DROPPED', () => {
    // An SBOM that omits a dependency is worse than one that misdescribes it: the omission is
    // invisible, and an inventory is judged on completeness first.
    const { cdx: out, report } = enrich(cdx(), native());
    assert.equal(out.components.length, 2);
    assert.equal(report.components, 2);
  });
});

describe('sbom-provenance — fail closed', () => {
  test('NO native document is `no-reference`, and says the SBOM is unenriched, not verified', () => {
    for (const n of [null, undefined, {}, { artifacts: [] }]) {
      const { cdx: out, report } = enrich(cdx(), n);
      assert.equal(report.ran, false);
      assert.equal(report.unknownReason, 'no-reference');
      assert.match(report.note, /NOT corrected|unenriched, not verified/);
      assert.equal(out.components[0].purl, 'pkg:npm/closure-net@0.0.0', 'unchanged, and unpublishable');
    }
  });

  test('a component syft did not record is counted as unmatched, never assumed registry', () => {
    const c = cdx();
    c.components.push({ type: 'library', name: 'ghost', version: '9.9.9', purl: 'pkg:npm/ghost@9.9.9' });
    const { report } = enrich(c, native());
    assert.equal(report.unmatched, 1);
    assert.equal(report.enriched, 1);
  });

  test('an UNKNOWN resolution is counted and asserts nothing', () => {
    const n = native();
    n.artifacts[0].metadata.resolved = 'something-nobody-parsed';
    const { cdx: out, report } = enrich(cdx(), n);
    assert.equal(report.byResolution.unknown, 1);
    assert.equal(report.enriched, 0);
    assert.equal(out.components[0].purl, 'pkg:npm/closure-net@0.0.0', 'our blind spot is not a provenance claim');
  });

  test('a bare archive is `distribution` with download_url, not vcs', () => {
    const n = native();
    n.artifacts[0].metadata.resolved = 'https://example.com/dist/closure-net-0.0.0.tgz';
    const { cdx: out } = enrich(cdx(), n);
    const c = out.components.find((x) => x.name === 'closure-net');
    assert.match(c.purl, /\?download_url=/);
    assert.equal(c.externalReferences[0].type, 'distribution');
  });

  test('the override disables enrichment and says so', () => {
    process.env.CW_SBOM_PROVENANCE = 'off';
    const { cdx: out, report } = enrich(cdx(), native());
    assert.equal(report.enabled, false);
    assert.equal(out.components[0].purl, 'pkg:npm/closure-net@0.0.0');
  });

  test('a malformed CycloneDX is tolerated', () => {
    assert.equal(enrich(null, native()).report.ran, false);
    assert.equal(enrich({}, native()).report.components, 0);
  });
});

describe('sbom-provenance — purl qualifiers are deterministic and non-destructive', () => {
  test('an existing qualifier is preserved and ordering is stable', () => {
    const p = purlWithQualifier('pkg:npm/x@1.0.0?arch=amd64', 'vcs_url', 'git+https://h/r.git#s');
    assert.match(p, /^pkg:npm\/x@1\.0\.0\?arch=amd64&vcs_url=/);
    assert.equal(purlWithQualifier(p, 'vcs_url', 'other'), p, 'a stated qualifier is never restated');
  });

  test('a subpath fragment survives', () => {
    assert.match(purlWithQualifier('pkg:npm/x@1.0.0#sub/dir', 'vcs_url', 'git+https://h/r.git'), /#sub\/dir$/);
  });

  test('the value is percent-encoded so the purl stays parseable', () => {
    const p = purlWithQualifier('pkg:npm/x@1.0.0', 'vcs_url', 'git+https://h/r.git#abc');
    assert.ok(!p.slice(p.indexOf('?')).includes('#'), 'a raw # would be read as the subpath separator');
    assert.equal(decodeURIComponent(p.split('vcs_url=')[1]), 'git+https://h/r.git#abc');
  });

  test('same input, byte-identical output', () => {
    const a = enrich(cdx(), native()); const b = enrich(cdx(), native());
    assert.equal(JSON.stringify(a.cdx), JSON.stringify(b.cdx));
  });

  test('running twice does not double-annotate', () => {
    const once = enrich(cdx(), native()).cdx;
    const twice = enrich(once, native()).cdx;
    const c = twice.components.find((x) => x.name === 'closure-net');
    assert.equal(c.externalReferences.length, 1);
    assert.equal(c.properties.filter((p) => p.name === 'commitwork:resolution').length, 1);
    assert.equal((c.purl.match(/vcs_url=/g) || []).length, 1);
  });

  test('indexNative skips artifacts with no resolution rather than recording an empty one', () => {
    const { byPurl } = indexNative({ artifacts: [{ name: 'x', version: '1', purl: 'pkg:npm/x@1', metadata: {} }] });
    assert.equal(byPurl.size, 0);
  });
});

describe('sbom-provenance — the schema has a slot for this, and it is evidence.identity', () => {
  // CycloneDX 1.5 added component.evidence.identity precisely so a tool can say HOW it concluded an
  // identity. Verified against bom-1.7.schema.json: field accepts "purl", technique accepts
  // "manifest-analysis", and only `field` is required. The defect was never a missing URL — it was
  // a purl concluded from a git resolution published indistinguishably from one concluded from a
  // registry, at an implied confidence of 1.0 nobody ever stated.
  test('the corrected purl is recorded as a CONCLUSION with the method that reached it', () => {
    const { cdx: out } = enrich(cdx(), native());
    const c = out.components.find((x) => x.name === 'closure-net');
    assert.equal(c.evidence.identity.length, 1);
    const id = c.evidence.identity[0];
    assert.equal(id.field, 'purl');
    assert.equal(id.concludedValue, c.purl, 'the conclusion recorded is the purl actually published');
    assert.equal(id.methods[0].technique, 'manifest-analysis');
    assert.match(id.methods[0].value, /^git\+https:\/\/github\.com\/google\/closure-net\.git#6f48f578/);
  });

  test('NO overall confidence is invented — the schema permits omitting it', () => {
    // A number made up here would be the unfounded precision the field exists to prevent.
    const { cdx: out } = enrich(cdx(), native());
    const id = out.components.find((x) => x.name === 'closure-net').evidence.identity[0];
    assert.equal(id.confidence, undefined);
    assert.equal(id.methods[0].confidence, 1, 'the METHOD is certain — we did read this from the lockfile');
  });

  test('a registry component gains no evidence block — nothing was concluded that needs support', () => {
    const { cdx: out } = enrich(cdx(), native());
    assert.equal(out.components.find((x) => x.name === 'rimraf').evidence, undefined);
  });

  test('an existing evidence block is preserved, and the 1.5 single-object form is normalised', () => {
    const c = cdx();
    c.components[0].evidence = { identity: { field: 'name', concludedValue: 'closure-net' } };
    const { cdx: out } = enrich(c, native());
    const ids = out.components[0].evidence.identity;
    assert.ok(Array.isArray(ids), '1.6 recommends arrays even for one object');
    assert.equal(ids.length, 2);
    assert.ok(ids.some((i) => i.field === 'name'), 'a prior conclusion is never overwritten');
  });

  test('running twice adds one identity, not two', () => {
    const once = enrich(cdx(), native()).cdx;
    const twice = enrich(once, native()).cdx;
    assert.equal(twice.components.find((x) => x.name === 'closure-net').evidence.identity.length, 1);
  });
});
