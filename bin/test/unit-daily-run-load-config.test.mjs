// Parsed daily config JSON after schema validation (bin/daily-run.mjs loadConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../daily-run.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REQUIRED = "schema: (root): required key 'areas' is missing";
const unknown = (k) => `schema: (root): unknown key '${k}' (additionalProperties: false)`;
const keysObject = (keys) => JSON.stringify(Object.fromEntries(keys.map((k, i) => [k, i])));

function withConfig(name, body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadConfig-'));
  try {
    const p = join(dir, name);
    if (body !== undefined) writeFileSync(p, body);
    fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an empty object reports only the missing areas key', () => {
  withConfig('empty.json', keysObject([]), (p) => {
    assert.throws(() => loadConfig(p), { name: 'Error', message: `daily config ${p}: ${REQUIRED}` });
  });
});

test('one unknown key gives two errors joined with a semicolon', () => {
  withConfig('bad1.json', keysObject(['a']), (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'Error',
      message: `daily config ${p}: ${REQUIRED}; ${unknown('a')}`,
    });
  });
});

test('two unknown keys give exactly three errors, all shown', () => {
  withConfig('bad2.json', keysObject(['a', 'b']), (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'Error',
      message: `daily config ${p}: ${REQUIRED}; ${unknown('a')}; ${unknown('b')}`,
    });
  });
});

test('three unknown keys give four errors but only the first three are shown', () => {
  withConfig('bad3.json', keysObject(['a', 'b', 'c']), (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'Error',
      message: `daily config ${p}: ${REQUIRED}; ${unknown('a')}; ${unknown('b')}`,
    });
  });
});

test('many unknown keys still show only the first three errors', () => {
  withConfig('bad5.json', keysObject(['a', 'b', 'c', 'd', 'e']), (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'Error',
      message: `daily config ${p}: ${REQUIRED}; ${unknown('a')}; ${unknown('b')}`,
    });
  });
});

test('with no argument the path comes from CW_DAILY_CONFIG', () => {
  withConfig('env.json', keysObject(['a']), (p) => {
    const prev = process.env.CW_DAILY_CONFIG;
    process.env.CW_DAILY_CONFIG = p;
    try {
      assert.throws(() => loadConfig(), {
        name: 'Error',
        message: `daily config ${p}: ${REQUIRED}; ${unknown('a')}`,
      });
    } finally {
      if (prev === undefined) delete process.env.CW_DAILY_CONFIG;
      else process.env.CW_DAILY_CONFIG = prev;
    }
  });
});

test('a missing config file throws the ENOENT error from reading it', () => {
  withConfig('missing.json', undefined, (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'Error',
      message: `ENOENT: no such file or directory, open '${p}'`,
    });
  });
});

test('a config file with invalid JSON throws a SyntaxError', () => {
  withConfig('invalid.json', '{ not json', (p) => {
    assert.throws(() => loadConfig(p), {
      name: 'SyntaxError',
      message: "Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    });
  });
});
