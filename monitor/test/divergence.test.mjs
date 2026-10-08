// divergence.test.mjs — D3: the score over two triage-verdicts, the correlated-agreement discount,
// one-side-absent = undefined (grey, not 0/1), and the oscilloscope icon's measured(green)/unmeasured(grey)
// contract (a measured 0.00 is GREEN, never grey; grey is only the unmeasured/absent state).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { divergenceScore, recordDivergence, WEIGHTS } from '../divergence.mjs';
import { oscilloscopeSVG, iconState } from '../divergence-icon.mjs';

const v = (verdict, findings) => ({ verdict, findings });
const f = (id, classification) => ({ id, classification });

describe('divergenceScore', () => {
  test('identical verdicts score 0 — agreement', () => {
    const a = v('clean', [f('x', 'false-positive'), f('y', 'false-positive')]);
    assert.equal(divergenceScore(a, a).score, 0);
  });

  test('opposed poles (real vs false-positive) on the same finding score high', () => {
    const r = divergenceScore(v('mixed', [f('x', 'real')]), v('mixed', [f('x', 'false-positive')]));
    assert.equal(r.components.perFinding, 1);
    assert.ok(r.score >= WEIGHTS.perFinding);
  });

  test('needs-human vs a pole is adjacent (0.5), not opposed', () => {
    const r = divergenceScore(v('mixed', [f('x', 'real')]), v('mixed', [f('x', 'needs-human')]));
    assert.equal(r.components.perFinding, 0.5);
  });

  test('a finding only ONE side named is coverage disagreement', () => {
    const r = divergenceScore(v('mixed', [f('x', 'real'), f('y', 'real')]), v('mixed', [f('x', 'real')]));
    assert.ok(r.components.coveragePenalty > 0);
    assert.ok(r.score > 0);
  });

  test('ONE SIDE ABSENT ⇒ score null (undefined) — never 0, never 1', () => {
    assert.equal(divergenceScore(null, v('clean', [])).score, null);
    assert.equal(divergenceScore(v('clean', []), undefined).score, null);
  });

  test('correlated-agreement DISCOUNT: a low score rises with correlation', () => {
    const a = v('mixed', [f('x', 'real'), f('y', 'needs-human')]);
    const b = v('mixed', [f('x', 'real'), f('y', 'real')]); // small disagreement
    const low = divergenceScore(a, b, { correlation: 0 }).score;
    const disc = divergenceScore(a, b, { correlation: 0.9 }).score;
    assert.ok(disc > low, `discount should raise a low score: ${disc} > ${low}`);
  });

  test('recordDivergence writes to the nondeterministic store; null score records nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-div-'));
    const prev = process.env.CW_NONDET_STORE; process.env.CW_NONDET_STORE = dir;
    try {
      const r = recordDivergence({ subject: 'repo/x', verdictA: v('mixed', [f('x', 'real')]), verdictB: v('mixed', [f('x', 'false-positive')]) });
      assert.equal(r.recorded, true);
      assert.equal(existsSync(join(dir, 'divergence', 'repo_x.jsonl')), true);
      const none = recordDivergence({ subject: 'repo/y', verdictA: null, verdictB: v('clean', []) });
      assert.equal(none.recorded, false);
      assert.equal(existsSync(join(dir, 'divergence', 'repo_y.jsonl')), false);
    } finally { if (prev === undefined) delete process.env.CW_NONDET_STORE; else process.env.CW_NONDET_STORE = prev; }
  });
});

describe('oscilloscope icon — explicit uncertainty in one glyph', () => {
  test('a MEASURED 0.00 is GREEN (a flat trace at the baseline), never grey', () => {
    const svg = oscilloscopeSVG({ score: 0, theme: 'dark' });
    assert.match(svg, /#00e05a/);
    assert.doesNotMatch(svg, /#5a5a5a/);
    assert.match(svg, /<circle/); // the dot is present — it IS measured
    assert.match(svg, /aria-label="divergence 0\.00"/);
  });

  test('UNMEASURED / one-side-absent is GREY, with no dot and a "not measured" label', () => {
    const svg = oscilloscopeSVG({ score: null });
    assert.match(svg, /#5a5a5a/);
    assert.doesNotMatch(svg, /#00e05a/);
    assert.doesNotMatch(svg, /<circle/);
    assert.match(svg, /aria-label="divergence not measured"/);
  });

  test('measured and unmeasured SVGs differ; the FIELD follows the theme, not the state', () => {
    assert.notEqual(oscilloscopeSVG({ score: 0.5 }), oscilloscopeSVG({ score: null }));
    assert.match(oscilloscopeSVG({ score: 0.5, theme: 'light' }), /#f6f7f9/); // light field
    assert.match(oscilloscopeSVG({ score: 0.5, theme: 'dark' }), /#0f1319/);  // dark field
  });

  test('iconState names the state for a colour-blind-safe caller', () => {
    assert.equal(iconState({ score: 0 }), 'measured');
    assert.equal(iconState({ score: null }), 'not-measured');
  });
});
