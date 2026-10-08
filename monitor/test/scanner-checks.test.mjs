// The panel's per-scanner run button is only correct while monitor/scanner-checks.mjs agrees with
// SCANNER_SPECS, which lives in monitor/extractors.mjs and is IMPORTED here — see the note on the
// assertion below for why this used to regex rollup.mjs's source instead, and why that was weaker.
// (This header said the old thing long after the code stopped doing it; socket-alerts.test.mjs
// likewise imports rather than lifting sumTotals now.)
//
// A drift here is not cosmetic: pressing ⏺ on "Secrets · Gitleaks" would run some other check,
// the category's numbers would not move, and the panel would look broken in a way that reads as
// "the scanner found nothing".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCANNER_CHECKS, checkForScanner, RUNTIME_CATEGORIES } from '../scanner-checks.mjs';
import { SCANNER_SPECS } from '../extractors.mjs';

/**
 * The [category, checkId] pairs, IMPORTED.
 *
 * This used to read rollup.mjs as text and regex the SCANNER_SPECS array literal, because rollup.mjs
 * is a driver — importing it performed a rollup. So the test asserted the SHAPE OF THE SOURCE and
 * would have passed just as happily against a literal that no longer compiled the way it read. The
 * specs now live in monitor/extractors.mjs and are imported, so this asserts the real table.
 */
function specsFromRollup() {
  const pairs = SCANNER_SPECS.map(([category, checkId]) => [category, checkId]);
  assert.ok(pairs.length >= 10, `only ${pairs.length} specs — the table shrank unexpectedly`);
  return pairs;
}

test('every rollup scanner category maps to the check that produces it', () => {
  for (const [category, checkId] of specsFromRollup()) {
    assert.equal(SCANNER_CHECKS[category], checkId,
      `category '${category}' is produced by check '${checkId}' in rollup.mjs, but scanner-checks.mjs says '${SCANNER_CHECKS[category]}'`);
  }
});

test('the map declares no category the rollup does not produce', () => {
  const known = new Set(specsFromRollup().map(([c]) => c));
  for (const category of Object.keys(SCANNER_CHECKS)) {
    assert.ok(known.has(category), `scanner-checks.mjs declares '${category}', which rollup.mjs never produces`);
  }
});

test('checkForScanner is a closed set — unknown input resolves to null, never a command', () => {
  assert.equal(checkForScanner('secrets'), 'secrets-gitleaks');
  for (const hostile of ['', 'nope', '../../etc/passwd', 'sast; rm -rf /', '__proto__', 'constructor', 'toString']) {
    assert.equal(checkForScanner(hostile), null, `'${hostile}' must not resolve to a check id`);
  }
});

test('runtime categories are real categories', () => {
  for (const c of RUNTIME_CATEGORIES) assert.ok(SCANNER_CHECKS[c], `'${c}' is not a known category`);
});

// ── the two lists that name a category by string and fail SOFT ─────────────────────────────────
// A typo in either excludes nothing / labels nothing, reports a plausible number, and raises no
// error. R10 of evaluations/REMEDIATION-schema-derivation-2026-08-22.md.
test('TOTALS_EXCLUDE names only real categories — a typo would silently exclude nothing', async () => {
  const { TOTALS_EXCLUDE } = await import('../extractors.mjs');
  assert.ok(TOTALS_EXCLUDE.length, 'a vacuous pass would prove nothing');
  for (const c of TOTALS_EXCLUDE) {
    assert.ok(SCANNER_CHECKS[c],
      `TOTALS_EXCLUDE names '${c}', which is not a scanner category — it excludes NOTHING, and the `
      + 'fleet total is quietly larger than the code claims');
  }
});

test('every scanner category has a display label — an unlabelled one renders as its raw key', async () => {
  const { SCANNER_LABELS } = await import('../extractors.mjs');
  const missing = Object.keys(SCANNER_CHECKS).filter((c) => !SCANNER_LABELS[c]);
  assert.deepEqual(missing, [], 'categories with no SCANNER_LABELS entry');
});
