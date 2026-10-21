// bin/test/release-names.test.mjs — the public-release name gate, over the working tree.
//
// WHAT IT CHECKS THAT A CONTENT SCAN DOES NOT: PATHS. Tracked FILENAMES have carried identities
// (a per-client manifest named after the client among them), and a content-only scan passes them
// while they sit in plain sight in the file tree. `git ls-files` is the population for both halves.
//
// SCOPE IS READ FROM THE PRIVATE MAPS, NEVER HARDCODED HERE: the release manifest, the publish map
// and the identity register, combined by bin/lib/release-scope.mjs, which the HEAD gate uses too.
// Hardcoding a roster beside them is the "mirrored" binding this repo already names as a defect.
// A public checkout has none of the three and SKIPS, naming the path it looked at. Once the
// manifest is present, a missing or malformed publish map or register FAILS: half a scope is blind.
//
// NO FILE IS EXEMPT FROM ITS OWN SCAN. The maps and this test used to be excluded because they had
// to spell the names; the maps live in the sidecar now and this file spells none.
//
// THREE BUCKETS, NOT TWO. Occurrences FAIL. `undetermined` forms on a prose-scoped manifest entry,
// where nobody has ruled whether they are an external contract, are counted and REPORTED and fail
// nothing. An unknown is not a finding: publishing it as one is the same defect as publishing it as
// a pass, and this repo has been bitten by both directions.
//
// Messages name the file, the line and the source document, never the matched text: they reach
// logs, and a gate that printed the names it guards would publish them.
//
// HEAD, NOT THE WORKING TREE, is deliberately NOT used here — unlike bin/test/tracked-imports.test.mjs,
// which reads HEAD because a half-landed import breaks a clone. This gate's subject is the release,
// and the release ships the tree as it will be committed. release-names-head.test.mjs asks HEAD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../../monitor/registry.mjs';
import { findNames, mask, offenderRows, undeterminedCount } from '../lib/release-scope.mjs';
import { loadDiskScope, manifestPath, scanEntries, SIDECAR } from '../lib/release-names-head-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Only a checkout with no sidecar skips: a public clone holds no private records by design. A sidecar
// present without the map is a missing input, and fails with its path. Returning early instead
// reported a pass over a gate that had nothing to enforce.
const needsManifest = () => (process.env.CW_RELEASE_REDACTIONS || existsSync(SIDECAR())
  ? {}
  : { skip: `no sidecar at ${SIDECAR()} (set CW_SIDECAR) — a public checkout holds no release manifest, so the release-name checks cannot run` });
const absentMessage = () => `release manifest absent at ${manifestPath()} — a sidecar is present, so this is a missing input, not a public checkout`;
const requireManifest = () => {
  assert.ok(existsSync(manifestPath()), absentMessage());
  return JSON.parse(readFileSync(manifestPath(), 'utf8'));
};
const schemaFor = () => process.env.CW_RELEASE_REDACTIONS_SCHEMA
  || resolve(REPO, 'schema', 'release-redactions.schema.json');

const trackedFiles = () => execFileSync('git', ['-C', REPO, 'ls-files'],
  { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')
  .filter((f) => f && existsSync(resolve(REPO, f)));

const readFile = (rel) => {
  try { return readFileSync(resolve(REPO, rel), 'utf8'); } catch { return null; }
};

// One scan per run: three tests read it, and each would otherwise re-read ~40 MB.
let _scan = null;
function scan() {
  if (_scan) return _scan;
  const scope = loadDiskScope();
  assert.ok(scope, absentMessage());
  const files = trackedFiles();
  _scan = { scope, files, ...scanEntries(files.map((path) => ({ path, text: readFile(path) })), scope) };
  return _scan;
}

test('the manifest satisfies its schema and names at least one identity', needsManifest(), () => {
  const doc = requireManifest();
  const { errors } = validateAgainstSchema(doc, { path: schemaFor() });
  assert.deepEqual(errors, [], 'release-redactions: the manifest does not satisfy its schema');
  assert.ok(doc.names.length > 0, 'the manifest names nobody');
});

test('the scope holds all three sources, and says when the register overrode an exclusion', needsManifest(), (t) => {
  const { scope } = scan();
  assert.ok(scope.words.length > 0, 'the scope holds no names — there is nothing to enforce');
  for (const [s, n] of Object.entries(scope.loaded)) assert.ok(n > 0, `the ${s} contributed no names — it loaded, but empty`);
  if (scope.overridden) {
    t.diagnostic(`${scope.overridden} form(s) the release manifest lists as out of scope are scope=all in the `
      + 'identity register and stay IN scope (D22.1, no per-name exceptions). Retire the stale exclusion.');
  }
});

test('NO TRACKED FILE PATH CARRIES A REDACTED IDENTITY', needsManifest(), () => {
  const { scope, paths } = scan();
  assert.deepEqual(paths.map((p) => mask(p, findNames(p, scope))), [],
    'these tracked FILENAMES carry an identity the release must not publish (masked to the source that '
    + 'scopes it). Rename with `git mv` and update every reference — a content-only scan passes these '
    + 'while they sit in plain sight in the file tree');
});

test('NO TRACKED FILE CONTENT CARRIES A REDACTED IDENTITY', needsManifest(), () => {
  const { content } = scan();
  const rows = offenderRows(content, scan().scope);
  const total = content.reduce((n, c) => n + c.hits.length, 0);
  assert.deepEqual(rows, [],
    `${total} occurrence(s) in ${content.length} tracked file(s). Replace each with non-specific `
    + 'wording or a synthetic stand-in:\n  ' + rows.join('\n  '));
});

test('UNDETERMINED forms are counted and reported, never failed on', needsManifest(), () => {
  const { scope, files } = scan();
  let n = 0;
  for (const f of files) {
    const text = readFile(f);
    if (text !== null && undeterminedCount(text, scope)) n++;
  }
  // Deliberately assertion-free on the count. These are neither pass nor fail: nobody has ruled
  // whether they are an external contract that stays or an internal reference that goes.
  if (n) console.log(`  [undetermined, not a failure] ${scope.undetermined.length} unruled form(s) appear in ${n} file(s)`);
  assert.ok(true);
});
