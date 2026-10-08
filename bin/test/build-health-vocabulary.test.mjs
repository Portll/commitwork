/**
 * The toolchain status vocabulary is declared in FOUR places that cannot import each other:
 *   1. TOOLCHAIN_STATUSES   bin/lib/build-health-parse.mjs   — the emitter, and the authority
 *   2. CELL_TIP             admin/index.html                 — a JS object literal inside HTML
 *   3. DELIVERY_VERDICT     monitor/posture.mjs              — importable
 *   4. sourceNote prose     monitor/approach-taxonomy.json   — a vocabulary written in English
 * The regex extractors FAIL CLOSED: one that returns [] on a miss goes green forever at the
 * exact moment drift becomes possible.
 */
import { panelSource } from '../../admin/test/lib/panel-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TOOLCHAIN_STATUSES } from '../lib/build-health-parse.mjs';
import { DELIVERY_VERDICT } from '../../monitor/posture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/** Throws rather than returning an empty set — see the header. */
function extractCellTipKeys() {
  const src = panelSource('index.html');
  const start = src.indexOf('const CELL_TIP=');
  assert.notEqual(start, -1, 'CELL_TIP block not found in admin/index.html — the extractor is stale, NOT the vocabulary. Fix this test before trusting it.');
  const end = src.indexOf('};', start);
  assert.notEqual(end, -1, 'CELL_TIP block has no terminator — extractor stale');
  const block = src.slice(start, end);
  const keys = [...block.matchAll(/(?:^|[{,\s])'?([A-Za-z][\w/-]*)'?\s*:/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8, `CELL_TIP extractor found only ${keys.length} keys — implausible; treat as extractor failure, not as a small vocabulary`);
  return new Set(keys);
}

/** Throws rather than returning an empty set — see the header. */
function extractTaxonomyVocabulary() {
  const tax = JSON.parse(read('monitor/approach-taxonomy.json'));
  const note = tax.sourceNote;
  assert.equal(typeof note, 'string', 'approach-taxonomy.json has no sourceNote string — extractor stale');
  const m = note.match(/buildHealth ([\w|/-]+);/);
  assert.ok(m, 'the buildHealth vocabulary sentence was not found in sourceNote — extractor stale, NOT vocabulary drift');
  const values = m[1].split('|').filter((v) => v && v !== 'null');
  assert.ok(values.length >= 6, `taxonomy extractor found only ${values.length} values — implausible`);
  return new Set(values);
}

test('the extractors fail closed — a missing block throws instead of yielding an empty set', () => {
  // guards the guard — assert the shape directly so a []-on-miss rewrite cannot go vacuous
  assert.ok(extractCellTipKeys().size >= 8);
  assert.ok(extractTaxonomyVocabulary().size >= 6);
});

test('every status build-health can emit is explained in the admin panel', () => {
  const tips = extractCellTipKeys();
  const missing = TOOLCHAIN_STATUSES.filter((s) => !tips.has(s));
  assert.deepEqual(missing, [], `these statuses render in the fleet grid with no tooltip: ${missing.join(', ')}. A value the panel cannot explain is a value the reader will guess at.`);
});

test('every status build-health can emit has a declared delivery verdict', () => {
  const missing = TOOLCHAIN_STATUSES.filter((s) => !(s in DELIVERY_VERDICT));
  assert.deepEqual(missing, [], `posture.mjs would score these as 'unknown': ${missing.join(', ')}. Safe, but it means the fleet posture silently stops counting them.`);
});

test('every status build-health can emit is listed in the approach taxonomy', () => {
  const declared = extractTaxonomyVocabulary();
  const missing = TOOLCHAIN_STATUSES.filter((s) => !declared.has(s));
  assert.deepEqual(missing, [], `approach-taxonomy.json's declared buildHealth vocabulary is missing: ${missing.join(', ')}`);
});

test('no status is scored green unless the emitter means green', () => {
  // explicit uncertainty: no-tests/unreadable/env-blocked mean "nothing was established"
  for (const s of ['no-tests', 'unreadable', 'env-blocked']) {
    assert.ok(TOOLCHAIN_STATUSES.includes(s), `${s} must be a declared member`);
    assert.notEqual(DELIVERY_VERDICT[s], 'green', `${s} scored as green — absence of evidence rendered as evidence`);
  }
  assert.equal(DELIVERY_VERDICT.green, 'green');
  assert.equal(DELIVERY_VERDICT.RED, 'red');
});

/**
 * Evaluate the panel's REAL cell() over the real CELL_TIP, rather than reading the source of its
 * bad-predicate. Prompted by the passkey [hidden] finding of 2026-08-23: a passkey button
 * carried `hidden` and rendered anyway, because an author `display` rule beats the UA sheet on
 * origin — and the test asserting the markup shipped `hidden` was green for that button's whole
 * life. The rule it exports: a test that asserts a flag IS SET is probably not asserting that
 * anything obeys it. The two assertions below used to do exactly that — one checked CELL_TIP had a
 * key, the other checked a literal was absent from the bad-predicate's SOURCE TEXT. Neither ever
 * ran cell(), so any second colouring path would have been invisible to both.
 */
function loadCell() {
  const src = panelSource('index.html');
  const start = src.indexOf('const CELL_TIP=');
  const end = src.indexOf('const slicePill=', start);
  assert.notEqual(start, -1, 'CELL_TIP not found — extractor stale, NOT a panel defect');
  assert.notEqual(end, -1, 'slicePill terminator not found — extractor stale');
  const block = src.slice(start, end);
  assert.ok(block.includes('const cell='), 'cell() is no longer between CELL_TIP and slicePill — extractor stale');
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return { cell, CELL_TIP };`)();
}

test('the extracted cell() is the real one — a stale extractor fails loudly, never vacuously', () => {
  const { cell, CELL_TIP } = loadCell();
  assert.equal(typeof cell, 'function');
  assert.ok(Object.keys(CELL_TIP).length >= 8);
  assert.match(cell('RED'), /pill part/, 'RED must render as a defect — if this fails the harness is wrong, not the panel');
});

test('every not-known status RENDERS grey and explained — asserted on the output, not the predicate', () => {
  const { cell } = loadCell();
  for (const s of ['no-tests', 'unreadable', 'env-blocked']) {
    const html = cell(s);
    assert.match(html, /class="mut"/, `${s} does not render muted; "not established" must not read as either clean or broken`);
    assert.doesNotMatch(html, /pill part/, `${s} renders as a defect pill; it means "not established", not "broken"`);
    assert.match(html, /title="[^"]{20,}"/, `${s} renders with no explanation — a value the panel cannot explain is one the reader will guess at`);
    assert.ok(html.includes(s), `${s} does not appear in its own cell`);
  }
});

test('a status the panel has never heard of renders muted and unexplained, not as a pass', () => {
  // The unmeasured-is-not-a-verdict rule at the boundary: an UNREGISTERED value must not acquire a verdict.
  const { cell } = loadCell();
  const html = cell('some-future-status');
  assert.match(html, /class="mut"/);
  assert.doesNotMatch(html, /title=/, 'an unknown value must not be given an explanation the panel does not have');
});
