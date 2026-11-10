// Reads and parses the parent registry JSON or returns a read or parse error (bin/scanner-taxonomy-render.mjs loadParent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadParent } from '../scanner-taxonomy-render.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadParent-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

function withEnv(value, fn) {
  const saved = process.env.CW_TAXONOMY_JSON;
  if (value === undefined) delete process.env.CW_TAXONOMY_JSON;
  else process.env.CW_TAXONOMY_JSON = value;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.CW_TAXONOMY_JSON;
    else process.env.CW_TAXONOMY_JSON = saved;
  }
}

const readErr = (p, code) => `parentRegistry ${p} could not be read (${code}) \u2014 every inherits id cites into it, so nothing here can be reported valid without it`;

test('An existing valid JSON registry at an absolute path is parsed and returned with its path', () => {
  withDir((dir) => {
    const regPath = join(dir, 'parent.json');
    writeFileSync(regPath, JSON.stringify({ version: 1, items: [{ id: 'a' }] }), 'utf8');
    const r = withEnv(undefined, () => loadParent({ parentRegistry: regPath }, { repo: dir }));
    assert.deepEqual(r, { parent: { version: 1, items: [{ id: 'a' }] }, path: regPath });
  });
});

test('A relative parentRegistry is resolved against the repo option when the env var is unset', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    const regPath = join(dir, 'sub', 'reg.json');
    writeFileSync(regPath, JSON.stringify({ rel: true }), 'utf8');
    const r = withEnv(undefined, () => loadParent({ parentRegistry: join('sub', 'reg.json') }, { repo: dir }));
    assert.deepEqual(r, { parent: { rel: true }, path: regPath });
  });
});

test('A missing registry file yields a read error naming the ENOENT code', () => {
  withDir((dir) => {
    const missing = join(dir, 'nope.json');
    const r = withEnv(undefined, () => loadParent({ parentRegistry: missing }, { repo: dir }));
    assert.deepEqual(r, { error: readErr(missing, 'ENOENT') });
  });
});

test('A registry path that is a directory yields a read error naming the EISDIR code', () => {
  withDir((dir) => {
    const sub = join(dir, 'adir');
    mkdirSync(sub);
    const r = withEnv(undefined, () => loadParent({ parentRegistry: 'adir' }, { repo: dir }));
    assert.deepEqual(r, { error: readErr(sub, 'EISDIR') });
  });
});

test('A registry file with invalid JSON yields a parse error with the JSON message', () => {
  withDir((dir) => {
    const regPath = join(dir, 'bad.json');
    writeFileSync(regPath, '{not json', 'utf8');
    const r = withEnv(undefined, () => loadParent({ parentRegistry: regPath }, { repo: dir }));
    assert.deepEqual(r, { error: `parentRegistry ${regPath} is not valid JSON (Expected property name or '}' in JSON at position 1 (line 1 column 2))` });
  });
});

test('A set CW_TAXONOMY_JSON overrides parentRegistry and is read instead', () => {
  withDir((dir) => {
    const envPath = join(dir, 'env-reg.json');
    writeFileSync(envPath, JSON.stringify({ from: 'env' }), 'utf8');
    const r = withEnv(envPath, () => loadParent({ parentRegistry: 'ignored.json' }, { repo: dir }));
    assert.deepEqual(r, { parent: { from: 'env' }, path: envPath });
  });
});

test('An empty CW_TAXONOMY_JSON falls back to the resolved parentRegistry', () => {
  withDir((dir) => {
    const regPath = join(dir, 'fallback.json');
    writeFileSync(regPath, JSON.stringify({ n: Array.from({ length: 3 }, (_, i) => i) }), 'utf8');
    const r = withEnv('', () => loadParent({ parentRegistry: 'fallback.json' }, { repo: dir }));
    assert.deepEqual(r, { parent: { n: [0, 1, 2] }, path: regPath });
  });
});

test('A CW_TAXONOMY_JSON pointing at a missing file yields a read error for that env path', () => {
  withDir((dir) => {
    const envPath = join(dir, 'absent-env.json');
    writeFileSync(join(dir, 'present.json'), JSON.stringify({ ok: 1 }), 'utf8');
    const r = withEnv(envPath, () => loadParent({ parentRegistry: 'present.json' }, { repo: dir }));
    assert.deepEqual(r, { error: readErr(envPath, 'ENOENT') });
  });
});
