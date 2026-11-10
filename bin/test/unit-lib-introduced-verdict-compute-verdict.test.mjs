// Computes the security verdict for a dependency update (bin/lib/introduced-verdict.mjs computeVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict } from '../lib/introduced-verdict.mjs';

const g = (ecosystem, packages, unresolved = []) => ({ ecosystem, packages: new Map(packages), unresolved });
const p = (name, version, registry, exposure, paths) => ({ name, version, registry, exposure, paths });
const f = (id, severity, aliases = [], summary = '', url = null, severitySource = null) => ({ id, severity, aliases, summary, url, severitySource });

test('returns unmeasured state with zero counts when the before graph has an error', () => {
  const before = { error: 'boom', ecosystem: 'npm', packages: new Map(), unresolved: [] };
  const after = g('npm', []);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "unmeasured", reasons: ["the before graph could not be resolved: boom"], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 }, introduced: [], resolved: [], unmeasured: [] });
});

test('returns unmeasured state with zero counts when the after graph has an error', () => {
  const before = g('npm', []);
  const after = { error: 'fail', ecosystem: 'npm', packages: new Map(), unresolved: [] };
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "unmeasured", reasons: ["the after graph could not be resolved: fail"], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 }, introduced: [], resolved: [], unmeasured: [] });
});

test('returns clear state with no advisories when both graphs are empty', () => {
  const before = g('npm', []);
  const after = g('npm', []);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "clear", reasons: [], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 }, introduced: [], resolved: [], unmeasured: [] });
});

test('returns introduces state with a blocking advisory when a new package with a critical advisory appears', () => {
  const before = g('npm', []);
  const after = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', 'npm', 'prod', ['a'])]]);
  const findingsAfter = new Map([['pkg@1.0.0', { advisories: [f('ADV-1', 'critical')] }]]);
  const r = computeVerdict({ before, after, findingsAfter });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "introduces", reasons: [], counts: { introduced: 1, blocking: 1, resolved: 0, persisting: 0, unmeasured: 0, looked: 1 }, introduced: [{ advisory: "ADV-1", aliases: [], package: "pkg", versions: ["1.0.0"], severity: "critical", severitySource: null, summary: "", url: null, exposure: "prod", paths: ["a"], why: "new-advisory", blocking: true }], resolved: [], unmeasured: [] });
});

test('returns clear state with a resolved advisory when a package with an advisory is removed', () => {
  const before = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', 'npm', 'prod', ['a'])]]);
  const after = g('npm', []);
  const findingsBefore = new Map([['pkg@1.0.0', { advisories: [f('ADV-1', 'low')] }]]);
  const r = computeVerdict({ before, after, findingsBefore });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "clear", reasons: [], counts: { introduced: 0, blocking: 0, resolved: 1, persisting: 0, unmeasured: 0, looked: 1 }, introduced: [], resolved: [{ advisory: "ADV-1", aliases: [], package: "pkg", versions: ["1.0.0"], severity: "low", severitySource: null, summary: "", url: null, exposure: "prod", paths: ["a"] }], unmeasured: [] });
});

test('returns clear state with a persisting advisory when the same advisory exists on both sides', () => {
  const before = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', 'npm', 'prod', ['a'])]]);
  const after = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', 'npm', 'prod', ['a'])]]);
  const findingsBefore = new Map([['pkg@1.0.0', { advisories: [f('ADV-1', 'low')] }]]);
  const findingsAfter = new Map([['pkg@1.0.0', { advisories: [f('ADV-1', 'low')] }]]);
  const r = computeVerdict({ before, after, findingsBefore, findingsAfter });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "clear", reasons: [], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 }, introduced: [], resolved: [], unmeasured: [] });
});

test('returns unmeasured state when a new package has no advisory lookup result', () => {
  const before = g('npm', []);
  const after = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', 'npm', 'prod', ['a'])]]);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "unmeasured", reasons: ["1 version(s) that could change the answer were not measured"], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 1, looked: 1 }, introduced: [], resolved: [], unmeasured: [{ side: "after", package: "pkg", version: "1.0.0", reason: "no advisory lookup answered for this version" }] });
});

test('returns unmeasured state when a new package has no registry', () => {
  const before = g('npm', []);
  const after = g('npm', [[`pkg@1.0.0`, p('pkg', '1.0.0', null, 'prod', ['a'])]]);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "unmeasured", reasons: ["1 version(s) that could change the answer were not measured"], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 1, looked: 1 }, introduced: [], resolved: [], unmeasured: [{ side: "after", package: "pkg", version: "1.0.0", reason: "not a registry package: no advisory database indexes it by version" }] });
});

test('returns unmeasured state when an after unresolved location is not in the before unresolved set', () => {
  const before = g('npm', []);
  const after = g('npm', [], [{ location: 'loc1', reason: 'why' }]);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "unmeasured", reasons: ["1 version(s) that could change the answer were not measured"], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 1, looked: 0 }, introduced: [], resolved: [], unmeasured: [{ side: "after", package: null, version: null, location: "loc1", reason: "why" }] });
});

test('returns clear state when an after unresolved location is already in the before unresolved set', () => {
  const before = g('npm', [], [{ location: 'loc1', reason: 'why' }]);
  const after = g('npm', [], [{ location: 'loc1', reason: 'why' }]);
  const r = computeVerdict({ before, after });
  assert.deepEqual(r, { schema: "commitwork.introduced-advisories", version: 1, check: { kind: "security", id: "dependency-audit" }, generatedAt: null, ecosystem: "npm", subject: null, source: null, scope: { includeDev: true, blocking: ["critical", "high", "unknown"] }, state: "clear", reasons: [], counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 }, introduced: [], resolved: [], unmeasured: [] });
});
