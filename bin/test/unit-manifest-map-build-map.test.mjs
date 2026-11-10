// Maps a manifest's checks into id, group, tool, and trigger indexes with line numbers. (bin/manifest-map.mjs buildMap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../manifest-map.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('buildMap returns empty indexes when manifest has no checks or groups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [], groups: {} }));
    const r = buildMap(p);
    assert.equal(r.generatedBy, 'bin/manifest-map.mjs');
    assert.equal(r.manifest, 'manifest');
    assert.equal(r.manifestLines, 1);
    assert.equal(r.checkCount, 0);
    assert.deepEqual(r.byId, {});
    assert.deepEqual(r.byGroup, {});
    assert.deepEqual(r.byTool, {});
    assert.deepEqual(r.byTrigger, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap records a check with no gates as universal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [{ id: 'a', description: 'desc a' }],
      groups: {}
    }));
    const r = buildMap(p);
    assert.equal(r.checkCount, 1);
    assert.equal(r.manifestLines, 1);
    const a = r.byId.a;
    assert.equal(a.line, 1);
    assert.equal(a.description, 'desc a');
    assert.deepEqual(a.groups, []);
    assert.deepEqual(a.tools, []);
    assert.equal(a.docker, false);
    assert.deepEqual(a.appliesIfExists, []);
    assert.deepEqual(a.appliesIfSourceExt, []);
    assert.equal(a.appliesIfGit, false);
    assert.equal(a.requiresUrl, false);
    assert.equal(a.report, null);
    assert.equal(a.timeoutSec, null);
    assert.equal(a.universal, true);
    assert.deepEqual(r.byGroup, {});
    assert.deepEqual(r.byTool, {});
    assert.deepEqual(r.byTrigger, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap finds the id line number from raw text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    const text = [
      '{',
      '  "checks": [',
      '    {',
      '      "id": "b",',
      '      "description": "x"',
      '    }',
      '  ]',
      '}'
    ].join('\n');
    writeFileSync(p, text);
    const r = buildMap(p);
    assert.equal(r.manifestLines, 8);
    assert.equal(r.byId.b.line, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap unions group membership from top-level groups and check tags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [
        { id: 'a', groups: ['g2'] },
        { id: 'b' },
        { id: 'c', groups: ['g1', 'g2'] }
      ],
      groups: {
        g1: ['a', 'b'],
        g2: ['b']
      }
    }));
    const r = buildMap(p);
    assert.deepEqual(r.byGroup, { g1: ['a', 'b', 'c'], g2: ['a', 'b', 'c'] });
    assert.deepEqual(r.byId.a.groups, ['g1', 'g2']);
    assert.deepEqual(r.byId.b.groups, ['g1', 'g2']);
    assert.deepEqual(r.byId.c.groups, ['g1', 'g2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap indexes tools and triggers from check fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [
        { id: 'a', requires: { tools: ['eslint', 'prettier'] }, appliesIfExists: ['package.json'], appliesIfSourceExt: ['.js'] },
        { id: 'b', requires: { tools: ['eslint'] }, appliesIfExists: ['package.json'] }
      ],
      groups: {}
    }));
    const r = buildMap(p);
    assert.deepEqual(r.byTool, { eslint: ['a', 'b'], prettier: ['a'] });
    assert.deepEqual(r.byTrigger, { 'package.json': ['a', 'b'], '.js': ['a'] });
    assert.deepEqual(r.byId.a.tools, ['eslint', 'prettier']);
    assert.deepEqual(r.byId.a.appliesIfExists, ['package.json']);
    assert.deepEqual(r.byId.a.appliesIfSourceExt, ['.js']);
    assert.equal(r.byId.a.universal, false);
    assert.deepEqual(r.byId.b.tools, ['eslint']);
    assert.deepEqual(r.byId.b.appliesIfExists, ['package.json']);
    assert.deepEqual(r.byId.b.appliesIfSourceExt, []);
    assert.equal(r.byId.b.universal, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap records docker, git, url, report, and timeout fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [
        { id: 'a', requires: { docker: true }, appliesIfGit: true, requiresUrl: true, report: { format: 'junit' }, timeoutSec: 30 }
      ],
      groups: {}
    }));
    const r = buildMap(p);
    const a = r.byId.a;
    assert.equal(a.docker, true);
    assert.equal(a.appliesIfGit, true);
    assert.equal(a.requiresUrl, true);
    assert.equal(a.report, 'junit');
    assert.equal(a.timeoutSec, 30);
    assert.equal(a.universal, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap sets universal false when only source ext gate is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [
        { id: 'a', appliesIfSourceExt: ['.py'] }
      ],
      groups: {}
    }));
    const r = buildMap(p);
    assert.equal(r.byId.a.universal, false);
    assert.deepEqual(r.byId.a.appliesIfSourceExt, ['.py']);
    assert.deepEqual(r.byId.a.appliesIfExists, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap handles missing checks array as empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({ groups: { g: ['x'] } }));
    const r = buildMap(p);
    assert.equal(r.checkCount, 0);
    assert.deepEqual(r.byId, {});
    assert.deepEqual(r.byGroup, { g: ['x'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap sorts byId keys alphabetically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, JSON.stringify({
      checks: [
        { id: 'z' },
        { id: 'a' },
        { id: 'm' }
      ],
      groups: {}
    }));
    const r = buildMap(p);
    assert.deepEqual(Object.keys(r.byId), ['a', 'm', 'z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildMap strips .json from manifest name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildMap-'));
  try {
    const p = join(dir, 'my-manifest.json');
    writeFileSync(p, JSON.stringify({ checks: [], groups: {} }));
    const r = buildMap(p);
    assert.equal(r.manifest, 'my-manifest');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
