// Per-area parsed defect-signature artifacts with declared/read/absent counts (monitor/defect-signature.mjs readAreaSignatures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAreaSignatures } from '../defect-signature.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAME = 'defect-signatures.json';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'readAreaSignatures-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir, sub, content) {
  mkdirSync(join(dir, sub), { recursive: true });
  const p = join(dir, sub, NAME);
  writeFileSync(p, content);
  return p;
}

function errMessage(fn) {
  try { fn(); } catch (e) { return e.message; }
  return null;
}

test('an empty areas list returns no artifacts and all-zero counts', () => {
  withDir((dir) => {
    const r = readAreaSignatures({ areas: [] }, { root: dir });
    assert.deepEqual(r, { perArea: [], areas: { declared: 0, read: 0, absent: 0, failed: 0 } });
  });
});

test('a registry without areas is treated as an empty list', () => {
  withDir((dir) => {
    const r = readAreaSignatures({}, { root: dir });
    assert.deepEqual(r, { perArea: [], areas: { declared: 0, read: 0, absent: 0, failed: 0 } });
  });
});

test('an artifact under area.out is parsed and attributed to the area slug', () => {
  withDir((dir) => {
    put(dir, 'out-a', JSON.stringify({ sig: 1, list: [1, 2] }));
    const r = readAreaSignatures({ areas: [{ slug: 'alpha', out: 'out-a' }] }, { root: dir });
    assert.deepEqual(r, {
      perArea: [{ area: 'alpha', artifact: { sig: 1, list: [1, 2] } }],
      areas: { declared: 1, read: 1, absent: 0, failed: 0 },
    });
  });
});

test('an area without out reads its artifact from the slug directory', () => {
  withDir((dir) => {
    put(dir, 'delta', JSON.stringify({ ok: true }));
    const r = readAreaSignatures({ areas: [{ slug: 'delta' }] }, { root: dir });
    assert.deepEqual(r, {
      perArea: [{ area: 'delta', artifact: { ok: true } }],
      areas: { declared: 1, read: 1, absent: 0, failed: 0 },
    });
  });
});

test('a missing artifact counts as absent instead of failing', () => {
  withDir((dir) => {
    const r = readAreaSignatures({ areas: [{ slug: 'beta' }] }, { root: dir });
    assert.deepEqual(r, { perArea: [], areas: { declared: 1, read: 0, absent: 1, failed: 0 } });
  });
});

test('present and missing artifacts are counted separately across areas', () => {
  withDir((dir) => {
    put(dir, 'o1', JSON.stringify({ v: 1 }));
    put(dir, 'a2', JSON.stringify({ v: 2 }));
    const reg = { areas: [{ slug: 'a1', out: 'o1' }, { slug: 'a2' }, { slug: 'a3', out: 'o3' }] };
    const r = readAreaSignatures(reg, { root: dir });
    assert.deepEqual(r, {
      perArea: [{ area: 'a1', artifact: { v: 1 } }, { area: 'a2', artifact: { v: 2 } }],
      areas: { declared: 3, read: 2, absent: 1, failed: 0 },
    });
  });
});

test('an artifact that is not valid JSON throws with the parse error message', () => {
  withDir((dir) => {
    const p = put(dir, 'gamma', 'not-json');
    const parseMsg = errMessage(() => JSON.parse('not-json'));
    assert.throws(() => readAreaSignatures({ areas: [{ slug: 'gamma' }] }, { root: dir }), {
      name: 'Error',
      message: `1 area defect-signature artifact(s) could not be read:\n  gamma: ${p}: ${parseMsg}`,
    });
  });
});

test('an artifact path that is a directory throws with the read error message', () => {
  withDir((dir) => {
    const p = join(dir, 'eps-out', NAME);
    mkdirSync(p, { recursive: true });
    const readMsg = errMessage(() => readFileSync(p, 'utf8'));
    assert.throws(() => readAreaSignatures({ areas: [{ slug: 'eps', out: 'eps-out' }] }, { root: dir }), {
      name: 'Error',
      message: `1 area defect-signature artifact(s) could not be read:\n  eps: ${p}: ${readMsg}`,
    });
  });
});

test('every unreadable artifact is listed in one error while missing ones are ignored', () => {
  withDir((dir) => {
    const p1 = put(dir, 'bad', '{"x":');
    const p2 = join(dir, 'dirart', NAME);
    mkdirSync(p2, { recursive: true });
    put(dir, 'good', JSON.stringify({ fine: 1 }));
    const m1 = errMessage(() => JSON.parse('{"x":'));
    const m2 = errMessage(() => readFileSync(p2, 'utf8'));
    const reg = { areas: [{ slug: 'bad' }, { slug: 'dirart' }, { slug: 'missing' }, { slug: 'good' }] };
    assert.throws(() => readAreaSignatures(reg, { root: dir }), {
      name: 'Error',
      message: `2 area defect-signature artifact(s) could not be read:\n  bad: ${p1}: ${m1}\n  dirart: ${p2}: ${m2}`,
    });
  });
});
