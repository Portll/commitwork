// A read-only graph store whose fingerprint matches the current inputs (bin/graph.mjs openFresh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openFresh } from '../graph.mjs';
import { build, project, readInputs } from '../graph.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = '2026-01-02T03:04:05.000Z';
process.env.CW_NOW = NOW;

const gaveUp = (n) => `the graph inputs changed ${n} times while the store was being rebuilt \u2014 no stable edition to answer from`;

const expected = () => {
  const inputs = readInputs();
  return { generated: NOW, fingerprint: inputs.fingerprint, status: project(inputs).status };
};

const header = (file) => readFileSync(file).toString('latin1', 0, 15);

const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'openFresh-'));
  try {
    return fn(join(dir, 'graph.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const opened = (r) => {
  try {
    return { rebuilt: r.rebuilt, meta: r.meta };
  } finally {
    r.db.close();
  }
};

test('returns the stored edition read-only without rebuilding when its fingerprint and version match', () => inDir((file) => {
  const built = build({ file });
  const r = openFresh({ file, attempts: 1 });
  assert.throws(() => r.db.exec('DELETE FROM edges'), { code: 'ERR_SQLITE_ERROR', message: 'attempt to write a readonly database' });
  assert.deepEqual(opened(r), { rebuilt: false, meta: { generated: NOW, fingerprint: built.fingerprint, status: built.status } });
}));

test('rebuilds a missing store and reports that it rebuilt', () => inDir((file) => {
  assert.deepEqual(opened(openFresh({ file })), { rebuilt: true, meta: expected() });
  assert.equal(header(file), 'SQLite format 3');
}));

test('rebuilds a store whose fingerprint differs from the current inputs', () => inDir((file) => {
  build({ file, inputs: { issues: null, taxonomy: null, registry: null, rollups: [], absent: {}, fingerprint: 'stale' } });
  assert.deepEqual(opened(openFresh({ file })), { rebuilt: true, meta: expected() });
}));

test('rebuilds a store written under another graph version even though its fingerprint matches', () => inDir((file) => {
  build({ file });
  const buf = readFileSync(file);
  buf[buf.indexOf('version1') + 7] = 0x32;
  writeFileSync(file, buf);
  assert.deepEqual(opened(openFresh({ file })), { rebuilt: true, meta: expected() });
}));

test('rebuilds over a file that is not an SQLite database', () => inDir((file) => {
  writeFileSync(file, 'x'.repeat(1024));
  assert.deepEqual(opened(openFresh({ file })), { rebuilt: true, meta: expected() });
  assert.equal(header(file), 'SQLite format 3');
}));

test('rebuilds over an empty file that has no meta table', () => inDir((file) => {
  writeFileSync(file, '');
  assert.deepEqual(opened(openFresh({ file })), { rebuilt: true, meta: expected() });
  assert.equal(header(file), 'SQLite format 3');
}));

test('rethrows an error that is not about opening the store instead of rebuilding', () => inDir((file) => {
  const text = JSON.stringify(build({ file }).status);
  const buf = readFileSync(file);
  buf[buf.indexOf(text)] = 0x5b;
  writeFileSync(file, buf);
  let message = null;
  try {
    JSON.parse(`[${text.slice(1)}`);
  } catch (e) {
    message = e.message;
  }
  assert.throws(() => openFresh({ file }), { name: 'SyntaxError', message });
}));

test('gives up after a single attempt that had to rebuild, leaving the rebuilt store behind', () => inDir((file) => {
  assert.throws(() => openFresh({ file, attempts: 1 }), { name: 'Error', message: gaveUp(1) });
  assert.equal(header(file), 'SQLite format 3');
}));

test('gives up before opening or building anything when no attempts are allowed', () => inDir((file) => {
  assert.throws(() => openFresh({ file, attempts: 0 }), { name: 'Error', message: gaveUp(0) });
  assert.equal(existsSync(file), false);
}));

test('answers from the rebuilt store on the second of two attempts', () => inDir((file) => {
  assert.deepEqual(opened(openFresh({ file, attempts: 2 })), { rebuilt: true, meta: expected() });
}));
