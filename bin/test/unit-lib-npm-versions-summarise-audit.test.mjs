// Summarises npm audit JSON into sorted rows with fix states and severity counts (bin/lib/npm-versions.mjs summariseAudit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseAudit } from '../lib/npm-versions.mjs';

test('returns an error when audit is not an object', () => {
  assert.deepEqual(summariseAudit(null), { error: "npm audit printed no JSON" });
});

test('returns an error when audit has an error field', () => {
  assert.deepEqual(summariseAudit({ error: { summary: 'boom' } }), { error: "npm audit failed: boom" });
});

test('returns an error when vulnerabilities is missing', () => {
  assert.deepEqual(summariseAudit({}), { error: "npm audit JSON has no vulnerabilities map (npm 6 format is not read)" });
});

test('returns an error when vulnerabilities is not an object', () => {
  assert.deepEqual(summariseAudit({ vulnerabilities: 'nope' }), { error: "npm audit JSON has no vulnerabilities map (npm 6 format is not read)" });
});

test('computes rows with fix states, counts, and prod counts for a mixed audit', () => {
  const lock = { packages: { 'node_modules/braces': { version: '1.0.0', dev: false } } };
  const audit = {
    vulnerabilities: {
      braces: { name: 'braces', severity: 'high', isDirect: true, nodes: ['braces'], via: [], fixAvailable: { name: 'braces', version: '3.0.0', isSemVerMajor: true } },
      'left-pad': { name: 'left-pad', severity: 'low', isDirect: false, nodes: ['left-pad'], via: ['braces'], fixAvailable: true },
    },
  };
  assert.deepEqual(summariseAudit(audit, lock, () => ['1.0.0', '2.0.0', '3.0.0']), { rows: [{ name: "braces", severity: "high", direct: true, exposure: "unknown", via: [], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: "braces@3.0.0", downgrade: false, major: true }, through: [] } }, { name: "left-pad", severity: "low", direct: false, exposure: "unknown", via: ["braces"], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: null, downgrade: false, major: false }, through: ["braces"] } }], counts: { info: 0, low: 1, moderate: 0, high: 1, critical: 0 }, prod: { info: 0, low: 1, moderate: 0, high: 1, critical: 0 } });
});

test('resolves via chains to the best fix state among dependencies', () => {
  const lock = { packages: { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '1.0.0' } } };
  const audit = {
    vulnerabilities: {
      a: { name: 'a', severity: 'moderate', isDirect: true, nodes: ['a'], via: [], fixAvailable: { name: 'a', version: '2.0.0' } },
      b: { name: 'b', severity: 'moderate', isDirect: true, nodes: ['b'], via: ['a'], fixAvailable: { name: 'b', version: '2.0.0' } },
    },
  };
  assert.deepEqual(summariseAudit(audit, lock, () => ['1.0.0', '2.0.0']), { rows: [{ name: "a", severity: "moderate", direct: true, exposure: "unknown", via: [], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: "a@2.0.0", downgrade: false, major: false }, through: [] } }, { name: "b", severity: "moderate", direct: true, exposure: "unknown", via: ["a"], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: "b@2.0.0", downgrade: false, major: false }, through: ["a"] } }], counts: { info: 0, low: 0, moderate: 2, high: 0, critical: 0 }, prod: { info: 0, low: 0, moderate: 2, high: 0, critical: 0 } });
});

test('sorts rows by severity descending then name ascending', () => {
  const lock = { packages: {} };
  const audit = {
    vulnerabilities: {
      zeta: { name: 'zeta', severity: 'low', isDirect: true, nodes: ['zeta'], via: [], fixAvailable: true },
      alpha: { name: 'alpha', severity: 'high', isDirect: true, nodes: ['alpha'], via: [], fixAvailable: true },
      beta: { name: 'beta', severity: 'low', isDirect: true, nodes: ['beta'], via: [], fixAvailable: true },
    },
  };
  assert.deepEqual(summariseAudit(audit, lock, () => null), { rows: [{ name: "alpha", severity: "high", direct: true, exposure: "unknown", via: [], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: null, downgrade: false, major: false }, through: [] } }, { name: "beta", severity: "low", direct: true, exposure: "unknown", via: [], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: null, downgrade: false, major: false }, through: [] } }, { name: "zeta", severity: "low", direct: true, exposure: "unknown", via: [], advisories: [], fix: { state: "undetermined", to: null, proposal: { to: null, downgrade: false, major: false }, through: [] } }], counts: { info: 0, low: 2, moderate: 0, high: 1, critical: 0 }, prod: { info: 0, low: 2, moderate: 0, high: 1, critical: 0 } });
});

test('marks a row unpatched when no registry version clears the advisory range', () => {
  const lock = { packages: { 'node_modules/braces': { version: '1.0.0', dev: false } } };
  const audit = {
    vulnerabilities: {
      braces: { name: 'braces', severity: 'high', isDirect: true, nodes: ['braces'], via: [{ title: 'braces vuln', url: 'https://example.com', range: '<2.0.0' }], fixAvailable: { name: 'braces', version: '1.5.0' } },
    },
  };
  assert.deepEqual(summariseAudit(audit, lock, () => ['1.0.0', '1.5.0']), { rows: [{ name: "braces", severity: "high", direct: true, exposure: "unknown", via: [], advisories: [{ title: "braces vuln", url: "https://example.com", range: "<2.0.0", severity: "high" }], fix: { state: "unpatched", to: null, proposal: { to: "braces@1.5.0", downgrade: false, major: false } } }], counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }, prod: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } });
});
