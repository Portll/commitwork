// Parsed contents of a JSON file, or a fallback when it cannot be read (cra/lib.mjs loadJSON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJSON } from '../lib.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadJSON-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parses a valid JSON file into the corresponding object', () => {
  withDir((dir) => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ a: 1, b: 'two' }));
    assert.deepEqual(loadJSON(p), { a: 1, b: 'two' });
  });
});

test('ignores the fallback when the file holds valid JSON', () => {
  withDir((dir) => {
    const p = join(dir, 'arr.json');
    writeFileSync(p, '[3]');
    assert.deepEqual(loadJSON(p, 'fb'), [3]);
  });
});

test('returns the provided fallback when the file is missing', () => {
  withDir((dir) => {
    const p = join(dir, 'missing.json');
    const fb = { fallback: true };
    const r = loadJSON(p, fb);
    assert.equal(r, fb);
    assert.deepEqual(r, { fallback: true });
  });
});

test('returns the provided fallback when the file contains invalid JSON', () => {
  withDir((dir) => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    assert.deepEqual(loadJSON(p, [1, 2]), [1, 2]);
  });
});

test('throws an error naming the path when the file is missing and no fallback is given', () => {
  withDir((dir) => {
    const p = join(dir, 'nope.json');
    assert.throws(() => loadJSON(p), {
      name: 'Error',
      message: `could not read ${p}: ENOENT: no such file or directory, open '${p}'`,
    });
  });
});

test('throws an error naming the path when the file is invalid and no fallback is given', () => {
  withDir((dir) => {
    const p = join(dir, 'broken.json');
    writeFileSync(p, 'not json at all');
    assert.throws(() => loadJSON(p), {
      name: 'Error',
      message: `could not read ${p}: Unexpected token 'o', "not json at all" is not valid JSON`,
    });
  });
});

test('throws when the fallback is passed explicitly as undefined', () => {
  withDir((dir) => {
    const p = join(dir, 'gone.json');
    assert.throws(() => loadJSON(p, undefined), {
      name: 'Error',
      message: `could not read ${p}: ENOENT: no such file or directory, open '${p}'`,
    });
  });
});

test('returns the fallback when it is explicitly null and the file is missing', () => {
  withDir((dir) => {
    const p = join(dir, 'absent.json');
    assert.equal(loadJSON(p, null), null);
  });
});

test('returns the fallback when it is explicitly false and the file is missing', () => {
  withDir((dir) => {
    const p = join(dir, 'absent2.json');
    assert.equal(loadJSON(p, false), false);
  });
});

test('returns the fallback when it is explicitly zero and the file is missing', () => {
  withDir((dir) => {
    const p = join(dir, 'absent3.json');
    assert.equal(loadJSON(p, 0), 0);
  });
});
