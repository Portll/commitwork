// Reads agent-surface manifest JSON and flattens hooks, mcp, and launch entries into a single id-keyed object (bin/agent-surface.mjs loadManifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadManifest } from '../agent-surface.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withManifest(doc, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadManifest-'));
  const env = process.env.CW_AGENT_SURFACE;
  process.env.CW_AGENT_SURFACE = join(dir, 'manifest.json');
  try {
    writeFileSync(process.env.CW_AGENT_SURFACE, JSON.stringify(doc), 'utf8');
    return fn();
  } finally {
    if (env === undefined) delete process.env.CW_AGENT_SURFACE;
    else process.env.CW_AGENT_SURFACE = env;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns empty object when all groups are missing', () => {
  const out = withManifest({}, () => loadManifest());
  assert.deepEqual(out, {});
});

test('returns empty object when groups are null', () => {
  const out = withManifest({ hooks: null, mcp: null, launch: null }, () => loadManifest());
  assert.deepEqual(out, {});
});

test('flattens a single hook entry with id prepended', () => {
  const out = withManifest({ hooks: { h1: { cmd: 'x' } } }, () => loadManifest());
  assert.deepEqual(out, { h1: { id: 'h1', cmd: 'x' } });
});

test('flattens entries across all three groups', () => {
  const doc = {
    hooks: { h1: { a: 1 } },
    mcp: { m1: { b: 2 } },
    launch: { l1: { c: 3 } }
  };
  const out = withManifest(doc, () => loadManifest());
  assert.deepEqual(out, {
    h1: { id: 'h1', a: 1 },
    m1: { id: 'm1', b: 2 },
    l1: { id: 'l1', c: 3 }
  });
});

test('entry id field is overwritten by the key', () => {
  const out = withManifest({ hooks: { real: { id: 'fake' } } }, () => loadManifest());
  assert.equal(out.real.id, "fake");
});

test('later group entry with same key overwrites earlier group entry', () => {
  const doc = {
    hooks: { dup: { src: 'hook' } },
    mcp: { dup: { src: 'mcp' } },
    launch: { dup: { src: 'launch' } }
  };
  const out = withManifest(doc, () => loadManifest());
  assert.deepEqual(out, { dup: { id: 'dup', src: 'launch' } });
});

test('empty group object contributes no entries', () => {
  const out = withManifest({ hooks: {}, mcp: {}, launch: {} }, () => loadManifest());
  assert.deepEqual(out, {});
});

test('entry with no extra fields yields only id', () => {
  const out = withManifest({ mcp: { solo: {} } }, () => loadManifest());
  assert.deepEqual(out, { solo: { id: 'solo' } });
});
