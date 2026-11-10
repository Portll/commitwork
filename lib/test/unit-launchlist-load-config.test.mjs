// Launchlist config parsed from config.json, or absent defaults when the file is missing (lib/launchlist.mjs loadConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withConfig(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadConfig-'));
  const prev = process.env.CW_LAUNCHLIST_DIR;
  try {
    process.env.CW_LAUNCHLIST_DIR = dir;
    const file = join(dir, 'config.json');
    if (content !== undefined) writeFileSync(file, content);
    fn(file);
  } finally {
    if (prev === undefined) delete process.env.CW_LAUNCHLIST_DIR;
    else process.env.CW_LAUNCHLIST_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const shapeMsg = (file) => `launchlist: ${file} must be an object with a projects map`;

test('a missing config file yields the absent default config', () => {
  withConfig(undefined, () => {
    assert.deepEqual(loadConfig(), { projects: {}, defaults: { profiles: ['publication'] }, absent: true });
  });
});

test('a config file containing JSON null yields the absent default config', () => {
  withConfig('null', () => {
    assert.deepEqual(loadConfig(), { projects: {}, defaults: { profiles: ['publication'] }, absent: true });
  });
});

test('a config that is a JSON array is rejected', () => {
  withConfig('[1,2]', (file) => {
    assert.throws(() => loadConfig(), { name: 'Error', message: shapeMsg(file) });
  });
});

test('a config that is a JSON number is rejected', () => {
  withConfig('5', (file) => {
    assert.throws(() => loadConfig(), { name: 'Error', message: shapeMsg(file) });
  });
});

test('a config whose projects is a string is rejected', () => {
  withConfig('{"projects":"x"}', (file) => {
    assert.throws(() => loadConfig(), { name: 'Error', message: shapeMsg(file) });
  });
});

test('a config whose projects is null gets an empty projects map', () => {
  withConfig('{"projects":null}', () => {
    assert.deepEqual(loadConfig(), { projects: {}, defaults: { profiles: ['publication'] }, accounts: {} });
  });
});

test('a config with projects defaults and accounts returns them unchanged', () => {
  const cfg = { projects: { a: 1 }, defaults: { profiles: ['x'] }, accounts: { b: 2 } };
  withConfig(JSON.stringify(cfg), () => {
    assert.deepEqual(loadConfig(), { projects: { a: 1 }, defaults: { profiles: ['x'] }, accounts: { b: 2 } });
  });
});

test('a config without defaults and accounts gets publication defaults and empty accounts', () => {
  withConfig('{"projects":{"a":1}}', () => {
    assert.deepEqual(loadConfig(), { projects: { a: 1 }, defaults: { profiles: ['publication'] }, accounts: {} });
  });
});

test('a config without projects gets an empty projects map and keeps its defaults', () => {
  withConfig('{"defaults":{"profiles":["y"]}}', () => {
    assert.deepEqual(loadConfig(), { projects: {}, defaults: { profiles: ['y'] }, accounts: {} });
  });
});

test('an empty object config gets empty maps and publication defaults', () => {
  withConfig('{}', () => {
    assert.deepEqual(loadConfig(), { projects: {}, defaults: { profiles: ['publication'] }, accounts: {} });
  });
});
