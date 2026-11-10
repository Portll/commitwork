// Normalised scan config written to disk plus the check/tool delta and journal receipt (bin/lib/scan-config.mjs writeScanConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeScanConfig } from '../lib/scan-config.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'writeScanConfig-'));
  try { fn(dir, join(dir, 'scan-config.json')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const seed = (p, doc) => writeFileSync(p, `${JSON.stringify(doc)}\n`);
const receiptFor = (dir) => ({ ok: true, path: join(dir, 'scan-config.jsonl') });
function assertWritten(p, at, checks, tools) {
  assert.equal(readFileSync(p, 'utf8'), `${JSON.stringify({ version: 1, at, checks, tools }, null, 2)}\n`);
}

test('a first write over an absent file reports wasAbsent and a newly approved tool', () => inDir((dir, p) => {
  const tool = { approved: true, at: '2026-01-02T03:04:05.000Z', actor: 'ann', path: '/usr/bin/eslint' };
  const r = writeScanConfig({ checks: { lint: { enabled: true } }, tools: { eslint: tool } }, { path: p, dir });
  assert.deepEqual(r, {
    path: p, at: r.at, checksChanged: [], toolsChanged: [{ tool: 'eslint', from: false, to: true }],
    wasAbsent: true, receipt: receiptFor(dir),
  });
  assertWritten(p, r.at, { lint: { enabled: true } }, { eslint: tool });
}));

test('normalising coerces check flags and tool approvals and fills missing tool fields with null', () => inDir((dir, p) => {
  const next = { checks: { a: {}, b: { enabled: false }, c: null, d: { enabled: 0 } }, tools: { x: { approved: 'yes', extra: 1 }, y: null } };
  const r = writeScanConfig(next, { path: p, dir });
  assert.deepEqual(r, {
    path: p, at: r.at, checksChanged: [{ id: 'b', from: true, to: false }], toolsChanged: [],
    wasAbsent: true, receipt: receiptFor(dir),
  });
  const off = { approved: false, at: null, actor: null, path: null };
  assertWritten(p, r.at, { a: { enabled: true }, b: { enabled: false }, c: { enabled: true }, d: { enabled: true } }, { x: off, y: off });
}));

test('rewriting an identical existing config reports no changes and refreshes the timestamp', () => inDir((dir, p) => {
  seed(p, { version: 1, at: '2024-01-01T00:00:00.000Z', checks: { lint: { enabled: true } }, tools: { eslint: { approved: true } } });
  const r = writeScanConfig({ checks: { lint: { enabled: true } }, tools: { eslint: { approved: true } } }, { path: p, dir });
  assert.deepEqual(r, { path: p, at: r.at, checksChanged: [], toolsChanged: [], wasAbsent: false, receipt: receiptFor(dir) });
  assertWritten(p, r.at, { lint: { enabled: true } }, { eslint: { approved: true, at: null, actor: null, path: null } });
}));

test('changes in both directions are listed sorted by id and tool name, with missing entries taking defaults', () => inDir((dir, p) => {
  seed(p, { version: 1, checks: { zeta: { enabled: false }, alpha: { enabled: true } }, tools: { tsc: { approved: true }, biome: { approved: false } } });
  const next = { checks: { alpha: { enabled: false }, mid: { enabled: false } }, tools: { biome: { approved: true }, new: { approved: true } } };
  const r = writeScanConfig(next, { path: p, dir });
  assert.deepEqual(r, {
    path: p,
    at: r.at,
    checksChanged: [
      { id: 'alpha', from: true, to: false },
      { id: 'mid', from: true, to: false },
      { id: 'zeta', from: false, to: true },
    ],
    toolsChanged: [
      { tool: 'biome', from: false, to: true },
      { tool: 'new', from: false, to: true },
      { tool: 'tsc', from: true, to: false },
    ],
    wasAbsent: false,
    receipt: receiptFor(dir),
  });
  const on = { approved: true, at: null, actor: null, path: null };
  assertWritten(p, r.at, { alpha: { enabled: false }, mid: { enabled: false } }, { biome: on, new: on });
}));

test('non-object checks and tools in the existing file and an empty next config give an empty delta', () => inDir((dir, p) => {
  seed(p, { version: 1, checks: 'x', tools: 5 });
  const r = writeScanConfig({}, { path: p, dir });
  assert.deepEqual(r, { path: p, at: r.at, checksChanged: [], toolsChanged: [], wasAbsent: false, receipt: receiptFor(dir) });
  assertWritten(p, r.at, {}, {});
}));

test('an existing file whose version is not exactly 1 is rejected and left untouched', () => inDir((dir, p) => {
  for (const version of [2, 0, '1']) {
    seed(p, { version, checks: {}, tools: {} });
    const original = readFileSync(p, 'utf8');
    assert.throws(() => writeScanConfig({}, { path: p, dir }), { name: 'Error', message: `scan-config version ${version} is not one this build understands` });
    assert.equal(readFileSync(p, 'utf8'), original);
  }
}));

test('an existing file holding JSON that is not an object is rejected', () => inDir((dir, p) => {
  for (const raw of ['null', '7', 'false', '"str"']) {
    writeFileSync(p, raw);
    assert.throws(() => writeScanConfig({}, { path: p, dir }), { name: 'Error', message: 'scan-config is not an object' });
    assert.equal(readFileSync(p, 'utf8'), raw);
  }
}));

test('an existing file that is not valid JSON is reported as unreadable rather than absent', () => inDir((dir, p) => {
  writeFileSync(p, '{oops');
  let parseMessage;
  try { JSON.parse('{oops'); } catch (e) { parseMessage = e.message; }
  assert.throws(() => writeScanConfig({}, { path: p, dir }), {
    name: 'Error',
    message: `scan-config is unreadable, which is not the same as absent: ${parseMessage}`,
  });
  assert.equal(readFileSync(p, 'utf8'), '{oops');
}));

test('a read error other than a missing file is rethrown', () => inDir((dir, p) => {
  mkdirSync(p);
  assert.throws(() => writeScanConfig({}, { path: p, dir }), { name: 'Error', code: 'EISDIR' });
}));
