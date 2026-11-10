// The stored rows of a named override table, or an error (monitor/settings.mjs getRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRules } from '../settings.mjs';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DASH = '\u2014';

function useDir() {
  const dir = mkdtempSync(join(tmpdir(), 'getRules-'));
  const path = join(dir, 'settings.json');
  const saved = process.env.CW_SETTINGS;
  process.env.CW_SETTINGS = path;
  return { dir, path, saved };
}

function restore(saved) {
  if (saved === undefined) delete process.env.CW_SETTINGS;
  else process.env.CW_SETTINGS = saved;
}

test('an undeclared table name is rejected with ok false and the list of declared tables', () => {
  const { dir, path, saved } = useDir();
  try {
    writeFileSync(path, JSON.stringify({ rules: { nope: [1] } }));
    const result = getRules('nope');
    assert.deepEqual(result, { ok: false, rows: [], error: `unknown rule table "nope" ${DASH} declared: hang, kill, cadence` });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an undefined table name is rejected with the word undefined in the error', () => {
  const { dir, saved } = useDir();
  try {
    const result = getRules(undefined);
    assert.deepEqual(result, { ok: false, rows: [], error: `unknown rule table undefined ${DASH} declared: hang, kill, cadence` });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a declared table returns ok true with exactly the stored rows', () => {
  const { dir, path, saved } = useDir();
  try {
    const rows = Array.from({ length: 3 }, (_, i) => ({ include: 'INCLUDE', directory: 'd' + i, value: 1000 + i }));
    writeFileSync(path, JSON.stringify({ rules: { hang: rows, kill: [9] } }));
    const result = getRules('hang');
    assert.deepEqual(result, { ok: true, rows, error: null });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a declared table missing from the rules object returns ok true with no rows', () => {
  const { dir, path, saved } = useDir();
  try {
    writeFileSync(path, JSON.stringify({ rules: { kill: [1, 2] } }));
    const result = getRules('cadence');
    assert.deepEqual(result, { ok: true, rows: [], error: null });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing settings file returns ok true with no rows', () => {
  const { dir, saved } = useDir();
  try {
    const result = getRules('kill');
    assert.deepEqual(result, { ok: true, rows: [], error: null });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a table value that is an object rather than an array returns ok true with no rows', () => {
  const { dir, path, saved } = useDir();
  try {
    writeFileSync(path, JSON.stringify({ rules: { hang: { a: 1 } } }));
    const result = getRules('hang');
    assert.deepEqual(result, { ok: true, rows: [], error: null });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a store that is a JSON array returns ok false with the store error', () => {
  const { dir, path, saved } = useDir();
  try {
    writeFileSync(path, JSON.stringify([1, 2]));
    const result = getRules('hang');
    assert.deepEqual(result, { ok: false, rows: [], error: `the settings store at ${path} is not a JSON object` });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a store path that is a directory returns ok false with an EISDIR error', () => {
  const { dir, path, saved } = useDir();
  try {
    mkdirSync(path);
    const result = getRules('kill');
    assert.deepEqual(result, { ok: false, rows: [], error: `EISDIR reading the settings store at ${path}` });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a settings field that is not an object returns ok false even when rules are present', () => {
  const { dir, path, saved } = useDir();
  try {
    writeFileSync(path, JSON.stringify({ settings: 5, rules: { cadence: [1] } }));
    const result = getRules('cadence');
    assert.deepEqual(result, { ok: false, rows: [], error: `the settings store at ${path} has a "settings" field that is not an object` });
  } finally {
    restore(saved);
    rmSync(dir, { recursive: true, force: true });
  }
});
