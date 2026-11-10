// Flat set of every baselined place key across all repos (monitor/minify-baseline.mjs loadBaselinePlaceKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaselinePlaceKeys } from '../minify-baseline.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PERMISSIVE = { type: 'object', required: ['repos'], properties: { repos: { type: 'object' } } };
const REJECTING = { type: 'array', required: ['absent'], properties: { repos: { type: 'string' } } };

const baseline = (repos) => ({ version: 1, repos, journal: [] });

function withBaseline(content, check, schema = PERMISSIVE) {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaselinePlaceKeys-'));
  const saved = process.env.CW_MINIFY_BASELINE_SCHEMA;
  try {
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify(schema));
    process.env.CW_MINIFY_BASELINE_SCHEMA = schemaPath;
    const p = join(dir, 'baseline.json');
    writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
    check(p, dir);
  } finally {
    if (saved === undefined) delete process.env.CW_MINIFY_BASELINE_SCHEMA;
    else process.env.CW_MINIFY_BASELINE_SCHEMA = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a baseline file that does not exist gives an empty set', () => {
  withBaseline(baseline({}), (p, dir) => {
    assert.deepEqual(loadBaselinePlaceKeys(join(dir, 'missing.json')), new Set());
  });
});

test('a baseline file that is not valid JSON gives an empty set', () => {
  withBaseline('not json', (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set());
  });
});

test('a baseline file holding JSON null gives an empty set', () => {
  withBaseline(null, (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set());
  });
});

test('a baseline without a repos field gives an empty set', () => {
  withBaseline({ version: 1, journal: [] }, (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set());
  });
});

test('a baseline whose repos field is null gives an empty set', () => {
  withBaseline(baseline(null), (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set());
  });
});

test('a baseline that fails schema validation grandfathers none of its keys', () => {
  withBaseline(baseline({ a: { placeKeys: ['rejected-key'] } }), (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set());
  }, REJECTING);
});

test('the place keys of a single repo are collected in file order', () => {
  withBaseline(baseline({ a: { placeKeys: ['place-a', 'place-b'] } }), (p) => {
    const r = loadBaselinePlaceKeys(p);
    assert.deepEqual(r, new Set(['place-a', 'place-b']));
    assert.deepEqual([...r], ['place-a', 'place-b']);
  });
});

test('keys from several repos merge into one set with duplicates removed', () => {
  const repos = {};
  for (let i = 0; i < 3; i++) repos['r' + i] = { placeKeys: ['shared', 'k' + i] };
  withBaseline(baseline(repos), (p) => {
    const r = loadBaselinePlaceKeys(p);
    assert.deepEqual(r, new Set(['shared', 'k0', 'k1', 'k2']));
    assert.deepEqual([...r], ['shared', 'k0', 'k1', 'k2']);
  });
});

test('repos with absent, null or empty placeKeys add nothing and do not stop later repos', () => {
  const repos = { a: {}, b: { placeKeys: null }, c: { placeKeys: [] }, d: { placeKeys: ['after-gap'] } };
  withBaseline(baseline(repos), (p) => {
    assert.deepEqual(loadBaselinePlaceKeys(p), new Set(['after-gap']));
  });
});

test('with no path argument the file named by CW_MINIFY_BASELINE is read', () => {
  withBaseline(baseline({ a: { placeKeys: ['env-key'] } }), (p) => {
    const saved = process.env.CW_MINIFY_BASELINE;
    process.env.CW_MINIFY_BASELINE = p;
    try {
      assert.deepEqual(loadBaselinePlaceKeys(), new Set(['env-key']));
    } finally {
      if (saved === undefined) delete process.env.CW_MINIFY_BASELINE;
      else process.env.CW_MINIFY_BASELINE = saved;
    }
  });
});
