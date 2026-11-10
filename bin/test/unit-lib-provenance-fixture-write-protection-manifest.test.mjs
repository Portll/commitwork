// Writes a single-repo branch-protection manifest JSON file and returns its path (bin/lib/provenance-fixture.mjs writeProtectionManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeProtectionManifest } from '../lib/provenance-fixture.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'writeProtectionManifest-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectText(fields) {
  const body = fields.map((f, i) => `      ${f}${i < fields.length - 1 ? ',' : ''}`);
  return ['{', '  "repos": [', '    {', ...body, '    }', '  ]', '}', ''].join('\n');
}

function readManifest(dir) {
  return readFileSync(join(dir, 'branch-protection.json'), 'utf8');
}

test('Returns null and writes no file when branchProtection is absent', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r1', defaultBranch: 'main' }, dir);
    assert.equal(r, null);
    assert.equal(existsSync(join(dir, 'branch-protection.json')), false);
  });
});

test('Returns null when branchProtection is null', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r1', branchProtection: null, defaultBranch: 'dev' }, dir);
    assert.equal(r, null);
    assert.equal(existsSync(join(dir, 'branch-protection.json')), false);
  });
});

test('Falls back to main when defaultBranch is an empty string and keeps requireSigned true', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r1', branchProtection: { requireSigned: true }, defaultBranch: '' }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.equal(readManifest(dir), expectText(['"repo": "r1"', '"branch": "main"', '"requiredChecks": []', '"requireSigned": true']));
  });
});

test('Uses the given defaultBranch and writes requireSigned false when it is false', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'org/app', branchProtection: { requireSigned: false }, defaultBranch: 'develop' }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.equal(readManifest(dir), expectText(['"repo": "org/app"', '"branch": "develop"', '"requiredChecks": []', '"requireSigned": false']));
  });
});

test('Defaults branch to main and requireSigned to false when both are missing', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r2', branchProtection: {} }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.deepEqual(JSON.parse(readManifest(dir)), { repos: [{ repo: 'r2', branch: 'main', requiredChecks: [], requireSigned: false }] });
  });
});

test('Treats requireSigned of 1 as false because only the boolean true counts', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r3', branchProtection: { requireSigned: 1 }, defaultBranch: 'trunk' }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.equal(readManifest(dir), expectText(['"repo": "r3"', '"branch": "trunk"', '"requiredChecks": []', '"requireSigned": false']));
  });
});

test('Treats requireSigned of the string true as false', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ repo: 'r4', branchProtection: { requireSigned: 'true' }, defaultBranch: 'main' }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.deepEqual(JSON.parse(readManifest(dir)), { repos: [{ repo: 'r4', branch: 'main', requiredChecks: [], requireSigned: false }] });
  });
});

test('Omits the repo key when spec.repo is undefined and branchProtection is a bare true', () => {
  withDir((dir) => {
    const r = writeProtectionManifest({ branchProtection: true, defaultBranch: 'release' }, dir);
    assert.equal(r, join(dir, 'branch-protection.json'));
    assert.equal(readManifest(dir), expectText(['"branch": "release"', '"requiredChecks": []', '"requireSigned": false']));
  });
});

test('Throws a TypeError when spec is null', () => {
  withDir((dir) => {
    assert.throws(() => writeProtectionManifest(null, dir), {
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'branchProtection')",
    });
  });
});
