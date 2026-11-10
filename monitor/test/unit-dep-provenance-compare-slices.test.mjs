// Compares two dep-provenance slice inventories and reports resolution changes (monitor/dep-provenance.mjs compareSlices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSlices } from '../dep-provenance.mjs';

test('returns not-run when current inventory is missing', () => {
  const r = compareSlices('/prev', '/cur', () => { throw new Error('no file'); });
  assert.deepEqual(r, { unknown: true, unknownReason: "not-run", moved: [], offRegistry: 0, detail: "no dep-provenance inventory in this slice \u2014 the check did not run for this repo" });
});

test('returns not-run when current inventory has ran false', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: false, packages: {} };
    return { ran: true, packages: {} };
  });
  assert.deepEqual(r, { unknown: true, unknownReason: "not-run", moved: [], offRegistry: 0, detail: "no dep-provenance inventory in this slice \u2014 the check did not run for this repo" });
});

test('returns no-reference when previous inventory is missing', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: true, packages: { a: { resolution: 'registry', target: 'a' } } };
    return null;
  });
  assert.deepEqual(r, { unknown: true, unknownReason: "no-reference", moved: [], offRegistry: 0, detail: "the previous slice has no inventory for this repo, so there is nothing to compare against", inventoried: 1 });
});

test('returns no-reference when previous inventory has ran false', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: true, packages: { a: { resolution: 'registry', target: 'a' } } };
    return { ran: false, packages: {} };
  });
  assert.deepEqual(r, { unknown: true, unknownReason: "no-reference", moved: [], offRegistry: 0, detail: "the previous slice has no inventory for this repo, so there is nothing to compare against", inventoried: 1 });
});

test('returns diff result when both inventories are present', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: true, packages: { a: { resolution: 'registry', target: 'a' } } };
    return { ran: true, packages: { a: { resolution: 'registry', target: 'a' } } };
  });
  assert.deepEqual(r, { moved: [], enabled: true, compared: 1, offRegistry: 0, targetDrift: 0, note: "", inventoried: 1 });
});

test('detects off-registry move when resolution changes from registry to git', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: true, packages: { a: { resolution: 'git', target: 'https://github.com/b/repo' } } };
    return { ran: true, packages: { a: { resolution: 'registry', target: 'a' } } };
  });
  assert.deepEqual(r, { moved: [{ package: "a", kind: "resolution", from: "registry", to: "git", fromTarget: "a", toTarget: "https://github.com/b/repo", offRegistry: true }], enabled: true, compared: 1, offRegistry: 1, targetDrift: 0, note: "1 dependency(ies) moved OFF a package registry since the previous slice. A registry advisory cannot describe a package the registry no longer serves, and a registry revocation cannot reach it \u2014 so this is the event that makes a malicious-package advisory stop applying. Verify the new source is the one you intended.", inventoried: 1 });
});

test('detects target drift when git host changes within same resolution class', () => {
  const r = compareSlices('/prev', '/cur', (p) => {
    if (p.endsWith('/cur/dep-provenance.json')) return { ran: true, packages: { a: { resolution: 'git', target: 'https://github.com/b/repo' } } };
    return { ran: true, packages: { a: { resolution: 'git', target: 'https://github.com/a/repo' } } };
  });
  assert.deepEqual(r, { moved: [{ package: "a", kind: "target-drift", from: "git", to: "git", fromTarget: "https://github.com/a/repo", toTarget: "https://github.com/b/repo", fromIdentity: "github.com/a", toIdentity: "github.com/b", offRegistry: false }], enabled: true, compared: 1, offRegistry: 0, targetDrift: 1, note: "1 dependency(ies) kept their resolution class and changed WHERE they resolve from (host, or owning org for git pins). A re-pointed pin is the one-PR supply-chain move this comparison exists to catch \u2014 verify the new source.", inventoried: 1 });
});

test('returns not-run when current dir is null', () => {
  const r = compareSlices('/prev', null, () => { throw new Error('no file'); });
  assert.deepEqual(r, { unknown: true, unknownReason: "not-run", moved: [], offRegistry: 0, detail: "no dep-provenance inventory in this slice \u2014 the check did not run for this repo" });
});
