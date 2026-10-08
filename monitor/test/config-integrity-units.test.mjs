// monitor/test/config-integrity-units.test.mjs — case tests for surfaceTargets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { surfaceTargets } from '../config-integrity.mjs';

test('reads and returns targets from CW_CONFINT_TARGETS JSON file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'confint-'));
  const fixture = join(dir, 'targets.json');
  const data = [{ path: '/a/b.json', kind: 'config' }, { path: '/c/link', kind: 'symlink' }];
  writeFileSync(fixture, JSON.stringify(data));
  const prev = process.env.CW_CONFINT_TARGETS;
  process.env.CW_CONFINT_TARGETS = fixture;
  try {
    const result = surfaceTargets();
    assert.deepEqual(result, data);
  } finally {
    if (prev !== undefined) process.env.CW_CONFINT_TARGETS = prev;
    else delete process.env.CW_CONFINT_TARGETS;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when CW_CONFINT_TARGETS file contains non-array JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'confint-'));
  const fixture = join(dir, 'bad.json');
  writeFileSync(fixture, '{"not":"array"}');
  const prev = process.env.CW_CONFINT_TARGETS;
  process.env.CW_CONFINT_TARGETS = fixture;
  try {
    assert.throws(() => surfaceTargets(), /CW_CONFINT_TARGETS is not a JSON array/);
  } finally {
    if (prev !== undefined) process.env.CW_CONFINT_TARGETS = prev;
    else delete process.env.CW_CONFINT_TARGETS;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses provided home argument in default targets', () => {
  const prev = process.env.CW_CONFINT_TARGETS;
  delete process.env.CW_CONFINT_TARGETS;
  try {
    const result = surfaceTargets('/custom/home');
    const paths = result.map((t) => t.path);
    assert.ok(paths.includes(join('/custom/home', '.claude', 'settings.json')));
    assert.ok(paths.includes(join('/custom/home', '.commitwork', 'secrets.json')));
  } finally {
    if (prev !== undefined) process.env.CW_CONFINT_TARGETS = prev;
  }
});

test('returns empty array when CW_CONFINT_TARGETS is empty JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'confint-'));
  const fixture = join(dir, 'empty.json');
  writeFileSync(fixture, '[]');
  const prev = process.env.CW_CONFINT_TARGETS;
  process.env.CW_CONFINT_TARGETS = fixture;
  try {
    const result = surfaceTargets();
    assert.deepEqual(result, []);
  } finally {
    if (prev !== undefined) process.env.CW_CONFINT_TARGETS = prev;
    else delete process.env.CW_CONFINT_TARGETS;
    rmSync(dir, { recursive: true, force: true });
  }
});
