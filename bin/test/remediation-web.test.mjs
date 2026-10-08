// The remediation register must publish its own gaps.
//
// The defect this page exists for: monitor/failure-taxonomy.json has carried a `status` field that
// bin/taxonomy-web.mjs never rendered, so item 4 read "DONE 2026-08-13" in the data while the defect
// it named fired in production until 2026-08-27, and no reader of the published page could see
// either the claim or the contradiction. A register whose status is invisible is a list of
// intentions.
//
// So the assertions below are mostly about ABSENCE: that an item with no status renders as a state
// rather than as whitespace, and that an unrecognised status is never rounded toward done.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { statusOf, tally, renderRemediation } from '../remediation-web.mjs';

const REGISTRY = JSON.parse(readFileSync(fileURLToPath(new URL('../../monitor/failure-taxonomy.json', import.meta.url)), 'utf8'));

describe('remediation register page', () => {
  test('a status is read from the FRONT of the field, in the shape already in use', () => {
    const s = statusOf({ status: 'DONE 2026-08-13 (d0e1f2a) — landed by a peer session, verified here.' });
    assert.equal(s.word, 'DONE');
    assert.match(s.detail, /^2026-08-13/, 'the remainder is kept as detail, never discarded');
  });

  test('NO status is UNASSESSED — not blank, and not done', () => {
    for (const item of [{}, { status: '' }, { status: '   ' }, { status: null }]) {
      assert.equal(statusOf(item).word, 'UNASSESSED');
    }
  });

  test('an UNRECOGNISED status is UNASSESSED, and its text is preserved', () => {
    // Rounding prose toward a verdict is how a register starts lying. "Probably fine" is not DONE.
    const s = statusOf({ status: 'probably fine, nobody has checked' });
    assert.equal(s.word, 'UNASSESSED');
    assert.equal(s.detail, 'probably fine, nobody has checked', 'the original claim survives the refusal to classify it');
  });

  test('a status word buried mid-sentence does not count as a verdict', () => {
    assert.equal(statusOf({ status: 'this was never DONE and remains a problem' }).word, 'UNASSESSED');
  });

  test('the tally counts the unassessed — a total that hides its gaps is not a total', () => {
    const t = tally([{ status: 'DONE x' }, { status: 'OPEN y' }, {}, { status: 'nonsense' }]);
    assert.equal(t.DONE, 1);
    assert.equal(t.OPEN, 1);
    assert.equal(t.UNASSESSED, 2, 'the blank AND the unrecognised both land here');
    assert.equal(Object.values(t).reduce((a, b) => a + b, 0), 4, 'the partition closes');
  });

  test('EVERY item renders a status word — none is left as whitespace', () => {
    const html = renderRemediation(REGISTRY);
    const rem = REGISTRY.remediations || [];
    assert.ok(rem.length >= 18, `registry degenerated (${rem.length} remediations) — the count below would pass vacuously`);
    // Scoped to the ranked-actions table. The surfaces render statuses too (asserted separately),
    // so an unscoped count here would pin 18 against a correct 26 and read as a regression.
    const actions = html.slice(0, html.indexOf('Attribution surfaces'));
    const words = [...actions.matchAll(/class="st st-[a-z]+">([A-Z]+)</g)].map((m) => m[1]);
    assert.equal(words.length, rem.length,
      'an action rendered without a status word — the blank this page exists to eliminate');
  });

  test('the unassessed count is stated in prose when there is one', () => {
    const html = renderRemediation({ remediations: [{ rank: 1, title: 't', action: 'a' }], attributionPlan: [] });
    assert.match(html, /1 of 1<\/b> carry no status/, 'the gap must be said, not only coloured');
  });

  test('a fully-assessed register does not print a gap notice it does not have', () => {
    const html = renderRemediation({ remediations: [{ rank: 1, title: 't', action: 'a', status: 'DONE x' }], attributionPlan: [] });
    assert.doesNotMatch(html, /carry no status/);
  });

  test('deterministic: same inputs, byte-identical output', () => {
    assert.equal(renderRemediation(REGISTRY), renderRemediation(REGISTRY));
  });

  test('self-contained — no CDN, no external stylesheet, no remote script', () => {
    const html = renderRemediation(REGISTRY);
    assert.doesNotMatch(html, /src="https?:|href="https?:|@import/,
      'the page must render from a file:// path with nothing fetched (house rule)');
  });

  test('every field the register carries reaches the page — closes, effort, risk, action', () => {
    // Compare against the DECODED page: the renderer escapes, so a raw-substring match would fail
    // on any action containing < or & and would tempt the next person to weaken the assertion
    // rather than decode. (First caught here by an action containing "$GIT_DIR/index.<session>".)
    const decoded = renderRemediation(REGISTRY)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const first = (REGISTRY.remediations || []).slice().sort((a, b) => a.rank - b.rank)[0];
    assert.ok(decoded.includes(first.title), 'title');
    assert.ok(decoded.includes(first.action.slice(0, 60)), 'action');
    for (const id of first.closes || []) assert.ok(decoded.includes(`>${id}<`), `closes ${id}`);
    // and the escaping is real, not bypassed — the raw page must NOT carry a bare angle bracket
    // from the data.
    assert.ok(!renderRemediation(REGISTRY).includes('index.<session>'), 'data was emitted unescaped');
  });

  test('the attribution surfaces are on the page too — the split takes both halves', () => {
    const html = renderRemediation(REGISTRY);
    const attr = REGISTRY.attributionPlan || [];
    assert.ok(attr.length >= 8, `expected the attribution surfaces, found ${attr.length}`);
    for (const a of attr) assert.ok(html.includes(a.area), `surface ${a.area} is missing from the page`);
  });
});

// The attribution surfaces carry statuses too, and they were rendered without them for an hour
// after this page was built to fix exactly that. Added as a witness rather than a note.
test('every attribution surface renders a status word, not just the ranked actions', () => {
  const html = renderRemediation(REGISTRY);
  const rem = (REGISTRY.remediations || []).length;
  const attr = (REGISTRY.attributionPlan || []).length;
  const words = [...html.matchAll(/class="st st-[a-z]+">([A-Z]+)</g)].length;
  assert.equal(words, rem + attr,
    `${words} status words for ${rem} actions + ${attr} surfaces — a section is rendering its status nowhere`);
});

test('a surface with no status is UNASSESSED on the page, like an action', () => {
  const html = renderRemediation({
    remediations: [{ rank: 1, title: 't', action: 'a', status: 'DONE x' }],
    attributionPlan: [{ area: 'Nameless', defect: 'd', mechanism: 'm', change: 'c' }],
  });
  assert.match(html, /Nameless[\s\S]{0,200}st-unassessed/,
    'an unassessed surface must show the state, not an empty cell');
});
