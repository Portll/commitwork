// Validates a requested scan directory and resolves it to its real path or a refusal (bin/lib/scan-target.mjs resolveScanPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScanPath } from '../lib/scan-target.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'resolveScanPath-')));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const body = { ok: false, error: 'body must be {"path": "<absolute path to a directory>"}' };

test('Non-string and empty inputs are rejected with the request body error', () => {
  assert.deepEqual(resolveScanPath(null), body);
  assert.deepEqual(resolveScanPath(42), body);
  assert.deepEqual(resolveScanPath(''), body);
});

test('A relative path is rejected as not absolute', () => {
  assert.deepEqual(resolveScanPath('some/relative/path'), {
    ok: false,
    error: "not an absolute path: some/relative/path (a relative path would resolve against the panel's working directory)",
  });
});

test('A missing path is rejected as no such path', () => {
  withDir((dir) => {
    const input = join(dir, 'does-not-exist');
    assert.deepEqual(resolveScanPath(input), { ok: false, error: `no such path: ${input}` });
  });
});

test('A path running through a file is rejected with the resolve error code', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'afile.txt'), 'data');
    const input = join(dir, 'afile.txt', 'sub');
    assert.deepEqual(resolveScanPath(input), { ok: false, error: `${input} could not be resolved (ENOTDIR)` });
  });
});

test('A regular file is rejected as not a directory', () => {
  withDir((dir) => {
    const file = join(dir, 'afile.txt');
    writeFileSync(file, 'data');
    assert.deepEqual(resolveScanPath(file), {
      ok: false,
      error: `not a directory: ${file} (scan takes a directory and scans the git repositories under it)`,
    });
  });
});

test('An existing directory is accepted at its real path', () => {
  withDir((dir) => {
    const sub = join(dir, 'subdir');
    mkdirSync(sub);
    assert.deepEqual(resolveScanPath(sub), { ok: true, path: sub });
  });
});

test('A symlinked directory is accepted at the path it resolves to', () => {
  withDir((dir) => {
    const target = join(dir, 'target');
    mkdirSync(target);
    symlinkSync(target, join(dir, 'link'));
    assert.deepEqual(resolveScanPath(join(dir, 'link')), { ok: true, path: target });
  });
});

test('A credential directory is refused whether named directly or reached through a symlink', () => {
  withDir((dir) => {
    const ssh = join(dir, 'home', '.ssh');
    mkdirSync(ssh, { recursive: true });
    symlinkSync(ssh, join(dir, 'alias'));
    const refusal = { ok: false, error: `refusing to scan ${ssh}: it contains credential material (.ssh)` };
    assert.deepEqual(resolveScanPath(ssh), refusal);
    assert.deepEqual(resolveScanPath(join(dir, 'alias')), refusal);
  });
});

test('A directory inside or containing the commitwork checkout is refused but one beside it is accepted', () => {
  withDir((dir) => {
    const checkout = join(dir, 'checkout');
    const inner = join(checkout, 'inner');
    const beside = join(dir, 'checkout-beside');
    mkdirSync(inner, { recursive: true });
    mkdirSync(beside);
    assert.deepEqual(resolveScanPath(inner, { checkout }), {
      ok: false,
      error: `refusing to scan ${inner}: it is the commitwork checkout the panel runs from, which holds git-excluded keys, fleet configuration and every prior report; the scheduled sweep scans it under its declared area`,
    });
    assert.deepEqual(resolveScanPath(dir, { checkout }), {
      ok: false,
      error: `refusing to scan ${dir}: it contains the commitwork checkout ${checkout}, and discovery would scan the checkout's git-excluded keys, fleet configuration and reports with everything else; scan a directory beside it`,
    });
    assert.deepEqual(resolveScanPath(beside, { checkout }), { ok: true, path: beside });
  });
});

test('A directory overlapping a scan output root is refused but one beside it is accepted', () => {
  withDir((dir) => {
    const out = join(dir, 'out');
    const reports = join(out, 'reports');
    const other = join(dir, 'other');
    mkdirSync(reports, { recursive: true });
    mkdirSync(other);
    const msg = (p, b) => `refusing to scan ${p}: it overlaps ${b}, where scan output goes; the scan would read earlier reports and write into the tree it is reading`;
    assert.deepEqual(resolveScanPath(out, { outBase: out }), { ok: false, error: msg(out, out) });
    assert.deepEqual(resolveScanPath(reports, { outBase: [other, out] }), { ok: false, error: msg(reports, out) });
    assert.deepEqual(resolveScanPath(other, { outBase: out }), { ok: true, path: other });
  });
});
