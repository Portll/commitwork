// First regular file named docker in a PATH directory, or null (lib/docker-reachable.mjs resolveDocker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocker } from '../docker-reachable.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'resolveDocker-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function bins(dir, n) {
  return Array.from({ length: n }, (_, i) => {
    const d = join(dir, `bin${i + 1}`);
    mkdirSync(d);
    return d;
  });
}

test('returns the docker file in the first PATH directory when two directories both contain one', () => {
  withDir((dir) => {
    const [d1, d2] = bins(dir, 2);
    writeFileSync(join(d1, 'docker'), '#!/bin/sh\n');
    writeFileSync(join(d2, 'docker'), '#!/bin/sh\n');
    const r = resolveDocker({ PATH: `${d1}${delimiter}${d2}` });
    assert.equal(r, join(d1, 'docker'));
  });
});

test('returns null when PATH is the empty string', () => {
  withDir(() => {
    const r = resolveDocker({ PATH: '' });
    assert.equal(r, null);
  });
});

test('returns null when PATH is not set in the environment', () => {
  withDir(() => {
    const r = resolveDocker({});
    assert.equal(r, null);
  });
});

test('returns null when no PATH directory contains an entry named docker', () => {
  withDir((dir) => {
    const [d1, d2] = bins(dir, 2);
    writeFileSync(join(d1, 'notdocker'), 'x');
    writeFileSync(join(d2, 'notdocker'), 'x');
    const r = resolveDocker({ PATH: `${d1}${delimiter}${d2}` });
    assert.equal(r, null);
  });
});

test('skips a docker entry that is a directory and returns the docker file in the next PATH directory', () => {
  withDir((dir) => {
    const [d1, d2] = bins(dir, 2);
    mkdirSync(join(d1, 'docker'));
    writeFileSync(join(d2, 'docker'), '#!/bin/sh\n');
    const r = resolveDocker({ PATH: `${d1}${delimiter}${d2}` });
    assert.equal(r, join(d2, 'docker'));
  });
});

test('returns null when the only docker entry on PATH is a directory', () => {
  withDir((dir) => {
    const [d1] = bins(dir, 1);
    mkdirSync(join(d1, 'docker'));
    const r = resolveDocker({ PATH: d1 });
    assert.equal(r, null);
  });
});

test('returns the docker file in the second PATH directory when the first has none', () => {
  withDir((dir) => {
    const [d1, d2] = bins(dir, 2);
    writeFileSync(join(d1, 'other'), 'x');
    writeFileSync(join(d2, 'docker'), '#!/bin/sh\n');
    const r = resolveDocker({ PATH: `${d1}${delimiter}${d2}` });
    assert.equal(r, join(d2, 'docker'));
  });
});

test('returns null when PATH contains only delimiters', () => {
  withDir(() => {
    const r = resolveDocker({ PATH: delimiter.repeat(3) });
    assert.equal(r, null);
  });
});

test('ignores empty PATH segments around a directory that contains a docker file', () => {
  withDir((dir) => {
    const [d1] = bins(dir, 1);
    writeFileSync(join(d1, 'docker'), '#!/bin/sh\n');
    const r = resolveDocker({ PATH: `${delimiter}${d1}${delimiter}` });
    assert.equal(r, join(d1, 'docker'));
  });
});
