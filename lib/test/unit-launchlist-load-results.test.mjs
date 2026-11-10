// Reads and parses a project's launchlist results JSON file, or null when it is absent (lib/launchlist.mjs loadResults).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadResults } from '../launchlist.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadResults-'));
  const prev = process.env.CW_LAUNCHLIST_DIR;
  process.env.CW_LAUNCHLIST_DIR = join(dir, 'launchlist');
  const results = join(dir, 'launchlist', 'results');
  mkdirSync(results, { recursive: true });
  try {
    fn(results);
  } finally {
    if (prev === undefined) delete process.env.CW_LAUNCHLIST_DIR;
    else process.env.CW_LAUNCHLIST_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

function errMsg(f) {
  try { f(); } catch (e) { return e.message; }
  return 'no error';
}

test('returns the parsed object when the results file exists', () => {
  withDir((results) => {
    const p = join(results, 'alpha.json');
    writeFileSync(p, JSON.stringify({ ok: true, n: 1 }));
    assert.equal(readFileSync(p, 'utf8'), '{"ok":true,"n":1}');
    assert.deepEqual(loadResults('alpha'), { ok: true, n: 1 });
  });
});

test('returns the parsed array when the results file holds an array', () => {
  withDir((results) => {
    writeFileSync(join(results, 'arr.json'), JSON.stringify([1, 2, 3]));
    assert.deepEqual(loadResults('arr'), [1, 2, 3]);
  });
});

test('returns null when the results file is missing', () => {
  withDir(() => {
    assert.equal(loadResults('missing'), null);
  });
});

test('accepts a slug of exactly one hundred characters and returns its file contents', () => {
  withDir((results) => {
    const s = 'a'.repeat(100);
    writeFileSync(join(results, `${s}.json`), JSON.stringify({ long: 100 }));
    assert.deepEqual(loadResults(s), { long: 100 });
  });
});

test('throws for a slug of one hundred and one characters', () => {
  withDir(() => {
    const s = 'a'.repeat(101);
    assert.throws(() => loadResults(s), { name: 'Error', message: `launchlist: not a project slug: "${s}"` });
  });
});

test('throws for a slug containing a dot-dot sequence', () => {
  withDir((results) => {
    writeFileSync(join(results, 'a..b.json'), JSON.stringify({ x: 1 }));
    assert.throws(() => loadResults('a..b'), { name: 'Error', message: 'launchlist: not a project slug: "a..b"' });
  });
});

test('throws for an empty slug and for a slug starting with a dot', () => {
  withDir(() => {
    assert.throws(() => loadResults(''), { name: 'Error', message: 'launchlist: not a project slug: ""' });
    assert.throws(() => loadResults('.hidden'), { name: 'Error', message: 'launchlist: not a project slug: ".hidden"' });
  });
});

test('throws a not-valid-JSON error when the results file is empty', () => {
  withDir((results) => {
    const p = join(results, 'empty.json');
    writeFileSync(p, '');
    const inner = errMsg(() => JSON.parse(''));
    assert.throws(() => loadResults('empty'), { name: 'Error', message: `launchlist: ${p} is not valid JSON: ${inner}` });
  });
});

test('throws a not-valid-JSON error when the results file holds malformed JSON', () => {
  withDir((results) => {
    const p = join(results, 'bad.json');
    writeFileSync(p, '{ not json');
    const inner = errMsg(() => JSON.parse('{ not json'));
    assert.throws(() => loadResults('bad'), { name: 'Error', message: `launchlist: ${p} is not valid JSON: ${inner}` });
  });
});

test('throws a cannot-read error when the results path is a directory', () => {
  withDir((results) => {
    const p = join(results, 'dirproj.json');
    mkdirSync(p);
    const inner = errMsg(() => readFileSync(p, 'utf8'));
    assert.throws(() => loadResults('dirproj'), { name: 'Error', message: `launchlist: cannot read ${p}: ${inner}` });
  });
});
