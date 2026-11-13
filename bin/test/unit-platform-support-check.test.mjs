// check returns drift messages comparing platform-support records against two docs (bin/platform-support.mjs check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, statementFor } from '../platform-support.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const sampleRecord = {
  platform: 'linux',
  measuredAt: '2024-01-01T00:00:00.000Z',
  headSha: 'abcdef1234567890',
  node: '20.0.0',
  pass: 10,
  fail: 0,
  skip: 2
};

const sampleStatement = statementFor(sampleRecord);

test('throws UNMEASURED when record file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = join(dir, 'reports', 'platform-support.json');
  try {
    assert.throws(() => check(), {
      name: 'Error',
      message: `no record at ${join(dir, 'reports', 'platform-support.json')} \u2014 nothing measured to check against`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('throws UNREADABLE when record file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(recordPath, 'not json');
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    assert.throws(() => check(), {
      name: 'Error',
      message: `record ${recordPath}: Unexpected token 'o', "not json" is not valid JSON`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('throws UNMEASURED when record file is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ records: [] }));
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    assert.throws(() => check(), {
      name: 'Error',
      message: `record ${recordPath} holds no measurement`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('throws UNMEASURED when record file is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ records: {} }));
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    assert.throws(() => check(), {
      name: 'Error',
      message: `record ${recordPath} holds no measurement`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('throws UNREADABLE when a doc file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ records: [sampleRecord] }));
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    assert.throws(() => check(), {
      name: 'Error',
      message: `doc ${join(dir, 'docs', 'SCOPE.md')}: ENOENT: no such file or directory, open '${join(dir, 'docs', 'SCOPE.md')}'`
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('returns drift for each record when doc files exist but have no statements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ records: [sampleRecord] }));
  writeFileSync(join(dir, 'docs', 'SCOPE.md'), '');
  writeFileSync(join(dir, 'docs', 'PLATFORM-SEAMS.md'), '');
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    const result = check();
    assert.deepEqual(result, [
      `docs/SCOPE.md: does not state "${sampleStatement}"`,
      `docs/PLATFORM-SEAMS.md: does not state "${sampleStatement}"`
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('returns drift for missing records when doc files have partial matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  const record2 = { ...sampleRecord, platform: 'windows', headSha: 'fedcba0987654321' };
  writeFileSync(recordPath, JSON.stringify({ records: [sampleRecord, record2] }));
  const statement2 = statementFor(record2);
  writeFileSync(join(dir, 'docs', 'SCOPE.md'), sampleStatement);
  writeFileSync(join(dir, 'docs', 'PLATFORM-SEAMS.md'), statement2);
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    const result = check();
    assert.deepEqual(result, [
      `docs/SCOPE.md: does not state "${statement2}"`,
      `docs/PLATFORM-SEAMS.md: does not state "${sampleStatement}"`
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});

test('returns empty array when doc files exactly match records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  const recordPath = join(dir, 'reports', 'platform-support.json');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(recordPath, JSON.stringify({ records: [sampleRecord] }));
  writeFileSync(join(dir, 'docs', 'SCOPE.md'), sampleStatement);
  writeFileSync(join(dir, 'docs', 'PLATFORM-SEAMS.md'), sampleStatement);
  process.env.CW_PLATFORM_SUPPORT_ROOT = dir;
  process.env.CW_PLATFORM_SUPPORT_RECORD = recordPath;
  try {
    const result = check();
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_PLATFORM_SUPPORT_ROOT;
    delete process.env.CW_PLATFORM_SUPPORT_RECORD;
  }
});
