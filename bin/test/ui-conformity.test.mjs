// feat.conformity — "every feature uses the shared components, tokens and navigation", as a
// ratchet rather than a one-off sweep. Two axes are at zero and are asserted at zero; two are not,
// and are asserted at a CEILING that may be lowered and never raised.
//
// WHY A CEILING AND NOT A PIN. A pinned count fails on an unrelated edit and gets bumped to make
// the suite green, which converts the guard into a logbook of whatever the tree happens to hold.
// A ceiling fails only on a new deviation, which is the event worth a failure.
//
// THE AXES AT ZERO ARE THE CLAIM. colour-literal is zero because of the twenty colour literals in a
// served non-definer source, nineteen are covered by a reasoned allowance in ALLOWED_COLOURS (the
// brand mark in three files, a QR code's quiet zone, a comment recording a contrast grading) and one
// is built from a byte triple at runtime — not because none were found. staleAllowances is asserted
// empty in the same test, so an allowance whose deviation has gone cannot hold the budget open for
// the next one.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { conformity, scale, surfaces, conformityRoot, ALLOWED_COLOURS, PALETTE_DEFINERS } from '../lib/ui-conformity.mjs';
import { buildInventory } from '../feature-inventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Measured 2026-10-24 at this tree. Lower a row when its deviations are fixed; never raise one.
// inline-display: the three remaining are two-sided (the client shows them by clearing the inline
//   style), so the markup and the client have to change together — see the axis note.
// inline-type: 19 inline font-size declarations, all in admin/config.html, where the type steps
//   docs/THEME.md §4.3 names have no utility class on that page. Giving them one is a design-system
//   decision, not a sweep.
// off-scale: both are `font-size:0.65625rem` in admin/config.html, which is the step
//   admin/static/config.css itself declares seven times while docs/THEME.md §4.3 declares the same
//   10.5px step as .656rem. One step, two spellings. Changing the two inline values alone was tried
//   and reverted: it bought 0.008px and made them disagree with their own page's seven class rules.
//   Which spelling is canonical is a design-system decision over eleven places, not a sweep.
const CEILING = {
  'colour-literal': 0,
  'inline-display': 3,
  'inline-type': 19,
  'off-scale': 2,
  navigation: 0,
};

let result;
before(() => {
  result = conformity({ root: ROOT, inventory: buildInventory({ root: ROOT, now: 'T' }) });
});

describe('feat.conformity — the measurement', () => {
  test('every axis is measured, and nothing is undetermined', () => {
    assert.deepEqual(result.undetermined, [], 'an axis this could not measure must not be read as conformant');
    assert.deepEqual(result.axes.map((a) => a.id).sort(), Object.keys(CEILING).sort());
    for (const a of result.axes) assert.ok(a.what && a.what.length > 20, `${a.id} does not say what it counts`);
  });

  test('no axis is above its ceiling', () => {
    const over = result.axes.filter((a) => a.measured > CEILING[a.id])
      .map((a) => `${a.id}: ${a.measured} > ${CEILING[a.id]} — ${a.hits.map((h) => h.file + ' ' + h.value).join(' · ')}`);
    assert.deepEqual(over, []);
  });

  test('the axes claimed clean are clean, and no allowance is holding one open', () => {
    for (const id of ['colour-literal', 'navigation']) {
      const a = result.axes.find((x) => x.id === id);
      assert.deepEqual(a.hits, [], `${id} is not clean`);
    }
    assert.deepEqual(result.staleAllowances, [],
      'an allowance that matches nothing — remove it, or it will cover the next deviation that lands on that file');
    for (const a of ALLOWED_COLOURS) {
      assert.ok(a.why && a.why.length > 40, `allowance ${a.id} has no stated reason`);
      assert.ok(a.files.length && a.values.length, `allowance ${a.id} is unbounded`);
    }
  });

  test('a ceiling that has gone slack is reported, so a fixed axis gets its ceiling lowered', () => {
    const slack = result.axes.filter((a) => a.measured < CEILING[a.id]).map((a) => `${a.id}: ${a.measured} < ${CEILING[a.id]}`);
    assert.deepEqual(slack, [], 'this axis is better than its ceiling — lower the ceiling to hold the gain');
  });
});

describe('feat.conformity — the scale is read from the design system, not held here', () => {
  test('docs/THEME.md yields the type steps and the spacing steps', () => {
    const sc = scale({ root: ROOT });
    assert.ok(!sc.error, sc.error);
    for (const step of ['.656', '.6875', '.8125']) assert.ok(sc.type.includes(step), `§4.3 lost the ${step} step`);
    for (const step of ['.25', '.375', '1.25']) assert.ok(sc.space.includes(step), `§5.1 lost the ${step} step`);
  });

  test('POSITIVE CONTROL: an unreadable THEME.md makes off-scale undetermined, not zero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-uic-'));
    for (const rel of ['docs/THEME.md', 'admin/panel.html', 'admin/config.html']) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      cpSync(join(ROOT, rel), join(dir, rel));
    }
    mkdirSync(join(dir, 'admin/static'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), '# no tables here\n');
    const r = conformity({ root: dir });
    assert.equal(r.axes.find((a) => a.id === 'off-scale'), undefined, 'a scale it could not read still produced an off-scale count');
    assert.ok(r.undetermined.some((u) => u.axis === 'off-scale'), 'the missing scale was not reported');
  });

  test('POSITIVE CONTROL: a planted colour literal is counted, and a planted allowance file does not travel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-uic-plant-'));
    for (const rel of ['docs/THEME.md', 'admin/panel.html', 'admin/config.html']) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true });
      cpSync(join(ROOT, rel), join(dir, rel));
    }
    mkdirSync(join(dir, 'admin/static'), { recursive: true });
    // The brand key, in a file no allowance names: an allowance is bound to its files.
    writeFileSync(join(dir, 'admin/static/planted.js'), 'const c="#C9A227";\n');
    const r = conformity({ root: dir });
    const hits = r.axes.find((a) => a.id === 'colour-literal').hits;
    assert.deepEqual(hits, [{ file: 'admin/static/planted.js', value: '#C9A227' }]);
  });
});

test('the build artefact is never the thing measured or fixed', () => {
  const files = surfaces({ root: ROOT });
  assert.ok(!files.includes('admin/index.html'),
    'admin/index.html is composed by bin/build-admin-panel.mjs, so a deviation fixed there dies at the next build');
  assert.ok(files.includes('admin/panel.html') && files.some((f) => f.startsWith('admin/menus/')),
    'the component sources are not being read, so the measurement is over nothing that can be edited');
  for (const d of PALETTE_DEFINERS) assert.ok(files.includes(d), `${d} is not among the surfaces, so its literals are not being excluded deliberately`);
});

test('CW_UIC_ROOT is read at call time', () => {
  const before = conformityRoot();
  const dir = mkdtempSync(join(tmpdir(), 'cw-uic-env-'));
  const prev = process.env.CW_UIC_ROOT;
  process.env.CW_UIC_ROOT = dir;
  try { assert.equal(conformityRoot(), resolve(dir)); }
  finally { if (prev === undefined) delete process.env.CW_UIC_ROOT; else process.env.CW_UIC_ROOT = prev; }
  assert.equal(conformityRoot(), before);
});
