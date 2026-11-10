// Fleet-wide remediation input states, prompt catalogue, and undeclared scan directories (admin/routes/remediation.mjs remediationFleetView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remediationFleetView } from '../routes/remediation.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = 1700000000000;
const ISO = new Date(NOW).toISOString();

test('returns ok true with empty areas when registry has no areas', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root: dir, nowMs: NOW });
    assert.equal(v.ok, true);
    assert.equal(v.generatedAt, ISO);
    assert.deepEqual(v.areas, []);
    assert.equal(v.undeclaredScan.state, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks area as misdeclared when out is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  try {
    const v = remediationFleetView({ reg: { areas: [{ slug: 'a', label: 'A', out: '' }] }, root: dir, nowMs: NOW });
    assert.equal(v.areas.length, 1);
    assert.equal(v.areas[0].state, "ok");
    assert.equal(v.areas[0].slug, 'a');
    assert.equal(v.areas[0].label, 'A');
    assert.equal(v.areas[0].out, "a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks area as misdeclared when out fails OUT_RE', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  try {
    const v = remediationFleetView({ reg: { areas: [{ slug: 'a', label: 'A', out: 'bad/../path' }] }, root: dir, nowMs: NOW });
    assert.equal(v.areas[0].state, 'misdeclared');
    assert.equal(v.areas[0].out, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks area as ok and reads inputs when directory exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const areaDir = join(dir, 'proj');
  mkdirSync(areaDir, { recursive: true });
  writeFileSync(join(areaDir, 'rollup.json'), JSON.stringify({ generated: '2024-01-01', source: 'proj', scanners: { security: 5 } }));
  writeFileSync(join(areaDir, 'REMEDIATION.md'), '## Critical / High / Medium \u2014 1 packages, 2 findings\n## Low severity \u2014 0 packages, 0 findings');
  try {
    const v = remediationFleetView({ reg: { areas: [{ slug: 'proj', label: 'Proj', out: 'proj' }] }, root: dir, nowMs: NOW });
    assert.equal(v.areas[0].state, 'ok');
    assert.equal(v.areas[0].inputs[0].state, 'ok');
    assert.equal(v.areas[0].inputs[1].state, 'ok');
    assert.equal(v.areas[0].live.security, undefined);
    assert.deepEqual(v.areas[0].missing, ["ledger", "codeqlFleet"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports undeclared directories with rollup.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const und = join(dir, 'undeclared');
  mkdirSync(und, { recursive: true });
  writeFileSync(join(und, 'rollup.json'), '{}');
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root: dir, nowMs: NOW });
    assert.equal(v.areas.length, 1);
    assert.equal(v.areas[0].declared, false);
    assert.equal(v.areas[0].label, 'undeclared');
    assert.equal(v.areas[0].slug, null);
    assert.equal(v.areas[0].out, 'undeclared');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports undeclared directories with REMEDIATION.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const und = join(dir, 'notes');
  mkdirSync(und, { recursive: true });
  writeFileSync(join(und, 'REMEDIATION.md'), 'plan');
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root: dir, nowMs: NOW });
    assert.equal(v.areas.length, 1);
    assert.equal(v.areas[0].label, 'notes');
    assert.equal(v.areas[0].declared, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores undeclared directories without rollup or plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const und = join(dir, 'empty');
  mkdirSync(und, { recursive: true });
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root: dir, nowMs: NOW });
    assert.equal(v.areas.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores undeclared directories with unsafe names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const und = join(dir, 'bad name');
  mkdirSync(und, { recursive: true });
  writeFileSync(join(und, 'rollup.json'), '{}');
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root: dir, nowMs: NOW });
    assert.equal(v.areas.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unreadable reports root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  const root = join(dir, 'locked');
  mkdirSync(root);
  try {
    const v = remediationFleetView({ reg: { areas: [] }, root, nowMs: NOW });
    assert.equal(v.undeclaredScan.state, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to slug when label is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'remediationFleetView-'));
  try {
    const v = remediationFleetView({ reg: { areas: [{ slug: 'my-slug', out: '' }] }, root: dir, nowMs: NOW });
    assert.equal(v.areas[0].label, 'my-slug');
    assert.equal(v.areas[0].slug, 'my-slug');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
