// Merged baseline and manifest check lists keyed by name (monitor/lane-roster.mjs readBundledChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBundledChecks } from '../lane-roster.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'readBundledChecks-'));
  try {
    const manifests = join(dir, 'manifests');
    const baseline = join(dir, 'baseline.json');
    mkdirSync(manifests);
    writeFileSync(baseline, JSON.stringify({ checks: ['base'] }));
    fn({ dir, manifests, baseline });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('returns null when the baseline file is missing', () => inTempDir(({ dir, manifests }) => {
  writeFileSync(join(manifests, 'alpha.json'), JSON.stringify({ checks: ['a'] }));
  const r = readBundledChecks({ dir: manifests, baseline: join(dir, 'absent.json') });
  assert.equal(r, null);
}));

test('returns null when the manifests directory is missing', () => inTempDir(({ dir, baseline }) => {
  const r = readBundledChecks({ dir: join(dir, 'absent'), baseline });
  assert.equal(r, null);
}));

test('rethrows a directory read error that is not ENOENT', () => inTempDir(({ dir, baseline }) => {
  const file = join(dir, 'plain.txt');
  writeFileSync(file, 'x');
  assert.throws(() => readBundledChecks({ dir: file, baseline }), {
    name: 'Error',
    code: 'ENOTDIR',
    message: `ENOTDIR: not a directory, scandir '${file}'`,
  });
}));

test('throws when the baseline file has no checks array', () => inTempDir(({ manifests, baseline }) => {
  writeFileSync(baseline, JSON.stringify({ rules: [] }));
  assert.throws(() => readBundledChecks({ dir: manifests, baseline }), {
    name: 'Error',
    message: `${baseline}: no checks array`,
  });
}));

test('keeps an empty baseline checks array when the directory is empty', () => inTempDir(({ manifests, baseline }) => {
  writeFileSync(baseline, JSON.stringify({ checks: [] }));
  const r = readBundledChecks({ dir: manifests, baseline });
  assert.deepEqual(r, { 'security-baseline': [] });
}));

test('lists each manifest under its file name with the keys sorted', () => inTempDir(({ manifests, baseline }) => {
  writeFileSync(join(manifests, 'zeta.json'), JSON.stringify({ checks: ['z'] }));
  writeFileSync(join(manifests, 'alpha.json'), JSON.stringify({ checks: ['a1', 'a2'] }));
  writeFileSync(join(manifests, 'empty.json'), JSON.stringify({ checks: [] }));
  const r = readBundledChecks({ dir: manifests, baseline });
  assert.deepEqual(r, {
    alpha: ['a1', 'a2'],
    empty: [],
    'security-baseline': ['base'],
    zeta: ['z'],
  });
  assert.deepEqual(Object.keys(r), ['alpha', 'empty', 'security-baseline', 'zeta']);
}));

test('uses the baseline path and not a same-named file in the directory', () => inTempDir(({ manifests, baseline }) => {
  writeFileSync(join(manifests, 'security-baseline.json'), JSON.stringify({ checks: ['shadow'] }));
  const r = readBundledChecks({ dir: manifests, baseline });
  assert.deepEqual(r, { 'security-baseline': ['base'] });
}));

test('ignores files whose names do not end in .json', () => inTempDir(({ manifests, baseline }) => {
  for (const name of ['notes.txt', 'alpha.json.bak', 'plainjson']) {
    writeFileSync(join(manifests, name), 'not json');
  }
  const r = readBundledChecks({ dir: manifests, baseline });
  assert.deepEqual(r, { 'security-baseline': ['base'] });
}));

test('skips manifests that are falsy, primitive, or lack a checks key', () => inTempDir(({ manifests, baseline }) => {
  const docs = {
    'a-null': 'null',
    'b-zero': '0',
    'c-false': 'false',
    'd-text': '"text"',
    'e-number': '7',
    'f-array': '[1,2]',
    'g-other': '{"other":1}',
  };
  for (const [name, body] of Object.entries(docs)) {
    writeFileSync(join(manifests, `${name}.json`), body);
  }
  const r = readBundledChecks({ dir: manifests, baseline });
  assert.deepEqual(r, { 'security-baseline': ['base'] });
}));

test('throws naming the manifest when its checks key is not an array', () => inTempDir(({ manifests, baseline }) => {
  const path = join(manifests, 'beta.json');
  for (const checks of ['nope', null, { a: 1 }]) {
    writeFileSync(path, JSON.stringify({ checks }));
    assert.throws(() => readBundledChecks({ dir: manifests, baseline }), {
      name: 'Error',
      message: `${path}: checks is not an array`,
    });
  }
}));
