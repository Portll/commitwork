// node --test cra/test/ — hand-written vocabularies checked against their ONE authority.
//
// These assert set equality, never examples. A fixture-driven test only covers the values the
// fixture happens to contain, so adding a lifecycle state or a trigger passes every existing test
// while silently producing `undefined` downstream — and JSON.stringify DROPS an undefined value,
// so the defect arrives as a missing field in a document a consumer trusts, not as an error.
//
// Source: evaluations/REMEDIATION-schema-derivation-2026-08-22.md items R4, R8, R9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const vexSrc = () => import(pathToFileURL(join(REPO, 'cra', 'vex.mjs')).href);
const fmtSrc = () => import(pathToFileURL(join(REPO, 'cra', 'vex-formats.mjs')).href);

// ── R4: three format maps over one lifecycle state set ──────────────────────────────────────────
test('every lifecycle state has a status in ALL three VEX format maps', async () => {
  const vex = await vexSrc();
  const fmt = await fmtSrc();
  const states = Object.keys(vex.STATE_RANK);
  assert.ok(states.length >= 5, 'a shrunken authority would make this vacuous');

  for (const [name, map] of [['CDX_STATE', vex.CDX_STATE], ['CSAF_STATUS', fmt.CSAF_STATUS], ['OPENVEX_STATUS', fmt.OPENVEX_STATUS]]) {
    assert.deepEqual(
      Object.keys(map).sort(), [...states].sort(),
      `${name} is not exhaustive over STATE_RANK — a state with no entry emits status:undefined, which JSON.stringify drops entirely`,
    );
    for (const s of states) assert.ok(map[s], `${name}.${s} must not be empty`);
  }
});

test('no format ever renders an accepted finding as not-affected', async () => {
  const vex = await vexSrc();
  const fmt = await fmtSrc();
  // The single most consequential mapping in the module: a recorded decision NOT to remediate is
  // not a statement that the product is unaffected. Asserted per-map so a future edit to any one
  // of the three cannot quietly reintroduce it.
  assert.notEqual(vex.CDX_STATE.accepted, 'not_affected');
  assert.notEqual(fmt.CSAF_STATUS.accepted, 'known_not_affected');
  assert.notEqual(fmt.OPENVEX_STATUS.accepted, 'not_affected');
  assert.equal(fmt.OPENVEX_STATUS.accepted, 'affected');
  assert.equal(fmt.CSAF_STATUS.accepted, 'known_affected');
});

// ── R9: a format with no extension writes `<product>.undefined` ─────────────────────────────────
test('every declared VEX format has a filename extension', async () => {
  const { FORMATS, EXT } = await vexSrc();
  assert.deepEqual(Object.keys(EXT).sort(), [...FORMATS].sort(),
    'a format present in FORMATS but absent from EXT writes a file literally named <product>.undefined');
});

// ── R8: the ratchet must not disagree with the track split ──────────────────────────────────────
test('every reportable trigger outranks every non-reportable one', async () => {
  const { ARTICLE14_TRIGGERS, TRIGGER_RANK } = await import(pathToFileURL(join(REPO, 'cra', 'watch.mjs')).href);
  for (const t of ARTICLE14_TRIGGERS) {
    assert.ok(Number.isFinite(TRIGGER_RANK[t]), `${t} is reportable but has no TRIGGER_RANK entry — the ratchet would treat it as rank undefined`);
  }
  const reportable = ARTICLE14_TRIGGERS.map((t) => TRIGGER_RANK[t]);
  const other = Object.entries(TRIGGER_RANK).filter(([t]) => !ARTICLE14_TRIGGERS.includes(t)).map(([, r]) => r);
  assert.ok(other.length, 'a vacuous pass would prove nothing');
  // If a non-reportable trigger could outrank a reportable one, the ratchet would promote a case by
  // rank while trackOf still classified it internal — the two mechanisms would disagree about the
  // same case, and the ratchet's comment claims exactly that this cannot happen.
  assert.ok(Math.min(...reportable) > Math.max(...other),
    'a non-reportable trigger outranks a reportable one: the ratchet and trackOf would disagree');
});

test('trackOf and isFilable agree for every declared trigger', async () => {
  const { TRIGGER_RANK, ARTICLE14_TRIGGERS, trackOf, isFilable } = await import(pathToFileURL(join(REPO, 'cra', 'watch.mjs')).href);
  const delegated = { bodies: ['some body'] };
  for (const trigger of Object.keys(TRIGGER_RANK)) {
    const withBody = { trigger, reporting: delegated };
    const withoutBody = { trigger, reporting: { bodies: [] } };
    const reportable = ARTICLE14_TRIGGERS.includes(trigger);
    assert.equal(trackOf(withBody), reportable ? 'article14' : 'internal', `trackOf(${trigger}) with a delegated body`);
    assert.equal(trackOf(withoutBody), reportable ? 'bestpractice' : 'internal', `trackOf(${trigger}) with no delegated body`);
    // Filable is the strictest of the three and must never be true off the regulatory track.
    assert.equal(isFilable(withoutBody), false, `${trigger} must never be filable with no body delegated`);
    assert.equal(isFilable(withBody), reportable);
  }
});
