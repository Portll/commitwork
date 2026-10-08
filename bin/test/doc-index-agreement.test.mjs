// doc-index-agreement — A13, index drift at the pointer.
//
// Built 2026-09-06 from the ed.15 remediation audit (its spine plan,
// task 2.10). A13 sat at closure 1 with no detector, no canary and R11 OPEN against it.
//
// WHAT THIS ADDS THAT bin/docs-doctor.mjs DOES NOT. docs-doctor checks the index LISTING: that every
// durable doc is linked from README's `## Documentation` section, and that each doc carries a fresh
// `verified-against` stamp. It does not read what the index SAYS ABOUT a doc. A13 is drift at the
// POINTER rather than in the document: the target is fresh, stamped and correct, and the sentence
// pointing at it describes something else. The reader who trusts the index never opens the file, so
// the index is the only thing they read and the only thing nothing checks.
//
// Stamps are deliberately NOT re-checked here. docs-doctor owns that question and a second
// implementation of it would be G17 — a parallel model of a concept that already has one, drifting
// silently because nothing compares them.
//
// THE NUMBER IS THE SHARP PART. A description that says "199 classes" or "40 lanes" is making a
// claim the target can settle. Prose paraphrase cannot be checked without a reader; an integer can,
// and integers are what go stale first, because the target grows and the sentence does not.
//
// Env, read at CALL time: CW_REPO.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = () => process.env.CW_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The `## Documentation` section's link rows: label, href, and the description that follows. */
export function parseIndex(readme) {
  const section = readme.split(/^##\s+/m).find((s) => /^Documentation/i.test(s));
  if (!section) return [];
  return [...section.matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/gm)]
    .map(([, label, href, description]) => ({ label, href, path: href.split('#')[0], description }));
}

/**
 * The integers a description asserts about its target. Two digits or more: a lone `1` or `4` is
 * ordinary prose ("a four-part distribution", "phase 1") and matching those would report every
 * sentence containing a small number as a claim, which is a manufactured false positive.
 */
export const numericClaims = (description) => [...new Set(description.match(/\b\d{2,}\b/g) || [])];

/** Which of the description's numbers the target does not contain. */
export const driftedNumbers = (description, targetText) =>
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal or escaped value defined in the test
  numericClaims(description).filter((n) => !new RegExp(`\\b${n}\\b`).test(targetText));

test('parseIndex reads label, href and description, and drops the anchor from the path', () => {
  const rows = parseIndex('## Documentation\n\n- [Traps](docs/TRAPS.md#x) the 12 traps\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, 'docs/TRAPS.md');
  assert.equal(rows[0].description, 'the 12 traps');
});

test('parseIndex returns nothing when there is no Documentation section, rather than guessing', () => {
  assert.deepEqual(parseIndex('# Title\n\n- [x](y.md) z\n'), []);
});

test('a number the target does not carry is drift; one it carries is not', () => {
  assert.deepEqual(driftedNumbers('the 199 classes', 'this doc describes 199 classes'), []);
  assert.deepEqual(driftedNumbers('the 199 classes', 'this doc describes 201 classes'), ['199']);
});

test('single digits are prose, not claims — matching them would report every sentence', () => {
  assert.deepEqual(numericClaims('a four-part distribution, phase 1, 3 of them'), []);
  assert.deepEqual(numericClaims('40 lanes and 199 classes'), ['40', '199']);
});

test('a number is matched on a word boundary, so 19 does not satisfy a claim of 199', () => {
  assert.deepEqual(driftedNumbers('the 199 classes', 'there are 19 of them'), ['199']);
});

// README declares the evaluation record sidecar-resident: its index entries "resolve for the operator
// and not in a clone". They are held to the same rule wherever the sidecar is mounted, and skipped by
// name where it is not — neither reported as gone nor passed unread.
const SIDECAR_ROOT = 'evaluations';
const inSidecar = (row) => row.path === SIDECAR_ROOT || row.path.startsWith(`${SIDECAR_ROOT}/`);

test('every documentation index entry points at a file that exists', () => {
  const rows = parseIndex(readFileSync(resolve(REPO(), 'README.md'), 'utf8'));
  assert.ok(rows.length > 10, `only ${rows.length} index entries parsed — the section moved or the shape changed`);
  const missing = rows.filter((r) => !inSidecar(r) && !existsSync(resolve(REPO(), r.path))).map((r) => r.path);
  assert.deepEqual(missing, [], 'index rows pointing at files that are gone');
});

test('every sidecar-resident index entry exists where the sidecar is mounted', (t) => {
  const mount = resolve(REPO(), SIDECAR_ROOT);
  try { lstatSync(mount); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    t.skip(`no sidecar at ${mount} (ENOENT) — README declares these entries operator-only`);
    return;
  }
  const rows = parseIndex(readFileSync(resolve(REPO(), 'README.md'), 'utf8')).filter(inSidecar);
  // docs-doctor requires the living registers to be indexed, and they live here.
  assert.ok(rows.length > 0, 'no index entry points into the sidecar — the parse broke or the registers went unindexed');
  const missing = rows.filter((r) => !existsSync(resolve(REPO(), r.path))).map((r) => r.path);
  assert.deepEqual(missing, [], 'sidecar-resident index rows pointing at files that are gone');
});

test('every number the index asserts about a doc is a number that doc carries', () => {
  const rows = parseIndex(readFileSync(resolve(REPO(), 'README.md'), 'utf8'));
  const withClaims = rows.filter((r) => numericClaims(r.description).length);
  // A vacuous pass is the failure mode here: if the description column ever stops being parsed, this
  // test goes green over nothing. The population is asserted before the population is judged.
  assert.ok(withClaims.length > 0,
    'no index description carries a number — either the index changed shape or the parse broke');
  const drifted = [];
  for (const r of withClaims) {
    const abs = resolve(REPO(), r.path);
    if (!existsSync(abs)) continue;                    // the row above owns that failure
    const bad = driftedNumbers(r.description, readFileSync(abs, 'utf8'));
    if (bad.length) drifted.push(`${r.path}: index says ${bad.join(', ')}, target does not`);
  }
  assert.deepEqual(drifted, [],
    `${drifted.length} index description(s) assert a number their target does not carry. The doc is `
    + 'fresh and the sentence pointing at it is stale, which is the reader\'s only view of it.');
});

test('FLOOR: the live check would catch a planted drift', () => {
  // Five of the six assertions above now pass over the real tree. A gate that has never been seen to
  // fail is indistinguishable from one that cannot, so the predicate is run against a planted row.
  const planted = parseIndex('## Documentation\n\n- [Taxonomy](monitor/failure-taxonomy.json) the 100000 classes\n');
  assert.equal(planted.length, 1);
  const target = readFileSync(resolve(REPO(), planted[0].path), 'utf8');
  assert.deepEqual(driftedNumbers(planted[0].description, target), ['100000'],
    'the predicate no longer detects a number the target does not carry');
});
