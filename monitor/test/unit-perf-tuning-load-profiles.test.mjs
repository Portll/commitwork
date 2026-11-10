// Loads, validates and caches the perf profile document for one path (monitor/perf-tuning.mjs loadProfiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfiles } from '../perf-tuning.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEYS = ['profiles', 'scanners', 'costClasses', 'depthLevels', 'intensityLevels', 'diskClasses'];

const sections = (tag) => ({
  profiles: { tag },
  scanners: [1],
  costClasses: [2],
  depthLevels: [3],
  intensityLevels: [4],
  diskClasses: [5],
});

const unreadable = (p, code) => `perf profiles unreadable at ${p}: ${code} \u2014 refusing to derive tuning `
  + 'from an assumed default, which would report a machine we never read';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadProfiles-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRaw(dir, name, raw) {
  const p = join(dir, name);
  writeFileSync(p, raw);
  return p;
}

const writeDoc = (dir, name, doc) => writeRaw(dir, name, JSON.stringify(doc));

test('returns the parsed document when all six sections are declared', () => {
  withDir((dir) => {
    const p = writeDoc(dir, 'full.json', sections('full'));
    assert.deepEqual(loadProfiles({ path: p }), sections('full'));
  });
});

test('returns the cached object without rereading when the same path is requested again', () => {
  withDir((dir) => {
    const p = writeDoc(dir, 'same.json', sections('first'));
    const first = loadProfiles({ path: p });
    writeDoc(dir, 'same.json', sections('second'));
    const second = loadProfiles({ path: p });
    assert.equal(second, first);
    assert.deepEqual(second, sections('first'));
  });
});

test('rereads from disk when a different path is requested after a load', () => {
  withDir((dir) => {
    const pa = writeDoc(dir, 'a.json', sections('a'));
    const pb = writeDoc(dir, 'b.json', sections('b'));
    assert.deepEqual(loadProfiles({ path: pa }), sections('a'));
    assert.deepEqual(loadProfiles({ path: pb }), sections('b'));
    writeDoc(dir, 'a.json', sections('a2'));
    assert.deepEqual(loadProfiles({ path: pa }), sections('a2'));
  });
});

test('keeps the previous cache when a later load fails', () => {
  withDir((dir) => {
    const p = writeDoc(dir, 'kept.json', sections('kept'));
    const first = loadProfiles({ path: p });
    const bad = writeRaw(dir, 'bare.json', '{}');
    assert.throws(() => loadProfiles({ path: bad }), {
      name: 'Error',
      message: `perf profiles at ${bad} declare no profiles`,
    });
    rmSync(p);
    assert.equal(loadProfiles({ path: p }), first);
  });
});

test('reads the CW_PERF_PROFILES path when called with no arguments', () => {
  const saved = process.env.CW_PERF_PROFILES;
  try {
    withDir((dir) => {
      process.env.CW_PERF_PROFILES = writeDoc(dir, 'env.json', sections('env'));
      assert.deepEqual(loadProfiles(), sections('env'));
    });
  } finally {
    if (saved === undefined) delete process.env.CW_PERF_PROFILES;
    else process.env.CW_PERF_PROFILES = saved;
  }
});

test('names the system error code when the file cannot be read', () => {
  withDir((dir) => {
    const missing = join(dir, 'missing.json');
    assert.throws(() => loadProfiles({ path: missing }), { name: 'Error', message: unreadable(missing, 'ENOENT') });
    assert.throws(() => loadProfiles({ path: dir }), { name: 'Error', message: unreadable(dir, 'EISDIR') });
  });
});

test('reports the parser error when the file is not valid JSON', () => {
  withDir((dir) => {
    const p = writeRaw(dir, 'empty.json', '');
    assert.throws(() => loadProfiles({ path: p }), {
      name: 'Error',
      message: `perf profiles at ${p} are not valid JSON: Unexpected end of JSON input`,
    });
  });
});

test('throws a TypeError when the file holds JSON null', () => {
  withDir((dir) => {
    const p = writeRaw(dir, 'null.json', 'null');
    assert.throws(() => loadProfiles({ path: p }), {
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'profiles')",
    });
  });
});

test('names the first absent section in declaration order', () => {
  withDir((dir) => {
    for (const k of KEYS) {
      const doc = sections(k);
      delete doc[k];
      const p = writeDoc(dir, `no-${k}.json`, doc);
      assert.throws(() => loadProfiles({ path: p }), {
        name: 'Error',
        message: `perf profiles at ${p} declare no ${k}`,
      });
    }
    const p = writeDoc(dir, 'two-sections.json', { profiles: [1], diskClasses: [5] });
    assert.throws(() => loadProfiles({ path: p }), {
      name: 'Error',
      message: `perf profiles at ${p} declare no scanners`,
    });
  });
});

test('treats falsy section values as undeclared and empty containers as declared', () => {
  withDir((dir) => {
    for (const [i, value] of [0, '', false, null].entries()) {
      const p = writeDoc(dir, `falsy-${i}.json`, { ...sections('falsy'), intensityLevels: value });
      assert.throws(() => loadProfiles({ path: p }), {
        name: 'Error',
        message: `perf profiles at ${p} declare no intensityLevels`,
      });
    }
    const empties = { profiles: [], scanners: {}, costClasses: [], depthLevels: {}, intensityLevels: [], diskClasses: {} };
    const p = writeDoc(dir, 'empties.json', empties);
    assert.deepEqual(loadProfiles({ path: p }), empties);
  });
});
