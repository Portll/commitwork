// Computes which dependencies changed provenance between two dependency slices (monitor/dep-provenance.mjs diffProvenance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffProvenance } from '../dep-provenance.mjs';

test('returns disabled shape when CW_DEP_PROVENANCE is off', () => {
  process.env.CW_DEP_PROVENANCE = 'off';
  const r = diffProvenance({ a: { resolution: 'registry', target: 'a' } }, { a: { resolution: 'git', target: 'https://github.com/x/y' } });
  process.env.CW_DEP_PROVENANCE = '';
  assert.deepEqual(r, { moved: [], enabled: false, compared: 0, note: "" });
});

test('counts compared entries and skips unknown resolutions', () => {
  const before = { a: { resolution: 'registry', target: 'a' }, b: { resolution: 'unknown', target: 'b' } };
  const after = { a: { resolution: 'git', target: 'https://github.com/x/y' }, b: { resolution: 'registry', target: 'b' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [{ package: "a", kind: "resolution", from: "registry", to: "git", fromTarget: "a", toTarget: "https://github.com/x/y", offRegistry: true }], enabled: true, compared: 2, offRegistry: 1, targetDrift: 0, note: "1 dependency(ies) moved OFF a package registry since the previous slice. A registry advisory cannot describe a package the registry no longer serves, and a registry revocation cannot reach it \u2014 so this is the event that makes a malicious-package advisory stop applying. Verify the new source is the one you intended." });
});

test('detects target drift for same-class git pins with different identities', () => {
  const before = { a: { resolution: 'git', target: 'https://github.com/org1/repo' } };
  const after = { a: { resolution: 'git', target: 'https://github.com/org2/repo' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [{ package: "a", kind: "target-drift", from: "git", to: "git", fromTarget: "https://github.com/org1/repo", toTarget: "https://github.com/org2/repo", fromIdentity: "github.com/org1", toIdentity: "github.com/org2", offRegistry: false }], enabled: true, compared: 1, offRegistry: 0, targetDrift: 1, note: "1 dependency(ies) kept their resolution class and changed WHERE they resolve from (host, or owning org for git pins). A re-pointed pin is the one-PR supply-chain move this comparison exists to catch \u2014 verify the new source." });
});

test('does not report target drift when identities are equal', () => {
  const before = { a: { resolution: 'git', target: 'https://github.com/org1/repo' } };
  const after = { a: { resolution: 'git', target: 'https://github.com/org1/repo' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [], enabled: true, compared: 1, offRegistry: 0, targetDrift: 0, note: "" });
});

test('reports resolution change from registry to git as offRegistry', () => {
  const before = { a: { resolution: 'registry', target: 'a' } };
  const after = { a: { resolution: 'git', target: 'https://github.com/x/y' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [{ package: "a", kind: "resolution", from: "registry", to: "git", fromTarget: "a", toTarget: "https://github.com/x/y", offRegistry: true }], enabled: true, compared: 1, offRegistry: 1, targetDrift: 0, note: "1 dependency(ies) moved OFF a package registry since the previous slice. A registry advisory cannot describe a package the registry no longer serves, and a registry revocation cannot reach it \u2014 so this is the event that makes a malicious-package advisory stop applying. Verify the new source is the one you intended." });
});

test('reports resolution change from git to registry as not offRegistry', () => {
  const before = { a: { resolution: 'git', target: 'https://github.com/x/y' } };
  const after = { a: { resolution: 'registry', target: 'a' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [{ package: "a", kind: "resolution", from: "git", to: "registry", fromTarget: "https://github.com/x/y", toTarget: "a", offRegistry: false }], enabled: true, compared: 1, offRegistry: 0, targetDrift: 0, note: "" });
});

test('skips file resolution for same-class comparison', () => {
  const before = { a: { resolution: 'file', target: './local' } };
  const after = { a: { resolution: 'file', target: './other' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [], enabled: true, compared: 1, offRegistry: 0, targetDrift: 0, note: "" });
});

test('sorts moved entries with offRegistry first then by package name', () => {
  const before = { b: { resolution: 'registry', target: 'b' }, a: { resolution: 'registry', target: 'a' } };
  const after = { b: { resolution: 'git', target: 'https://github.com/x/y' }, a: { resolution: 'git', target: 'https://github.com/z/w' } };
  const r = diffProvenance(before, after);
  assert.deepEqual(r, { moved: [{ package: "a", kind: "resolution", from: "registry", to: "git", fromTarget: "a", toTarget: "https://github.com/z/w", offRegistry: true }, { package: "b", kind: "resolution", from: "registry", to: "git", fromTarget: "b", toTarget: "https://github.com/x/y", offRegistry: true }], enabled: true, compared: 2, offRegistry: 2, targetDrift: 0, note: "2 dependency(ies) moved OFF a package registry since the previous slice. A registry advisory cannot describe a package the registry no longer serves, and a registry revocation cannot reach it \u2014 so this is the event that makes a malicious-package advisory stop applying. Verify the new source is the one you intended." });
});
