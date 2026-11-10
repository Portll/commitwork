// Loads the public manifest (and merges the private one when no path is given), returning a frozen union (lib/docsite-manifest.mjs loadManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../docsite-manifest.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the frozen public manifest when an explicit path is given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  try {
    const manifest = { version: 1, docs: [{ slug: 'a', urlPath: 'a', title: 'A', source: 'content/a.md', kind: 'md', state: 'published' }] };
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify(manifest));
    const result = loadManifest(p);
    assert.deepEqual(result, {
      version: 1,
      docs: [
        {
          slug: 'a',
          urlPath: 'a',
          title: 'A',
          source: 'content/a.md',
          kind: 'md',
          state: 'published'
        }
      ]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws ManifestError with code ABSENT when the manifest file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  try {
    const p = join(dir, 'missing.json');
    assert.throws(() => loadManifest(p), {
      name: 'Error',
      code: 'ABSENT',
      message: `no manifest at ${p}`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws ManifestError with code INVALID when the manifest is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    assert.throws(() => loadManifest(p), { name: "Error", message: "manifest is not JSON (Expected property name or '}' in JSON at position 2 (line 1 column 3)) \u2014 a broken manifest is not an empty one" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws ManifestError with code INVALID when the manifest fails validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  try {
    const p = join(dir, 'invalid.json');
    writeFileSync(p, JSON.stringify({ version: 2, docs: [] }));
    assert.throws(() => loadManifest(p), {
      name: 'Error',
      code: 'INVALID',
      message: `manifest invalid at ${p}:\n  version must be 1, got 2`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
