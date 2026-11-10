// Scan result, or the unscanned or failure reason, for one file path (bin/secrets-sweep.mjs scanFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../secrets-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scanFile-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withMaxBytes(value, fn) {
  const prev = process.env.CW_SECRETS_MAX_BYTES;
  process.env.CW_SECRETS_MAX_BYTES = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.CW_SECRETS_MAX_BYTES;
    else process.env.CW_SECRETS_MAX_BYTES = prev;
  }
}

test('a directory is reported as not a regular file', () => {
  withDir((dir) => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    assert.deepEqual(scanFile(sub, 'sub'), {
      rel: 'sub', unscanned: 'not-a-regular-file', findings: [],
    });
  });
});

test('a path that does not exist is reported as vanished', () => {
  withDir((dir) => {
    const p = join(dir, 'missing.txt');
    assert.deepEqual(scanFile(p, 'missing.txt'), {
      rel: 'missing.txt', unscanned: 'vanished-mid-walk', findings: [],
    });
  });
});

test('a file exactly at the size limit is still scanned', () => {
  withDir((dir) => {
    const p = join(dir, 'five.txt');
    writeFileSync(p, 'hello');
    withMaxBytes('5', () => {
      assert.deepEqual(scanFile(p, 'five.txt'), { rel: 'five.txt', findings: [] });
    });
  });
});

test('a file one byte over the size limit is reported as too large', () => {
  withDir((dir) => {
    const p = join(dir, 'six.txt');
    writeFileSync(p, 'hello!');
    withMaxBytes('5', () => {
      assert.deepEqual(scanFile(p, 'six.txt'), {
        rel: 'six.txt', unscanned: 'over-max-bytes', findings: [],
      });
    });
  });
});

test('an uppercase binary extension is skipped without reading content', () => {
  withDir((dir) => {
    const p = join(dir, 'IMG.PNG');
    writeFileSync(p, 'hello');
    assert.deepEqual(scanFile(p, 'IMG.PNG'), {
      rel: 'IMG.PNG', unscanned: 'binary-extension', findings: [],
    });
  });
});

test('a text-named file containing a NUL byte is reported as binary content', () => {
  withDir((dir) => {
    const p = join(dir, 'data.txt');
    writeFileSync(p, Buffer.from([0x61, 0x00, 0x62]));
    assert.deepEqual(scanFile(p, 'data.txt'), {
      rel: 'data.txt', unscanned: 'binary-content', findings: [],
    });
  });
});

test('a stat error other than ENOENT is reported as a failure with its code', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'plain.txt'), 'hello');
    const p = join(dir, 'plain.txt', 'child');
    assert.deepEqual(scanFile(p, 'plain.txt/child'), {
      rel: 'plain.txt/child',
      failure: `ENOTDIR: ENOTDIR: not a directory, stat '${p}'`,
      findings: [],
    });
  });
});

test('an unreadable regular file is reported as a read failure with its code', { skip: process.getuid?.() === 0 }, () => {
  withDir((dir) => {
    const p = join(dir, 'locked.txt');
    writeFileSync(p, 'hello');
    chmodSync(p, 0o000);
    assert.deepEqual(scanFile(p, 'locked.txt'), {
      rel: 'locked.txt',
      failure: `EACCES: EACCES: permission denied, open '${p}'`,
      findings: [],
    });
  });
});
