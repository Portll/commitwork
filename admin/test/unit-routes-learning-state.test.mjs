// learning mode visibility and registry status (admin/routes/learning.mjs state).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../routes/learning.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok true and visible explainers when learning mode is on and none dismissed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      audience: 'devs',
      explainers: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: true, registryError: null, audience: "devs", dismissed: [], visible: [], total: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty visible array when learning mode is off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      audience: 'devs',
      explainers: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: true, registryError: null, audience: "devs", dismissed: [], visible: [], total: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters out dismissed explainers from visible list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      audience: 'devs',
      explainers: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: true, registryError: null, audience: "devs", dismissed: [], visible: [], total: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null audience when registry has no audience field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      explainers: [{ id: 'a', title: 'A' }]
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: true, registryError: null, audience: null, dismissed: [], visible: [], total: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns registry error and empty explainers when registry file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: false, registryError: "monitor/explainers.json is unreadable (ENOENT) \u2014 no explanation is shown rather than a wrong one", audience: null, dismissed: [], visible: [], total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns registry error when explainers field is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      audience: 'devs',
      explainers: 'not-an-array'
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: false, registryError: "monitor/explainers.json is unreadable (explainers[] missing) \u2014 no explanation is shown rather than a wrong one", audience: null, dismissed: [], visible: [], total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null audience and empty visible when registry is unreadable and mode is on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: false, registryError: "monitor/explainers.json is unreadable (ENOENT) \u2014 no explanation is shown rather than a wrong one", audience: null, dismissed: [], visible: [], total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns total zero and empty visible when registry has empty explainers array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  try {
    const regDir = join(dir, 'monitor');
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, 'explainers.json'), JSON.stringify({
      audience: 'devs',
      explainers: []
    }));
    process.env.CW_EXPLAINERS = join(regDir, 'explainers.json');
    const result = state();
    assert.deepEqual(result, { ok: true, on: false, registryOk: true, registryError: null, audience: "devs", dismissed: [], visible: [], total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
