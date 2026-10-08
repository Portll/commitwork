// The LIVE retention pattern against the LIVE lane set.
//
// retention-protect.test.mjs pins the compaction MECHANISM using its own fixture registry, so it
// passes whatever the real pattern says. Nothing asserted the correspondence between the pattern
// and the checks that actually create database directories — and on 2026-08-22 it had drifted:
// dropDirPattern read ^codeql-(java-)?db$, naming the two languages with lanes when it was written,
// while sast-codeql-python and sast-codeql-ruby had been creating codeql-python-db and
// codeql-ruby-db every sweep since that morning. 236 leftover dirs, 4.1G, with reports/ at 40G —
// past the 37G that filled the volume and wedged Docker on 2026-07-20.
//
// The scratch directory a check creates is derivable from its own command, so this asserts the
// correspondence rather than restating the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryPathFor } from '../store-paths.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The live pattern is declared only in the private registry, which a clean checkout does not have.
// Only its absence skips — ENOENT, with no CW_REGISTRY naming it — so unreadable or unparseable fails.
const REGISTRY_PATH = registryPathFor(CW);
const registry = (() => {
  try { return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_REGISTRY) return null; throw e; }
})();
const NO_LIVE = registry ? undefined
  : `private registry absent: ${REGISTRY_PATH} does not exist, so there is no live retention pattern to measure`;
const roster = JSON.parse(readFileSync(join(CW, 'manifests/security-baseline.json'), 'utf8'));

/** Every `$CW_REPORT_DIR/<name>` a roster command hands to `codeql database create`. */
function declaredDbDirs() {
  const out = new Set();
  for (const c of roster.checks || []) {
    for (const cmd of c.local || []) {
      for (const m of String(cmd).matchAll(/codeql\s+database\s+create\s+"?\$CW_REPORT_DIR\/([A-Za-z0-9._-]+)"?/g)) {
        out.add(m[1]);
      }
    }
  }
  return [...out].sort();
}

test('every CodeQL database directory a check creates is covered by the retention drop pattern', { skip: NO_LIVE }, () => {
  const pattern = new RegExp(registry.retention.dropDirPattern);
  const dirs = declaredDbDirs();
  assert.ok(dirs.length >= 2, `expected several codeql db dirs, found ${dirs.length} — did the command shape change?`);
  const uncovered = dirs.filter((d) => !pattern.test(d));
  assert.deepEqual(uncovered, [],
    `these database dirs are created every sweep and pruned by nothing: ${uncovered.join(', ')} — `
    + `dropDirPattern is ${registry.retention.dropDirPattern}. Generalise the pattern; do not add a language to it.`);
});

test('the pattern does not over-reach into artifacts that must survive', { skip: NO_LIVE }, () => {
  // The compactor's whole value is that SARIF and summary artifacts stay re-rollable. A pattern
  // loose enough to eat those would be a far worse failure than the leak it fixes.
  const pattern = new RegExp(registry.retention.dropDirPattern);
  for (const keep of ['codeql.sarif', 'codeql-python.sarif', 'codeql-fleet-latest', '.codeql-fleet-latest',
    'runtime-latest', 'races', 'docs', 'codeqldb', 'my-codeql-db-backup']) {
    assert.equal(pattern.test(keep), false, `retention would drop '${keep}', which must survive compaction`);
  }
});

test('adding a CodeQL language does not require editing the pattern', { skip: NO_LIVE }, () => {
  // The property that stops this recurring: the pattern is shaped, not enumerated.
  const pattern = new RegExp(registry.retention.dropDirPattern);
  for (const lang of ['go', 'csharp', 'swift', 'rust', 'kotlin']) {
    assert.ok(pattern.test(`codeql-${lang}-db`),
      `a future codeql-${lang}-db would leak — the pattern is enumerating languages again`);
  }
});
