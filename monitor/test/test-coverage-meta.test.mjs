// test-coverage-meta.test.mjs — the disk-set-equals-glob-set ratchet: every *.test.mjs on disk
// must fall inside package.json's `test` globs, both sides re-derived from source each run.
// globSync agrees with `node --test`'s glob resolution (verified empirically), including skipping
// node_modules/ and dotfile dirs — mirrored via isIgnoredDir so both sides compare one universe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, globSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// directories that are never source — none may contribute a *.test.mjs
const IGNORED_DIR_NAMES = new Set(['node_modules', 'reports', 'tmp']);
const isIgnoredDir = (name) => name.startsWith('.') || IGNORED_DIR_NAMES.has(name);

// --- side A: every *.test.mjs file that actually exists on disk ----------------------------------
function walkTestFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      walkTestFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      out.push(path.relative(REPO_ROOT, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  }
  return out;
}

// --- side B: whatever `npm test` ACTUALLY runs ----------------------------------------------------
//
// THE GLOBS MOVED, AND THIS GUARD WENT BLIND WHEN THEY DID. Until 2026-09-04 `scripts.test` was
// `node --test <glob> <glob> …` and this function tokenized it. The test entry point then became
// `node bin/test-run.mjs` — a wrapper that scopes the suite's ambient writes — and the globs moved
// into that file. Tokenizing the script then yielded ZERO patterns, and this ratchet reported all
// 595 test files as unmatched: a guard whose whole job is "npm test really runs every test file"
// answering confidently about a script that no longer names any.
//
// So side B follows the globs to wherever they live rather than assuming a shape. It resolves the
// script to its runner and imports the list that runner actually uses, and it still tokenizes when
// the script names globs directly — either arrangement is legitimate, and the guard must survive
// the next move too.
async function scriptGlobPatterns() {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts && pkg.scripts.test;
  assert.ok(typeof script === 'string' && script.length > 0, 'package.json scripts.test is missing or empty');

  // A runner script rather than an inline glob list: take the globs from the runner itself.
  const runner = /^node\s+(\S+\.mjs)\s*$/.exec(script.trim());
  if (runner) {
    const mod = await import(pathToFileURL(path.join(REPO_ROOT, runner[1])).href);
    assert.ok(Array.isArray(mod.TEST_GLOBS) && mod.TEST_GLOBS.length,
      `${runner[1]} is the test entry point but exports no TEST_GLOBS — this guard cannot see what `
      + 'npm test runs, which is indistinguishable from it running nothing');
    return mod.TEST_GLOBS;
  }

  // minimal shell-like tokenizer — good enough for an npm test script
  const tokens = [];
  let cur = '';
  let quote = null;
  for (const ch of script) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);

  // drop the interpreter and flags; a real glob argument names a path, so require a "/" —
  // this also rejects a bare flag value that lands in its own token
  return tokens
    .slice(1)
    .filter((t) => !t.startsWith('-'))
    .filter((t) => t.includes('/'));
}

async function globMatchedFiles() {
  const patterns = await scriptGlobPatterns();
  assert.ok(
    patterns.length > 0,
    'no glob patterns could be parsed out of package.json scripts.test — the tokenizer or the script itself is broken',
  );
  const matched = new Set();
  for (const pattern of patterns) {
    for (const file of globSync(pattern, { cwd: REPO_ROOT })) {
      const rel = file.split(path.sep).join('/');
      // keep side B in the same universe as side A
      if (rel.split('/').some(isIgnoredDir)) continue;
      matched.add(rel);
    }
  }
  return matched;
}

test('every *.test.mjs on disk is matched by the `test` script\'s own globs, and vice versa', async () => {
  const onDisk = new Set(walkTestFiles(REPO_ROOT, []));
  assert.ok(onDisk.size > 0, 'the on-disk walk found zero *.test.mjs files — the walker itself is broken');

  const globMatched = await globMatchedFiles();

  const neverRun = [...onDisk].filter((f) => !globMatched.has(f)).sort();
  const phantom = [...globMatched].filter((f) => !onDisk.has(f)).sort();

  assert.ok(
    neverRun.length === 0,
    `${neverRun.length} *.test.mjs file(s) exist on disk but are NOT matched by any glob in ` +
      `package.json's "test" script — \`npm test\` silently never runs them:\n  ${neverRun.join('\n  ')}`,
  );
  assert.ok(
    phantom.length === 0,
    `${phantom.length} file(s) matched by a glob in package.json's "test" script do not exist on ` +
      `disk (stale pattern, or the walker disagrees with node's glob resolution):\n  ${phantom.join('\n  ')}`,
  );
});
