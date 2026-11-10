// Existing ledger paths, highest-numbered archive first and the live file last (bin/lib/ledger-rotate.mjs generations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generations } from '../lib/ledger-rotate.mjs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'generations-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a ledger whose parent directory is missing has no generations', () => {
  withDir((dir) => {
    const r = generations(join(dir, 'sub', 'ledger.json'));
    assert.deepEqual(r, []);
  });
});

test('a ledger that does not exist in an empty directory has no generations', () => {
  withDir((dir) => {
    const r = generations(join(dir, 'ledger.json'));
    assert.deepEqual(r, []);
  });
});

test('a ledger with no archives yields only its own path', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    assert.deepEqual(generations(f), [f]);
  });
});

test('a single archive comes before the live ledger', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    writeFileSync(join(dir, 'ledger.json.1'), 'old1');
    assert.deepEqual(generations(f), [join(dir, 'ledger.json.1'), f]);
  });
});

test('several archives are listed from the highest number down to the live ledger', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    writeFileSync(join(dir, 'ledger.json.2'), 'old2');
    writeFileSync(join(dir, 'ledger.json.1'), 'old1');
    writeFileSync(join(dir, 'ledger.json.3'), 'old3');
    assert.deepEqual(generations(f), [
      join(dir, 'ledger.json.3'),
      join(dir, 'ledger.json.2'),
      join(dir, 'ledger.json.1'),
      f,
    ]);
  });
});

test('archive numbers are ordered numerically including zero and zero-padded suffixes', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    for (const s of ['9', '0', '10', '03']) writeFileSync(join(dir, `ledger.json.${s}`), s);
    assert.deepEqual(generations(f), [
      join(dir, 'ledger.json.10'),
      join(dir, 'ledger.json.9'),
      join(dir, 'ledger.json.03'),
      join(dir, 'ledger.json.0'),
      f,
    ]);
  });
});

test('files with a non-numeric suffix or a different base name are ignored', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    writeFileSync(join(dir, 'ledger.json.1'), 'old1');
    for (const n of ['ledger.json.bak', 'ledger.json.1a', 'other.json.1', 'ledger.jsonx.2']) {
      writeFileSync(join(dir, n), n);
    }
    assert.deepEqual(generations(f), [join(dir, 'ledger.json.1'), f]);
  });
});

test('archives are returned even when the live ledger is missing', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(join(dir, 'ledger.json.1'), 'old1');
    writeFileSync(join(dir, 'ledger.json.2'), 'old2');
    assert.deepEqual(generations(f), [join(dir, 'ledger.json.2'), join(dir, 'ledger.json.1')]);
  });
});

test('an archive name that is a dangling symlink is dropped', () => {
  withDir((dir) => {
    const f = join(dir, 'ledger.json');
    writeFileSync(f, 'data');
    writeFileSync(join(dir, 'ledger.json.1'), 'old1');
    symlinkSync(join(dir, 'missing-target'), join(dir, 'ledger.json.5'));
    assert.deepEqual(generations(f), [join(dir, 'ledger.json.1'), f]);
  });
});

test('a parent path that is a regular file rethrows the directory read error', () => {
  withDir((dir) => {
    const plain = join(dir, 'plain');
    writeFileSync(plain, 'x');
    assert.throws(() => generations(join(plain, 'ledger.json')), {
      name: 'Error',
      message: `ENOTDIR: not a directory, scandir '${plain}'`,
    });
  });
});
