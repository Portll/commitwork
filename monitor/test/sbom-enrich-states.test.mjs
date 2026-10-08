// The enricher had one branch for three facts, and named only the first: 69 of 102 repos in the
// 2026-09-18 sweep recorded sbom-syft as `fail` with no reason, ~10 of them dependency-free and the
// rest carrying ecosystems syft records no resolution for. Each state now says what it is, and only
// the one with nothing to read keeps the non-zero exit.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enrich, isSyftNative } from '../sbom-provenance.mjs';
import { run, summaryLine } from '../../bin/sbom-enrich.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-enrich-'));
let n = 0;
const file = (doc) => { const p = join(T, `f${n++}.json`); writeFileSync(p, JSON.stringify(doc)); return p; };

const syft = (artifacts) => ({ artifacts, source: {}, descriptor: { name: 'syft', version: '1.51.1' }, schema: { version: '16.1.10' } });
const cdx = (components) => ({ bomFormat: 'CycloneDX', specVersion: '1.7', ...(components ? { components } : {}) });
const npmArtifact = { name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0', metadata: { resolved: 'git+ssh://git@github.com/x/closure-net.git#abc' } };
const goArtifact = { name: 'github.com/x/y', version: 'v1.2.3', purl: 'pkg:golang/github.com/x/y@v1.2.3', metadata: {} };

describe('the three states of an empty resolution index', () => {
  test('no native document at all stays no-reference, and the SBOM is not publishable', () => {
    for (const native of [null, undefined, {}, { artifacts: [] }]) {
      const { report } = enrich(cdx([{ name: 'a', purl: 'pkg:npm/a@1' }]), native);
      assert.equal(report.ran, false, 'a bare stub is not syft telling us anything');
      assert.equal(report.unknownReason, 'no-reference');
    }
  });

  test('a real syft document with nothing in it is "nothing to inventory", and publishable', () => {
    const { report } = enrich(cdx(null), syft([]));
    assert.equal(report.ran, true);
    assert.equal(report.artifacts, 0);
    assert.equal(report.unknown, undefined);
    assert.match(report.note, /nothing to inventory/);
    assert.match(summaryLine(report), /^sbom-enrich: NOTHING TO INVENTORY/);
  });

  test('artifacts syft recorded no resolution for are `unstated` — read, and not verified', () => {
    const { report } = enrich(cdx([{ name: 'y', purl: 'pkg:golang/github.com/x/y@v1.2.3' }]), syft([goArtifact, goArtifact]));
    assert.equal(report.ran, false, 'CRA must keep counting this repo unenriched');
    assert.equal(report.unknownReason, 'unstated');
    assert.equal(report.artifacts, 2);
    assert.deepEqual(report.byType, { golang: 2 });
    assert.match(report.note, /none carrying metadata\.resolved/);
    assert.doesNotMatch(report.note, /no syft native document/, 'the document WAS read; saying otherwise is what sent a reader looking for a missing file');
  });

  test('a resolution present is still enriched, unchanged', () => {
    const { cdx: out, report } = enrich(cdx([{ name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0' }]), syft([npmArtifact]));
    assert.equal(report.ran, true);
    assert.equal(report.enriched, 1);
    assert.match(out.components[0].purl, /vcs_url=/);
  });

  test('isSyftNative admits only a document that names itself', () => {
    assert.equal(isSyftNative(syft([])), true);
    assert.equal(isSyftNative({ artifacts: [] }), false);
    assert.equal(isSyftNative({ descriptor: { name: 'syft' } }), false, 'no artifacts array is not a syft inventory');
  });
});

describe('exit codes the lane reads', () => {
  const runFor = (cdxDoc, nativeDoc) => run(file(cdxDoc), file(nativeDoc), join(T, `r${n++}.json`));

  test('nothing to inventory and unstated both exit 0; no-reference does not', () => {
    assert.equal(runFor(cdx(null), syft([])).ok, true);
    assert.equal(runFor(cdx([{ name: 'y', purl: 'pkg:golang/x@v1' }]), syft([goArtifact])).ok, true);
    assert.equal(runFor(cdx([{ name: 'a', purl: 'pkg:npm/a@1' }]), { artifacts: [] }).ok, false);
  });

  test('the sidecar is written in every state — "ran and corrected nothing" must not look like "never ran"', () => {
    const p = join(T, 'sidecar.json');
    run(file(cdx(null)), file(syft([])), p);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(doc.ran, true);
    assert.match(doc.note, /nothing to inventory/);
  });

  test('the unstated line is the one the manifest coverage signal matches', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
    const check = manifest.checks.find((c) => c.id === 'sbom-syft');
    const { report } = enrich(cdx([{ name: 'y', purl: 'pkg:golang/x@v1' }]), syft([goArtifact]));
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper compiling a coverageSignals pattern from the bundled manifest
    const signal = (check.coverageSignals || []).find((s) => new RegExp(s.pattern, 'm').test(summaryLine(report)));
    assert.ok(signal, 'the lane declares no signal matching the line the enricher actually prints');
  });
});
