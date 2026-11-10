// Sorted .jsonl file paths under a root with mtime at or after sinceAt (monitor/agent-run-judge.mjs listRuns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRuns } from '../agent-run-judge.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'listRuns-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const put = (p, secs) => {
  writeFileSync(p, '{}\n');
  utimesSync(p, secs, secs);
};

test('returns an empty array when the root directory does not exist', () => {
  withDir((dir) => {
    const r = listRuns(join(dir, 'no-such-dir'), { sinceAt: 0 });
    assert.deepEqual(r, []);
  });
});

test('throws the readdir error when the root is a regular file', () => {
  withDir((dir) => {
    const f = join(dir, 'plain.jsonl');
    put(f, 1000);
    assert.throws(() => listRuns(f, { sinceAt: 0 }), {
      name: 'Error',
      message: `ENOTDIR: not a directory, scandir '${f}'`,
    });
  });
});

test('returns an empty array for an empty root directory', () => {
  withDir((dir) => {
    assert.deepEqual(listRuns(dir, { sinceAt: 0 }), []);
  });
});

test('includes a jsonl file whose mtime equals sinceAt', () => {
  withDir((dir) => {
    const f = join(dir, 'a.jsonl');
    put(f, 1000);
    assert.deepEqual(listRuns(dir, { sinceAt: 1000000 }), [f]);
  });
});

test('excludes a jsonl file whose mtime is one millisecond below sinceAt', () => {
  withDir((dir) => {
    const f = join(dir, 'b.jsonl');
    put(f, 1000);
    assert.deepEqual(listRuns(dir, { sinceAt: 1000001 }), []);
  });
});

test('skips files without the jsonl extension and descends into subdirectories', () => {
  withDir((dir) => {
    put(join(dir, 'readme.txt'), 1000);
    put(join(dir, 'run.json'), 1000);
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const c = join(sub, 'c.jsonl');
    put(c, 1000);
    assert.deepEqual(listRuns(dir, { sinceAt: 0 }), [c]);
  });
});

test('skips symbolic links to files and to directories', () => {
  withDir((dir) => {
    const target = join(dir, 'real.jsonl');
    put(target, 1000);
    symlinkSync(target, join(dir, 'link.jsonl'));
    const other = mkdtempSync(join(tmpdir(), 'listRuns-'));
    try {
      put(join(other, 'outside.jsonl'), 1000);
      symlinkSync(other, join(dir, 'linkdir'));
      assert.deepEqual(listRuns(dir, { sinceAt: 0 }), [target]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

test('returns matching paths sorted lexicographically across nesting levels', () => {
  withDir((dir) => {
    for (const n of ['z.jsonl', 'a.jsonl', 'm.jsonl']) put(join(dir, n), 1000);
    mkdirSync(join(dir, 'sub'));
    put(join(dir, 'sub', 'b.jsonl'), 1000);
    assert.deepEqual(listRuns(dir, { sinceAt: 1000000 }), [
      join(dir, 'a.jsonl'),
      join(dir, 'm.jsonl'),
      join(dir, 'sub', 'b.jsonl'),
      join(dir, 'z.jsonl'),
    ]);
  });
});

test('keeps only files at or after sinceAt when mtimes differ', () => {
  withDir((dir) => {
    const old = join(dir, 'old.jsonl');
    const edge = join(dir, 'edge.jsonl');
    const fresh = join(dir, 'fresh.jsonl');
    put(old, 1999);
    put(edge, 2000);
    put(fresh, 2001);
    assert.deepEqual(listRuns(dir, { sinceAt: 2000000 }), [edge, fresh]);
  });
}
);
