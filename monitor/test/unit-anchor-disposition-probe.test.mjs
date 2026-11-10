// Evidence of whether a finding's quoted spans are still in its file (monitor/anchor-disposition.mjs probe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../anchor-disposition.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeSrc(dir, text) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), text);
}

test('a behaviour kind is reported as not probeable', () => {
  withDir((dir) => {
    writeSrc(dir, 'const x = "some-token";');
    const r = probe({ kind: 'race', file: 'src/a.mjs', evidence: '"some-token"' }, { root: dir });
    assert.deepEqual(r, { probeable: false, why: "kind 'race' describes behaviour, not a literal \u2014 no probe can decide it" });
  });
});

test('a missing file gives a moot hint with fileGone set', () => {
  withDir((dir) => {
    const r = probe({ kind: 'hardcoded', file: 'src/missing.mjs', evidence: '"some-token"' }, { root: dir });
    assert.deepEqual(r, { probeable: true, fileGone: true, verdictHint: 'moot', why: 'the file no longer exists' });
  });
});

test('a path that is a directory reports the read error code', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sub'));
    const r = probe({ kind: 'stub', file: 'sub', evidence: '"some-token"' }, { root: dir });
    assert.deepEqual(r, { probeable: true, error: 'EISDIR' });
  });
});

test('a finding without a file probes the root directory and reports EISDIR', () => {
  withDir((dir) => {
    const r = probe({ kind: 'dead', evidence: '`marker`' }, { root: dir });
    assert.deepEqual(r, { probeable: true, error: 'EISDIR' });
  });
});

test('quotes of three characters are too short to become needles', () => {
  withDir((dir) => {
    writeSrc(dir, 'const abc = "xyz";');
    const r = probe({ kind: 'hardcoded', file: 'src/a.mjs', evidence: '`abc`', summary: 'value is "xyz"' }, { root: dir });
    assert.deepEqual(r, { probeable: true, needles: [], why: 'the finding quotes nothing specific enough to search for' });
  });
});

test('a four character quote under a commitwork path prefix is still present', () => {
  withDir((dir) => {
    writeSrc(dir, 'const abcd = 1;');
    const r = probe({ kind: 'hardcoded', file: '/home/someone/commitwork/src/a.mjs', evidence: '`abcd`' }, { root: dir });
    assert.deepEqual(r, {
      probeable: true,
      needles: ['abcd'],
      stillPresent: ['abcd'],
      verdictHint: 'still-present',
      why: '1 of 1 quoted spans are still in the file',
    });
  });
});

test('needles are deduplicated and sorted longest first with only the found ones listed', () => {
  withDir((dir) => {
    writeSrc(dir, 'const k = "alpha-key";');
    const finding = { kind: 'dead', file: 'src/a.mjs', evidence: '`alpha-key` and "beta-longer-key"', summary: "also 'alpha-key'" };
    const r = probe(finding, { root: dir });
    assert.deepEqual(r, {
      probeable: true,
      needles: ['beta-longer-key', 'alpha-key'],
      stillPresent: ['alpha-key'],
      verdictHint: 'still-present',
      why: '1 of 2 quoted spans are still in the file',
    });
  });
});

test('quotes over 120 characters or with double spaces are not needles', () => {
  withDir((dir) => {
    const q = 'q'.repeat(120);
    const rr = 'r'.repeat(121);
    writeSrc(dir, `const s = "${q}";`);
    const finding = { kind: 'hardcoded', file: 'src/a.mjs', evidence: `\`${q}\` "a  bcd" \`${rr}\`` };
    const r = probe(finding, { root: dir });
    assert.deepEqual(r, {
      probeable: true,
      needles: [q],
      stillPresent: [q],
      verdictHint: 'still-present',
      why: '1 of 1 quoted spans are still in the file',
    });
  });
});

test('a quoted span absent from the file is reported as remediated', () => {
  withDir((dir) => {
    writeSrc(dir, 'const x = "other-value";');
    const r = probe({ kind: 'hardcoded', file: 'src/a.mjs', evidence: 'uses "secret-token"', summary: 'x' }, { root: dir });
    assert.deepEqual(r, {
      probeable: true,
      needles: ['secret-token'],
      stillPresent: [],
      verdictHint: 'remediated',
      why: 'none of the 1 quoted spans remain \u2014 the code the finding described is gone',
    });
  });
});
