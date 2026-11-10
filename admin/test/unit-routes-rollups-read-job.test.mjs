// Reads a launchd plist and reports its scheduling state (admin/routes/rollups.mjs readJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJob } from '../routes/rollups.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent when the plist file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const r = readJob('nope', dir);
    assert.deepEqual(r, { state: 'absent', label: 'nope' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns disabled when the plist contains a Disabled true key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    writeFileSync(join(dir, 'd.plist'), '<key>Disabled</key><true/>');
    const r = readJob('d', dir);
    assert.deepEqual(r, { state: 'disabled', label: 'd' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns scheduled with intervals when a StartCalendarInterval array is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const xml = '<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict></array>';
    writeFileSync(join(dir, 's.plist'), xml);
    const r = readJob('s', dir);
    assert.deepEqual(r, { state: 'scheduled', label: 's', intervals: [{ Hour: 9, Minute: 30 }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unscheduled when no StartCalendarInterval key is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    writeFileSync(join(dir, 'u.plist'), '<key>Program</key><string>/bin/true</string>');
    const r = readJob('u', dir);
    assert.deepEqual(r, { state: 'unscheduled', label: 'u' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns scheduled with multiple interval dicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const xml = '<key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>1</integer></dict><dict><key>Hour</key><integer>2</integer></dict></array>';
    writeFileSync(join(dir, 'm.plist'), xml);
    const r = readJob('m', dir);
    assert.deepEqual(r, { state: 'scheduled', label: 'm', intervals: [{ Hour: 1 }, { Hour: 2 }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unscheduled when StartCalendarInterval is present but has no dict entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const xml = '<key>StartCalendarInterval</key><array></array>';
    writeFileSync(join(dir, 'e.plist'), xml);
    const r = readJob('e', dir);
    assert.deepEqual(r, { state: 'unscheduled', label: 'e' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns disabled even when a calendar interval is also present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const xml = '<key>Disabled</key><true/><key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>5</integer></dict></array>';
    writeFileSync(join(dir, 'x.plist'), xml);
    const r = readJob('x', dir);
    assert.deepEqual(r, { state: 'disabled', label: 'x' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns scheduled with Day and Weekday fields parsed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readJob-'));
  try {
    const xml = '<key>StartCalendarInterval</key><array><dict><key>Day</key><integer>1</integer><key>Weekday</key><integer>0</integer></dict></array>';
    writeFileSync(join(dir, 'w.plist'), xml);
    const r = readJob('w', dir);
    assert.deepEqual(r, { state: 'scheduled', label: 'w', intervals: [{ Day: 1, Weekday: 0 }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
