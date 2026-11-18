// manifestSummary reads a manifest JSON and returns a structured summary with checks, groups, and metadata (admin/lib/core.mjs manifestSummary).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { manifestSummary } from '../lib/core.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cw-manifests-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeManifest(name, content) {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(content));
}

test('missing manifest file returns ok false', () => {
  const name = 'missing';
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "missing", ok: false });
});

test('invalid JSON manifest returns ok false', () => {
  const name = 'invalid';
  writeFileSync(join(dir, `${name}.json`), 'not json');
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "invalid", ok: false });
});

test('valid manifest with no optional fields returns ok true with defaults', () => {
  const name = 'empty';
  writeManifest(name, {});
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "empty", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 0, checks: [] });
});

test('manifest with groups but no checks returns groups and groupMembers', () => {
  const name = 'groups';
  writeManifest(name, { groups: { grp1: ['a'], grp2: ['b'] } });
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "groups", ok: true, repo: null, note: null, groups: ["grp1", "grp2"], groupMembers: { grp1: ["a"], grp2: ["b"] }, checkCount: 0, checks: [] });
});

test('manifest with checks maps all check fields correctly', () => {
  const name = 'full';
  writeManifest(name, {
    repo: 'repo',
    note: 'note',
    groups: { grp: ['a'] },
    checks: [{
      id: 'c1',
      description: 'desc',
      groups: ['grp'],
      requires: { foo: 'bar' },
      report: { file: 'report.txt' },
      aliasOf: 'other',
      remediationPrompt: 'fix it',
      formatNotes: 'fmt'
    }]
  });
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "full", ok: true, repo: "repo", note: "note", groups: ["grp"], groupMembers: { grp: ["a"] }, checkCount: 1, checks: [{ id: "c1", description: "desc", groups: ["grp"], requires: { foo: "bar" }, report: "report.txt", aliasOf: "other", remediationPrompt: "fix it", formatNotes: "fmt" }] });
});

test('check with requires as non-object becomes null', () => {
  const name = 'requires-str';
  writeManifest(name, { checks: [{ id: 'c1', requires: 'string' }] });
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "requires-str", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: null, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
});

test('check with requires as object keeps object', () => {
  const name = 'requires-obj';
  writeManifest(name, { checks: [{ id: 'c1', requires: { a: 1 } }] });
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "requires-obj", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: { a: 1 }, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
});

test('check with missing optional fields becomes defaults', () => {
  const name = 'missing-fields';
  writeManifest(name, { checks: [{ id: 'c1' }] });
  const result = manifestSummary(name, { dir });
  assert.deepEqual(result, { name: "missing-fields", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: null, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
});

test('reads the bundled manifest directory by default', () => {
  const result = manifestSummary('security-baseline');
  assert.equal(result.ok, true);
  assert.ok(result.checkCount > 0);
});
