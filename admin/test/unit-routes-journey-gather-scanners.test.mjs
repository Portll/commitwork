// Computes the state of each scanner tool required by the security baseline (admin/routes/journey.mjs gatherScanners).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherScanners } from '../routes/journey.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherScanners-'));
  const baseline = join(dir, 'baseline.json');
  const catalog = join(dir, 'catalog.json');
  const binDir = join(dir, 'bin');
  mkdirSync(binDir);
  process.env.CW_BASELINE_MANIFEST = baseline;
  process.env.CW_INSTALL_CATALOG = catalog;
  process.env.CW_JOURNEY_INSTALL_DIRS = binDir;
  return { dir, baseline, catalog, binDir };
};

const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test('returns unreadable error when baseline file is missing', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(catalog, JSON.stringify({ tools: {} }));
    const result = gatherScanners();
    assert.equal(result.unreadable, `${baseline}: ENOENT`);
    assert.deepEqual(result.tools, []);
  } finally {
    cleanup(dir);
  }
});

test('returns empty tools array when baseline has no checks', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(baseline, JSON.stringify({ checks: [] }));
    writeFileSync(catalog, JSON.stringify({ tools: {} }));
    const result = gatherScanners();
    assert.deepEqual(result.tools, []);
    assert.equal(result.catalogUnreadable, null);
  } finally {
    cleanup(dir);
  }
});

test('marks tool as missing when not found on path or in install dirs', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'c1', requires: { tools: ['nonexistent-tool'] } }] }));
    writeFileSync(catalog, JSON.stringify({ tools: { 'nonexistent-tool': { requiresAccount: true } } }));
    const result = gatherScanners();
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'nonexistent-tool');
    assert.equal(result.tools[0].state, 'missing');
    assert.equal(result.tools[0].at, null);
    assert.deepEqual(result.tools[0].blocks, ['c1']);
    assert.equal(result.tools[0].requiresAccount, true);
  } finally {
    cleanup(dir);
  }
});

test('marks tool as installed-not-on-path when found in install dirs but not on PATH', () => {
  const { dir, baseline, catalog, binDir } = setup();
  try {
    const toolPath = join(binDir, 'mytool');
    writeFileSync(toolPath, '#!/bin/sh\n');
    chmodSync(toolPath, 0o755);
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'c1', requires: { tools: ['mytool'] } }] }));
    writeFileSync(catalog, JSON.stringify({ tools: {} }));
    const result = gatherScanners();
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'mytool');
    assert.equal(result.tools[0].state, 'installed-not-on-path');
    assert.equal(result.tools[0].at, toolPath);
    assert.deepEqual(result.tools[0].blocks, ['c1']);
    assert.equal(result.tools[0].requiresAccount, null);
  } finally {
    cleanup(dir);
  }
});

test('marks tool as present when found on PATH', () => {
  const { dir, baseline, catalog, binDir } = setup();
  try {
    const toolPath = join(binDir, 'present-tool');
    writeFileSync(toolPath, '#!/bin/sh\n');
    chmodSync(toolPath, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = binDir + ':' + oldPath;
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'c1', requires: { tools: ['present-tool'] } }] }));
    writeFileSync(catalog, JSON.stringify({ tools: { 'present-tool': { requiresAccount: false } } }));
    const result = gatherScanners();
    process.env.PATH = oldPath;
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'present-tool');
    assert.equal(result.tools[0].state, 'present');
    assert.equal(result.tools[0].at, toolPath);
    assert.deepEqual(result.tools[0].blocks, ['c1']);
    assert.equal(result.tools[0].requiresAccount, null);
  } finally {
    cleanup(dir);
  }
});

test('sets catalogUnreadable when catalog file is missing', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(baseline, JSON.stringify({ checks: [{ id: 'c1', requires: { tools: ['tool1'] } }] }));
    const result = gatherScanners();
    assert.equal(result.catalogUnreadable, `${catalog}: ENOENT`);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].requiresAccount, null);
  } finally {
    cleanup(dir);
  }
});

test('aggregates multiple checks requiring the same tool into blocks array', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(baseline, JSON.stringify({ checks: [
      { id: 'c1', requires: { tools: ['shared-tool'] } },
      { id: 'c2', requires: { tools: ['shared-tool', 'other-tool'] } },
      { id: 'c3', requires: { tools: ['shared-tool'] } }
    ] }));
    writeFileSync(catalog, JSON.stringify({ tools: {} }));
    const result = gatherScanners();
    const shared = result.tools.find(t => t.name === 'shared-tool');
    const other = result.tools.find(t => t.name === 'other-tool');
    assert.deepEqual(shared.blocks, ['c1', 'c2', 'c3']);
    assert.deepEqual(other.blocks, ['c2']);
    assert.equal(result.tools.length, 2);
  } finally {
    cleanup(dir);
  }
});

test('sorts tools alphabetically by name', () => {
  const { dir, baseline, catalog } = setup();
  try {
    writeFileSync(baseline, JSON.stringify({ checks: [
      { id: 'c1', requires: { tools: ['zeta'] } },
      { id: 'c2', requires: { tools: ['alpha'] } },
      { id: 'c3', requires: { tools: ['mid'] } }
    ] }));
    writeFileSync(catalog, JSON.stringify({ tools: {} }));
    const result = gatherScanners();
    assert.deepEqual(result.tools.map(t => t.name), ['alpha', 'mid', 'zeta']);
  } finally {
    cleanup(dir);
  }
});
