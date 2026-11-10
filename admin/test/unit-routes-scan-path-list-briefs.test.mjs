// Lists the most recent brief run directories with their metadata (admin/routes/scan-path.mjs listBriefs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listBriefs } from '../routes/scan-path.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'listBriefs-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns empty briefs when directory does not exist', () => {
  const { dir, cleanup } = setup();
  try {
    const missing = join(dir, 'no-such-dir');
    const res = listBriefs(missing);
    assert.deepEqual(res, { ok: true, briefs: [], total: 0 });
  } finally { cleanup(); }
});

test('returns error when directory is not readable', () => {
  const { dir, cleanup } = setup();
  try {
    const file = join(dir, 'afile');
    writeFileSync(file, 'x');
    const res = listBriefs(file);
    assert.equal(res.ok, false);
    assert.match(res.error, /could not be read/);
  } finally { cleanup(); }
});

test('returns empty briefs when directory has no valid run subdirectories', () => {
  const { dir, cleanup } = setup();
  try {
    mkdirSync(join(dir, 'invalid name'));
    mkdirSync(join(dir, 'valid-run'));
    const res = listBriefs(dir);
    assert.deepEqual(res, { ok: true, briefs: [], total: 0 });
  } finally { cleanup(); }
});

test('returns brief with metadata when brief.json exists and is valid', () => {
  const { dir, cleanup } = setup();
  try {
    const runDir = join(dir, 'run1');
    mkdirSync(runDir);
    const brief = { generatedAt: '2024-01-01T00:00:00Z', target: { mode: 'full', root: '/repo' }, counts: { files: 10 } };
    writeFileSync(join(runDir, 'brief.json'), JSON.stringify(brief));
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 1);
    assert.equal(res.briefs.length, 1);
    assert.equal(res.briefs[0].id, 'run1');
    assert.equal(res.briefs[0].generatedAt, '2024-01-01T00:00:00Z');
    assert.deepEqual(res.briefs[0].target, { mode: 'full', root: '/repo' });
    assert.deepEqual(res.briefs[0].counts, { files: 10 });
  } finally { cleanup(); }
});

test('returns brief with null fields when brief.json has missing optional fields', () => {
  const { dir, cleanup } = setup();
  try {
    const runDir = join(dir, 'run2');
    mkdirSync(runDir);
    writeFileSync(join(runDir, 'brief.json'), JSON.stringify({}));
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 1);
    assert.equal(res.briefs[0].id, 'run2');
    assert.equal(res.briefs[0].generatedAt, null);
    assert.equal(res.briefs[0].target, null);
    assert.equal(res.briefs[0].counts, null);
  } finally { cleanup(); }
});

test('returns error for brief when brief.json is invalid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const runDir = join(dir, 'run3');
    mkdirSync(runDir);
    writeFileSync(join(runDir, 'brief.json'), 'not valid json');
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 1);
    assert.equal(res.briefs[0].id, 'run3');
    assert.match(res.briefs[0].error, /could not be read/);
  } finally { cleanup(); }
});

test('returns empty briefs when run directory exists but brief.json is missing', () => {
  const { dir, cleanup } = setup();
  try {
    const runDir = join(dir, 'run4');
    mkdirSync(runDir);
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 0);
    assert.equal(res.briefs.length, 0);
  } finally { cleanup(); }
});

test('sorts briefs by mtime descending then by id descending', () => {
  const { dir, cleanup } = setup();
  try {
    const ids = ['a', 'b', 'c'];
    const mtimes = [1000, 3000, 2000];
    ids.forEach((id, i) => {
      const runDir = join(dir, id);
      mkdirSync(runDir);
      const brief = { generatedAt: `t${i}`, target: null, counts: null };
      writeFileSync(join(runDir, 'brief.json'), JSON.stringify(brief));
      utimesSync(join(runDir, 'brief.json'), mtimes[i] / 1000, mtimes[i] / 1000);
    });
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 3);
    assert.deepEqual(res.briefs.map(b => b.id), ['b', 'c', 'a']);
  } finally { cleanup(); }
});

test('limits results to 20 briefs when more exist', () => {
  const { dir, cleanup } = setup();
  try {
    for (let i = 0; i < 25; i++) {
      const id = `run${String(i).padStart(2, '0')}`;
      const runDir = join(dir, id);
      mkdirSync(runDir);
      const brief = { generatedAt: `t${i}`, target: null, counts: null };
      writeFileSync(join(runDir, 'brief.json'), JSON.stringify(brief));
      utimesSync(join(runDir, 'brief.json'), (1000 + i * 100) / 1000, (1000 + i * 100) / 1000);
    }
    const res = listBriefs(dir);
    assert.equal(res.ok, true);
    assert.equal(res.total, 25);
    assert.equal(res.briefs.length, 20);
    assert.equal(res.briefs[0].id, 'run24');
    assert.equal(res.briefs[19].id, 'run05');
  } finally { cleanup(); }
});
