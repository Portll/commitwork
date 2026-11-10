// Appends a single newline-terminated line to a file with fsync and a durability receipt (lib/durable-write.mjs durableAppendLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durableAppendLine } from '../durable-write.mjs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects a non-string line with a TypeError', () => {
  assert.throws(() => durableAppendLine('/tmp/x', 42), { name: 'TypeError', message: 'durableAppendLine: line must be a string' });
});

test('rejects a line containing a newline with a TypeError', () => {
  assert.throws(() => durableAppendLine('/tmp/x', 'a\nb'), { name: 'TypeError', message: "durableAppendLine: line must not contain a newline \u2014 one call is one row, or the ledger's row boundaries stop meaning anything" });
});

test('refuses a row that exceeds the byte ceiling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    const r = durableAppendLine(p, 'x'.repeat(100), { max: 10 });
    assert.equal(r.state, "refused");
    assert.equal(r.class, "too-large");
    assert.equal(r.bytes, 101);
    assert.equal(r.reason, "row is 101 bytes, ceiling is 10 \u2014 refused rather than appending a row no reader can parse back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes a row and reports the durability guarantees', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, 'old\n');
    const r = durableAppendLine(p, 'new');
    assert.equal(r.ok, true);
    assert.equal(r.state, "written");
    assert.equal(r.durability.tmpWrite, "held");
    assert.equal(r.durability.fileFsync, "held");
    assert.equal(r.durability.rename, "not-attempted");
    assert.equal(r.durability.dirFsync, "not-attempted");
    assert.equal(r.guarantees.atomicRename, false);
    assert.equal(r.guarantees.fileDurable, true);
    assert.equal(r.guarantees.dirDurable, "unknown");
    assert.equal(readFileSync(p, 'utf8'), "old\nnew\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks fileFsync unsupported when the platform returns EINVAL', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, '');
    const realFsync = process.binding ? null : null;
    const io = {
      fsyncSync: () => { const e = new Error('fsync not supported'); e.code = 'EINVAL'; throw e; },
    };
    const r = durableAppendLine(p, 'data', { io });
    assert.equal(r.ok, true);
    assert.equal(r.state, "written");
    assert.equal(r.durability.fileFsync, "unsupported");
    assert.equal(r.guarantees.fileDurable, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks fileFsync unsupported when the platform returns ENOTSUP', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, '');
    const io = {
      fsyncSync: () => { const e = new Error('fsync not supported'); e.code = 'ENOTSUP'; throw e; },
    };
    const r = durableAppendLine(p, 'data', { io });
    assert.equal(r.ok, true);
    assert.equal(r.state, "written");
    assert.equal(r.durability.fileFsync, "unsupported");
    assert.equal(r.guarantees.fileDurable, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a failed append when writeSync makes no progress', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, '');
    const io = {
      writeSync: () => 0,
    };
    const r = durableAppendLine(p, 'data', { io });
    assert.equal(r.ok, false);
    assert.equal(r.state, "failed");
    assert.equal(r.class, "no-space");
    assert.equal(r.errno, "ENOSPC");
    assert.equal(r.reason, "no space left on device");
    assert.equal(r.guarantees.atomicRename, false);
    assert.equal(r.guarantees.fileDurable, false);
    assert.equal(r.guarantees.dirDurable, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a failed append when writeSync returns a partial write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, '');
    const io = {
      writeSync: (fd, buf, off, len) => {
        if (off === 0) return 2;
        return 0;
      },
    };
    const r = durableAppendLine(p, 'abcd', { io });
    assert.equal(r.ok, false);
    assert.equal(r.state, "failed");
    assert.equal(r.class, "no-space");
    assert.equal(r.reason, "no space left on device \u2014 2 of 5 bytes of this row reached the ledger and the row is now TRUNCATED; a reader must treat the last line as suspect");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses when the parent directory cannot be created', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'noexist', 'l.txt');
    const io = {
      mkdirSync: () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; },
    };
    const r = durableAppendLine(p, 'data', { io });
    assert.equal(r.state, "refused");
    assert.equal(r.class, "permission");
    assert.equal(r.errno, "EACCES");
    assert.equal(r.reason, "parent directory not usable: permission denied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses when preflight detects insufficient space', () => {
  const dir = mkdtempSync(join(tmpdir(), 'durableAppendLine-'));
  try {
    const p = join(dir, 'l.txt');
    writeFileSync(p, '');
    const io = {
      statfsSync: () => ({ bsize: 4096, bavail: 1 }),
    };
    const r = durableAppendLine(p, 'x'.repeat(10000), { io, headroom: 0 });
    assert.equal(r.state, "refused");
    assert.equal(r.class, "no-space");
    assert.equal(r.reason, "refused on preflight: 4096 bytes available, 10001 needed (10001 payload + 0 headroom) \u2014 refusing rather than half-writing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
