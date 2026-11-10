// renders a human-readable npm versions audit report (bin/lib/npm-versions.mjs renderAuditText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAuditText } from '../lib/npm-versions.mjs';

test('reports an error when the scan fails', () => {
  const r = renderAuditText({ error: 'boom' });
  assert.equal(r, "npm versions: boom\n");
});

test('uses singular dependenc y for one direct dependency', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('uses plural dependenc ies for two direct dependencies', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [
      { name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null },
      { name: 'b', locked: '2.0.0', updates: [], held: [], skipped: null },
    ],
    counts: { patch: 1, minor: 1, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 2 direct dependencies\n  behind: patch 1 \u00b7 minor 1 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n  b     2.0.0      current\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('falls back to dir when name is missing', () => {
  const r = renderAuditText({
    dir: 'subdir',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 subdir \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('pads dependency names to the longest name width', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [
      { name: 'ab', locked: '1.0.0', updates: [], held: [], skipped: null },
      { name: 'abcde', locked: '2.0.0', updates: [], held: [], skipped: null },
    ],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 2 direct dependencies\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  ab     1.0.0      current\n  abcde  2.0.0      current\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('shows held versions with the newest reason too-new', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [{ version: '1.1.0', reason: 'too-new', releasesIn: 3 }], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      nothing outside the cooldown  (held: 1 newer, newest 1.1.0 eligible in 3d)\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('shows held versions with the newest reason not too-new', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [{ version: '1.1.0', reason: 'no-time' }], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: { error: null, counts: { critical: 0, high: 0, moderate: 0, low: 0 }, prod: { critical: 0, high: 0, moderate: 0, low: 0 }, rows: [] },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      nothing outside the cooldown  (held: 1 newer, newest 1.1.0 with no publish time)\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n");
});

test('renders advisory rows with severity and exposure padding', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: {
      error: null,
      counts: { critical: 1, high: 0, moderate: 0, low: 0 },
      prod: { critical: 1, high: 0, moderate: 0, low: 0 },
      rows: [{ severity: 'critical', exposure: 'prod', name: 'a', direct: true, advisories: [{ title: 'RCE' }], fix: { state: 'available', to: '1.1.0' } }],
    },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n\n  advisories: critical 1 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 1 \u00b7 high 0 \u00b7 moderate 0 \u00b7 low 0)\n    critical prod    a (direct) \u2014 RCE  [fix: 1.1.0]\n");
});

test('renders advisory rows using via when no title exists', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: {
      error: null,
      counts: { critical: 0, high: 1, moderate: 0, low: 0 },
      prod: { critical: 0, high: 1, moderate: 0, low: 0 },
      rows: [{ severity: 'high', exposure: 'dev', name: 'b', direct: false, advisories: [], via: ['a', 'c'], fix: { state: 'blocked', to: '2.0.0' } }],
    },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n\n  advisories: critical 0 \u00b7 high 1 \u00b7 moderate 0 \u00b7 low 0  (shipped: critical 0 \u00b7 high 1 \u00b7 moderate 0 \u00b7 low 0)\n    high     dev     b \u2014 via a, c  [fix blocked by a parent's range: override to 2.0.0]\n");
});

test('renders advisory rows using the second advisory title when present', () => {
  const r = renderAuditText({
    name: 'pkg',
    deps: [{ name: 'a', locked: '1.0.0', updates: [], held: [], skipped: null }],
    counts: { patch: 0, minor: 0, major: 0 },
    cooldown: { patch: 7, minor: 14, major: 30 },
    advisories: {
      error: null,
      counts: { critical: 0, high: 0, moderate: 2, low: 0 },
      prod: { critical: 0, high: 0, moderate: 2, low: 0 },
      rows: [{ severity: 'moderate', exposure: 'prod', name: 'a', direct: true, advisories: [{ title: 'First' }, { title: 'Second' }], fix: { state: 'unpatched' } }],
    },
  });
  assert.equal(r, "npm versions \u00b7 pkg \u00b7 1 direct dependency\n  behind: patch 0 \u00b7 minor 0 \u00b7 major 0\n  cooldown (days): patch 7 \u00b7 minor 14 \u00b7 major 30 \u2014 a release younger than its cooldown is in the window where a compromised version is still live and not yet pulled\n\n  a     1.0.0      current\n\n  advisories: critical 0 \u00b7 high 0 \u00b7 moderate 2 \u00b7 low 0  (shipped: critical 0 \u00b7 high 0 \u00b7 moderate 2 \u00b7 low 0)\n    moderate prod    a (direct) \u2014 First  [no release outside the affected range]\n");
});
