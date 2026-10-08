// Maps each check in checks-status.json to its state, tool version string, and coverage note (monitor/daily.mjs laneStates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneStates } from '../daily.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty map when checks-status.json is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    const out = laneStates(dir);
    assert.equal(out.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a pass status to state ran with no tool version and no note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'lint', status: 'pass' }]));
    const out = laneStates(dir);
    assert.deepEqual(out.get('lint'), { state: 'ran', toolVersion: null, note: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a fail status to state failed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'test', status: 'fail' }]));
    const out = laneStates(dir);
    assert.equal(out.get('test').state, 'failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a noscan status to state void', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'scan', status: 'noscan' }]));
    const out = laneStates(dir);
    assert.equal(out.get('scan').state, 'void');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a skip status to state skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'build', status: 'skip' }]));
    const out = laneStates(dir);
    assert.equal(out.get('build').state, 'skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a timeout status to state timed-out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'deploy', status: 'timeout' }]));
    const out = laneStates(dir);
    assert.equal(out.get('deploy').state, 'timed-out');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps an unknown status to state void', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'mystery', status: 'weird' }]));
    const out = laneStates(dir);
    assert.equal(out.get('mystery').state, 'void');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builds toolVersion from tool-version file with version and commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'lint', status: 'pass' }]));
    writeFileSync(join(dir, 'tool-version-lint.json'), JSON.stringify({ tools: { eslint: { version: '8.0.0', commit: 'abcdef1234567' } } }));
    const out = laneStates(dir);
    assert.equal(out.get('lint').toolVersion, 'eslint@8.0.0+abcdef1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builds toolVersion with question mark when version is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'fmt', status: 'pass' }]));
    writeFileSync(join(dir, 'tool-version-fmt.json'), JSON.stringify({ tools: { prettier: { commit: '1234567890' } } }));
    const out = laneStates(dir);
    assert.equal(out.get('fmt').toolVersion, 'prettier@?+1234567');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets note from coverageReason truncated to 300 chars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneStates-'));
  try {
    const longReason = 'x'.repeat(350);
    writeFileSync(join(dir, 'checks-status.json'), JSON.stringify([{ check: 'cov', status: 'skip', coverageReason: longReason }]));
    const out = laneStates(dir);
    assert.equal(out.get('cov').note, 'x'.repeat(300));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
