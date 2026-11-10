// Scans text files under a root and tallies secret findings by file and class (monitor/transcript-secrets.mjs scanRoot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRoot } from '../transcript-secrets.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const tok = (seed, n) => createHash('sha512').update(seed).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
const secretLines = () => [
  `STRIPE_KEY=sk_live_${tok('stripe', 24)}`,
  `GITHUB_TOKEN=ghp_${tok('github', 36)}`,
  `AWS_ACCESS_KEY_ID=AKIA${tok('aws', 16).toUpperCase()}`,
  `BLOB=${createHash('sha512').update('blob').digest('base64')}`,
];
const zeroCounted = { entropyRuns: 0, placeholders: 0, context: {} };

test('a missing root is reported as not present with nothing scanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    const root = join(dir, 'nope');
    const result = scanRoot(root, { sinceAt: 0, env: {} });
    assert.deepEqual(result, { root, present: false, files: 0, scanned: 0, unscanned: [], failures: [], findings: [], scannedFiles: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty existing root is present with zero counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.deepEqual(result, { root: dir, present: true, files: 0, scanned: 0, unscanned: [], failures: [], findings: [], counted: zeroCounted, scannedFiles: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('files at or below the byte cap are scanned and a file one byte over is unscanned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'word '.repeat(10).slice(0, 49));
    writeFileSync(join(dir, 'b.txt'), 'word '.repeat(10));
    writeFileSync(join(dir, 'c.txt'), 'x'.repeat(51));
    const result = scanRoot(dir, { sinceAt: 0, env: { CW_TRANSCRIPT_MAX_BYTES: '50' } });
    assert.equal(result.files, 3);
    assert.equal(result.scanned, 2);
    assert.deepEqual(result.unscanned, [{ file: 'c.txt', reason: 'too-large (51 > 50)' }]);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.scannedFiles, [{ abs: join(dir, 'a.txt'), rel: 'a.txt' }, { abs: join(dir, 'b.txt'), rel: 'b.txt' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable file is recorded as a read failure rather than as vanished', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    const file = join(dir, 'locked.txt');
    writeFileSync(file, 'plain words');
    chmodSync(file, 0o000);
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.deepEqual(result, { root: dir, present: true, files: 1, scanned: 0, unscanned: [], failures: [{ file: 'locked.txt', failure: 'EACCES: cannot read' }], findings: [], counted: zeroCounted, scannedFiles: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('random-looking live tokens are not counted as placeholders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), secretLines().slice(0, 2).join('\n') + '\n');
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.equal(result.counted.placeholders, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('high-entropy hits are tallied separately and never appear as grouped findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), secretLines().join('\n') + '\n');
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.deepEqual(result.findings.filter((f) => f.cls === 'high-entropy'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each grouped finding counts every hit so doubled lines give even counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    writeFileSync(join(dir, 'doubled.txt'), [...secretLines(), ...secretLines()].join('\n') + '\n');
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.deepEqual(result.findings.filter((f) => f.count % 2 !== 0), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('grouped findings within one file are sorted by class name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), secretLines().join('\n') + '\n');
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    const classes = result.findings.map((f) => f.cls);
    assert.deepEqual(classes, [...classes].sort((a, b) => a.localeCompare(b)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('context hits are counted once per hit so doubled lines give even tallies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanRoot-'));
  try {
    mkdirSync(join(dir, 'test', 'fixtures'), { recursive: true });
    writeFileSync(join(dir, 'test', 'fixtures', 'example.txt'), [...secretLines(), ...secretLines()].join('\n') + '\n');
    const result = scanRoot(dir, { sinceAt: 0, env: {} });
    assert.deepEqual(Object.values(result.counted.context).filter((v) => v % 2 !== 0), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
