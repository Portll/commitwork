// Copies a candidate directory into the fixture root and records its provenance (bin/lane-fixture.mjs installFixture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFixture } from '../lane-fixture.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const NOTE = 'How each lane-capability fixture was produced. real: the lane\'s own tool ran over a seed project through `commitwork run`. synthetic: no real run produced an artifact, so a drafted artifact was accepted on the extractor\'s reading alone, which proves the parser and not the tool\'s output shape. Written by bin/lane-fixture.mjs.';

function withRoot(now, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'installFixture-'));
  const saved = { root: process.env.CW_LANE_FIXTURES, now: process.env.CW_NOW };
  process.env.CW_LANE_FIXTURES = dir;
  if (now === null) delete process.env.CW_NOW;
  else process.env.CW_NOW = now;
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (saved.root === undefined) delete process.env.CW_LANE_FIXTURES;
    else process.env.CW_LANE_FIXTURES = saved.root;
    if (saved.now === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = saved.now;
  }
}

function makeTree(root, files) {
  mkdirSync(root, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), body);
  }
  return root;
}

const readProv = (dir) => JSON.parse(readFileSync(join(dir, 'PROVENANCE.json'), 'utf8'));

test('refuses to overwrite a destination that already holds a file when replace is not passed', () => {
  withRoot('2024-01-15', (dir) => {
    const dest = makeTree(join(dir, 'alpha'), { 'old.txt': 'old' });
    const candidate = makeTree(join(dir, 'cand'), { 'new.txt': 'new' });
    assert.throws(() => installFixture({ category: 'alpha', candidate, source: 'real', check: 'ok', tools: [] }), { name: 'Error', message: `${dest} already holds a fixture; pass --replace to overwrite it` });
    assert.deepEqual(readdirSync(dest), ['old.txt']);
    assert.equal(existsSync(join(dir, 'PROVENANCE.json')), false);
  });
});

test('replaces a destination that already holds a file when replace is true', () => {
  withRoot('2024-01-15', (dir) => {
    const dest = makeTree(join(dir, 'beta'), { 'old.txt': 'old' });
    const candidate = makeTree(join(dir, 'cand'), { 'new.txt': 'new' });
    const r = installFixture({ category: 'beta', candidate, source: 'real', check: 'ok', tools: ['lint'] }, { replace: true });
    assert.equal(r, dest);
    assert.deepEqual(readdirSync(dest), ['new.txt']);
    assert.equal(readFileSync(join(dest, 'new.txt'), 'utf8'), 'new');
    assert.deepEqual(readProv(dir).lanes, { beta: { source: 'real', check: 'ok', tools: ['lint'], files: ['new.txt'], accepted: '2024-01-15' } });
  });
});

test('installs into a missing destination and starts provenance with the default note and every optional field', () => {
  withRoot('2024-01-15', (dir) => {
    const candidate = makeTree(join(dir, 'cand'), { 'b.txt': 'b', 'a.txt': 'a' });
    const result = { category: 'epsilon', candidate, source: 'synthetic', blocker: 'no tool', pruned: ['x'], check: 'ok', tools: ['t1'] };
    assert.equal(installFixture(result, { draftedBy: 'alice' }), join(dir, 'epsilon'));
    assert.deepEqual(readProv(dir), { note: NOTE, lanes: { epsilon: { source: 'synthetic', why: 'no tool', pruned: ['x'], check: 'ok', tools: ['t1'], files: ['a.txt', 'b.txt'], draftedBy: 'alice', accepted: '2024-01-15' } } });
    assert.deepEqual(readdirSync(dir).sort(), ['PROVENANCE.json', 'cand', 'epsilon']);
  });
});

test('installs into an empty destination without replace and dates the lane today when CW_NOW is unset', () => {
  withRoot(null, (dir) => {
    const dest = makeTree(join(dir, 'delta'), {});
    const candidate = makeTree(join(dir, 'cand'), { 'file.txt': 'content' });
    const today = new Date().toISOString().slice(0, 10);
    const result = { category: 'delta', candidate, source: 'real', blocker: '', pruned: null, check: 'ok', tools: [] };
    assert.equal(installFixture(result, { draftedBy: '' }), dest);
    assert.equal(readFileSync(join(dest, 'file.txt'), 'utf8'), 'content');
    assert.deepEqual(readProv(dir), { note: NOTE, lanes: { delta: { source: 'real', check: 'ok', tools: [], files: ['file.txt'], accepted: today } } });
  });
});

test('clears a stale staging directory before copying the candidate', () => {
  withRoot('2024-02-02', (dir) => {
    const stage = makeTree(`${join(dir, 'stage')}.tmp-${process.pid}`, { 'stale.txt': 'stale' });
    const candidate = makeTree(join(dir, 'cand'), { 'fresh.txt': 'fresh' });
    assert.equal(installFixture({ category: 'stage', candidate, source: 'real', check: 'ok', tools: [] }), join(dir, 'stage'));
    assert.deepEqual(readdirSync(join(dir, 'stage')), ['fresh.txt']);
    assert.equal(existsSync(stage), false);
    assert.deepEqual(readProv(dir).lanes.stage.files, ['fresh.txt']);
  });
});

test('keeps existing provenance lanes, overwrites the same lane, and sorts lane names alphabetically', () => {
  withRoot('2024-06-01', (dir) => {
    const old = { source: 'real', check: 'ok', tools: [], files: [], accepted: '2024-05-01' };
    writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify({ note: 'n', lanes: { zeta: old, mid: { source: 'stale' }, alpha: old } }));
    const candidate = makeTree(join(dir, 'cand'), { 'm.txt': 'm' });
    assert.equal(installFixture({ category: 'mid', candidate, source: 'real', check: 'ok', tools: [] }), join(dir, 'mid'));
    const prov = readProv(dir);
    assert.deepEqual(Object.keys(prov.lanes), ['alpha', 'mid', 'zeta']);
    assert.deepEqual(prov, { note: 'n', lanes: { alpha: old, mid: { source: 'real', check: 'ok', tools: [], files: ['m.txt'], accepted: '2024-06-01' }, zeta: old } });
    assert.equal(readFileSync(join(dir, 'PROVENANCE.json'), 'utf8'), JSON.stringify(prov, null, 1) + '\n');
  });
});

test('rethrows a provenance read error other than a missing file', () => {
  withRoot('2024-06-01', (dir) => {
    writeFileSync(join(dir, 'PROVENANCE.json'), '{not json');
    const candidate = makeTree(join(dir, 'cand'), { 'k.txt': 'k' });
    assert.throws(() => installFixture({ category: 'kappa', candidate, source: 'real', check: 'ok', tools: [] }), { name: 'SyntaxError' });
    assert.equal(readFileSync(join(dir, 'PROVENANCE.json'), 'utf8'), '{not json');
    assert.deepEqual(readdirSync(join(dir, 'kappa')), ['k.txt']);
  });
});

test('copies nested candidate directories and lists only top-level entries in provenance', () => {
  withRoot('2024-03-10', (dir) => {
    const candidate = makeTree(join(dir, 'cand'), { 'top.txt': 'top', 'sub/deep.txt': 'deep' });
    assert.equal(installFixture({ category: 'nested', candidate, source: 'real', check: 'ok', tools: ['t'] }), join(dir, 'nested'));
    assert.equal(readFileSync(join(dir, 'nested', 'sub', 'deep.txt'), 'utf8'), 'deep');
    assert.deepEqual(readProv(dir).lanes.nested.files, ['sub', 'top.txt']);
  });
});
