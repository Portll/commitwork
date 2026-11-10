// Secret-scan report over named paths or git-tracked files (bin/secrets-sweep.mjs sweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweep } from '../secrets-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

function inDir(fn, maxBytes) {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-'));
  const saved = { CW_SECRETS_ROOT: process.env.CW_SECRETS_ROOT, CW_SECRETS_MAX_BYTES: process.env.CW_SECRETS_MAX_BYTES };
  process.env.CW_SECRETS_ROOT = dir;
  if (maxBytes === undefined) delete process.env.CW_SECRETS_MAX_BYTES;
  else process.env.CW_SECRETS_MAX_BYTES = String(maxBytes);
  try {
    fn(dir);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function report(dir, mode, paths, { scanned = 0, unscanned = [], failures = [], skippedDirs = [] }) {
  return {
    root: resolve(dir), mode, paths, scannedFiles: scanned, findings: [], unscanned, failures, skippedDirs,
    fixtureFiles: [],
    summary: {
      'REAL-SECRET': 0, 'SENSITIVE-CONTEXT': 0, 'FALSE-POSITIVE': 0, scannedFiles: scanned,
      unscannedFiles: unscanned.length, scanFailures: failures.length, declaredFixtures: 0,
    },
  };
}

function gitRepo(dir, names) {
  for (const d of ['objects', 'refs']) mkdirSync(join(dir, '.git', d), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  if (names.length === 0) return;
  const word = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const parts = [Buffer.from('DIRC'), word(2), word(names.length)];
  for (const name of names) {
    const entry = Buffer.alloc((62 + name.length + 8) & ~7);
    entry.writeUInt32BE(0o100644, 24);
    createHash('sha1').update('blob 0\0').digest().copy(entry, 40);
    entry.writeUInt16BE(name.length, 60);
    entry.write(name, 62, 'latin1');
    parts.push(entry);
  }
  const body = Buffer.concat(parts);
  writeFileSync(join(dir, '.git', 'index'), Buffer.concat([body, createHash('sha1').update(body).digest()]));
}

test('a missing named path is a scan failure while an existing file is scanned', () => {
  inDir((dir) => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    assert.deepEqual(sweep(['missing.txt', 'a.txt']), report(dir, 'paths', ['missing.txt', 'a.txt'], {
      scanned: 1,
      failures: [{ file: 'missing.txt', failure: 'ENOENT: named path does not exist' }],
    }));
  });
});

test('a path through a regular file fails with its own error code and message', () => {
  inDir((dir) => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    let message;
    try { lstatSync(join(dir, 'a.txt', 'x')); } catch (e) { message = e.message; }
    assert.deepEqual(sweep(['a.txt/x']), report(dir, 'paths', ['a.txt/x'], {
      failures: [{ file: 'a.txt/x', failure: `ENOTDIR: ${message}` }],
    }));
  });
});

test('a walked directory lists skipped dirs, dedupes files and marks binary and oversized files unscanned', () => {
  inDir((dir) => {
    mkdirSync(join(dir, 'src', 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'src', 'node_modules', 'pkg.js'), 'x');
    writeFileSync(join(dir, 'src', 'a.txt'), 'hello\n');
    writeFileSync(join(dir, 'src', 'b.txt'), 'hello\n\n');
    writeFileSync(join(dir, 'src', 'img.png'), Buffer.alloc(4, 1));
    writeFileSync(join(dir, 'src', 'nul.txt'), Buffer.from([104, 0, 105]));
    assert.deepEqual(sweep(['src', 'src/a.txt']), report(dir, 'paths', ['src', 'src/a.txt'], {
      scanned: 1,
      unscanned: [
        { file: 'src/b.txt', reason: 'over-max-bytes' },
        { file: 'src/img.png', reason: 'binary-extension' },
        { file: 'src/nul.txt', reason: 'binary-content' },
      ],
      skippedDirs: ['src/node_modules'],
    }));
  }, 6);
});

test('tracked mode reports a scan failure when git cannot list files', () => {
  inDir((dir) => {
    writeFileSync(join(dir, '.git'), 'gitdir: missing\n');
    const r = sweep();
    assert.deepEqual(r.failures.map((f) => [f.file, f.failure.slice(0, 27)]),
      [['<git ls-files>', 'cannot list tracked files: ']]);
    assert.deepEqual(r, report(dir, 'tracked', ['<git ls-files>'], { failures: r.failures }));
  });
});

test('tracked mode with an empty index reports zero tracked files as a failure', () => {
  inDir((dir) => {
    gitRepo(dir, []);
    assert.deepEqual(sweep(null), report(dir, 'tracked', ['<git ls-files>'], {
      failures: [{ file: '<git ls-files>', failure: 'git reported zero tracked files' }],
    }));
  });
});

test('tracked mode scans present files and lists a tracked file missing from the worktree as deleted', () => {
  inDir((dir) => {
    gitRepo(dir, ['a.txt', 'gone.txt']);
    writeFileSync(join(dir, 'a.txt'), 'hello\n');
    assert.deepEqual(sweep(), report(dir, 'tracked', ['<git ls-files>'], {
      scanned: 1,
      unscanned: [{ file: 'gone.txt', reason: 'deleted-from-worktree' }],
    }));
  });
});
