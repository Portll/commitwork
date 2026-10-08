// Repo-wide: no entrypoint may compare import.meta.url against process.argv[1] by hand.
//
// Reads HEAD, not the working tree — same surface and same reason as tracked-imports.test.mjs: the
// tree here is always mid-edit by some other session, and what ships is the commit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Each is a comparison that is FALSE through a symlink, because import.meta.url is realpath-resolved
// and argv[1] is the path as typed. The guard then never fires: no output, exit 0.
const FRAGILE = [
  'import.meta.url === `file://${process.argv[1]}`',
  'pathToFileURL(process.argv[1])',
  'resolve(process.argv[1]) === fileURLToPath(import.meta.url)',
  'fileURLToPath(import.meta.url) === process.argv[1]',
  'resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))',
  'pathToFileURL(resolve(process.argv[1]))',
  'join(process.argv[1]) === fileURLToPath(import.meta.url)',
  'new URL(`file://${process.argv[1]}`)',
  // a filename suffix also matches any same-suffix script that imports the module
  'process.argv[1].endsWith(',
  'process.argv[1].includes(',
];

// This file holds the forbidden shapes as data, so it matches its own scan. Excluded by exact path,
// never by a pattern: a rule like "skip test files" would hide the defect everywhere it matters most.
const SELF = 'bin/test/no-fragile-main-guard.test.mjs';

const headLines = (needle) => {
  let out = '';
  try {
    out = execFileSync('git', ['-C', REPO, 'grep', '-nF', needle, 'HEAD', '--', '*.mjs'], { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) return [];            // git grep: 1 means no match
    throw new Error(`git grep failed (status ${e.status}): ${e.stderr || e.message}`);
  }
  return out.split('\n').filter(Boolean);
};

test('no tracked module hand-rolls the main-module check', () => {
  const offenders = [];
  for (const needle of FRAGILE) {
    for (const line of headLines(needle)) {
      const [, file, body] = line.match(/^HEAD:([^:]+):\d+:(.*)$/s) ?? [];
      if (file === SELF) continue;
      const code = (body ?? '').trim();
      if (code.startsWith('//') || code.startsWith('*')) continue;   // documentation, not a guard
      offenders.push(line.replace(/^HEAD:/, ''));
    }
  }
  assert.deepEqual(offenders, [],
    `use isMainModule(import.meta.url) from lib/is-main.mjs — these comparisons are false through a symlink,\n`
    + `so the CLI block never runs and the process exits 0 having printed nothing:\n  ${offenders.join('\n  ')}`);
});

// The guard above is a text scan over HEAD, and a broken scan returns nothing, which reads exactly
// like a clean repository. This file is a known positive that is always present in HEAD: if the
// search stops finding it, the search is broken, not the tree.
test('the scan can still see a known positive', () => {
  for (const needle of FRAGILE) {
    const found = headLines(needle).filter((l) => l.startsWith(`HEAD:${SELF}:`));
    assert.ok(found.length > 0,
      `the scan found no instance of ${needle} even in ${SELF}, which contains it — `
      + 'the search is broken and every clean result it reports is meaningless');
  }
});

test('the forbidden-shape list still matches a real instance of the defect', () => {
  const planted = 'if (import.meta.url === `file://${process.argv[1]}`) main();';
  assert.ok(FRAGILE.some((f) => planted.includes(f)));
});
