// manifestSummary reads a manifest JSON and returns a structured summary with checks, groups, and metadata (admin/lib/core.mjs manifestSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestSummary, MANIFEST_DIR } from '../lib/core.mjs';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let counter = 0;
function uniqueName(prefix) {
  return `${prefix}-${++counter}`;
}

function writeManifest(name, content) {
  const path = join(MANIFEST_DIR, `${name}.json`);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function removeManifest(name) {
  const path = join(MANIFEST_DIR, `${name}.json`);
  if (existsSync(path)) rmSync(path);
}

test('missing manifest file returns ok false', () => {
  const name = uniqueName('missing');
  try {
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "missing-1", ok: false });
  } finally {
    removeManifest(name);
  }
});

test('invalid JSON manifest returns ok false', () => {
  const name = uniqueName('invalid');
  try {
    writeFileSync(join(MANIFEST_DIR, `${name}.json`), 'not json');
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "invalid-2", ok: false });
  } finally {
    removeManifest(name);
  }
});

test('valid manifest with no optional fields returns ok true with defaults', () => {
  const name = uniqueName('empty');
  try {
    writeManifest(name, {});
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "empty-3", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 0, checks: [] });
  } finally {
    removeManifest(name);
  }
});

test('manifest with groups but no checks returns groups and groupMembers', () => {
  const name = uniqueName('groups');
  try {
    writeManifest(name, { groups: { grp1: ['a'], grp2: ['b'] } });
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "groups-4", ok: true, repo: null, note: null, groups: ["grp1", "grp2"], groupMembers: { grp1: ["a"], grp2: ["b"] }, checkCount: 0, checks: [] });
  } finally {
    removeManifest(name);
  }
});

test('manifest with checks maps all check fields correctly', () => {
  const name = uniqueName('full');
  try {
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
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "full-5", ok: true, repo: "repo", note: "note", groups: ["grp"], groupMembers: { grp: ["a"] }, checkCount: 1, checks: [{ id: "c1", description: "desc", groups: ["grp"], requires: { foo: "bar" }, report: "report.txt", aliasOf: "other", remediationPrompt: "fix it", formatNotes: "fmt" }] });
  } finally {
    removeManifest(name);
  }
});

test('check with requires as non-object becomes null', () => {
  const name = uniqueName('requires-str');
  try {
    writeManifest(name, { checks: [{ id: 'c1', requires: 'string' }] });
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "requires-str-6", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: null, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
  } finally {
    removeManifest(name);
  }
});

test('check with requires as object keeps object', () => {
  const name = uniqueName('requires-obj');
  try {
    writeManifest(name, { checks: [{ id: 'c1', requires: { a: 1 } }] });
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "requires-obj-7", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: { a: 1 }, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
  } finally {
    removeManifest(name);
  }
});

test('check with missing optional fields becomes defaults', () => {
  const name = uniqueName('missing-fields');
  try {
    writeManifest(name, { checks: [{ id: 'c1' }] });
    const result = manifestSummary(name);
    assert.deepEqual(result, { name: "missing-fields-8", ok: true, repo: null, note: null, groups: [], groupMembers: {}, checkCount: 1, checks: [{ id: "c1", description: "", groups: [], requires: null, report: null, aliasOf: null, remediationPrompt: null, formatNotes: null }] });
  } finally {
    removeManifest(name);
  }
});
