// Collects specific Bash permission grants from Claude settings files (monitor/agent-config-harden.mjs observedBashFromSettings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observedBashFromSettings } from '../agent-config-harden.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when no settings files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when settings file is invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), 'not valid json');
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when settings value is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), '"just a string"');
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when permissions is not an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: "not an object" }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns specific Bash grants from settings.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Bash(npm run test)', 'Bash(npm run build)'] }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, ["Bash(npm run build)", "Bash(npm run test)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns specific Bash grants from settings.local.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(npm run lint)'] }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, ["Bash(npm run lint)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('merges and deduplicates Bash grants from both settings files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Bash(npm run test)', 'Bash(npm run build)'] }
    }));
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(npm run test)', 'Bash(npm run lint)'] }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, ["Bash(npm run build)", "Bash(npm run lint)", "Bash(npm run test)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes broad Bash permissions from results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Bash(*)', 'Bash(npm run test)'] }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, ["Bash(npm run test)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes non-Bash permission entries from results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Read(./src)', 'Bash(npm run test)', 'Write(./out)'] }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, ["Bash(npm run test)"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when allow is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'observedBashFromSettings-'));
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      permissions: { allow: 'not an array' }
    }));
    const r = observedBashFromSettings(dir);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
