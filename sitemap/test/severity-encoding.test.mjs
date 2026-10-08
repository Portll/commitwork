// node --test sitemap/test/ — backlog F1: severity never rests on colour alone, an unrecognised
// severity is not drawn as high, the pulse keeps each glow part's own opacity, and every severity
// colour is readable against the panels. The constants are LIFTED from demo.html by source anchor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../demo.html', import.meta.url)), 'utf8');

function lift(startAnchor, endAnchor, label) {
  const a = SRC.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found in demo.html — the lift is stale, not the code`);
  const b = SRC.indexOf(endAnchor, a);
  assert.ok(b > a, `${label}: end anchor not found after start — the lift is stale`);
  return SRC.slice(a, b + endAnchor.length);
}

const sevSrc = lift('const SEV_COLOR=', '(0.8+0.4*ph));', 'severity tables');
const SEV = new Function(`${sevSrc}\nreturn { SEV_COLOR, SEV_RANK, SEV_UNKNOWN, SEV_LABEL, sevColor, sevLabel, REDUCED_MOTION, pulseOpacity };`)();

const lum = (hex) => {
  const ch = [16, 8, 0].map((sh) => ((hex >> sh) & 255) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PANEL = 0x141a22;

test('an unrecognised severity has its own colour and label, never high\'s', () => {
  assert.equal(SEV.sevColor('bogus'), SEV.SEV_UNKNOWN);
  assert.notEqual(SEV.sevColor('bogus'), SEV.SEV_COLOR.high);
  assert.equal(SEV.sevLabel('bogus'), '?');
  assert.equal(SEV.sevColor(undefined), SEV.SEV_UNKNOWN);
  assert.ok(!/SEV_COLOR\[[^\]]*\]\|\|0x/.test(SRC), 'no call site may fall back to a fixed severity colour');
});

test('every severity carries a distinct text label beside its colour', () => {
  const labels = Object.keys(SEV.SEV_COLOR).map(SEV.sevLabel);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(!labels.includes('?'));
  assert.match(SRC, /const tag=sevTagSprite\(worst,e\.vulns\.length\)/, 'buildGlows must attach the label');
});

test('every severity colour reads at 4.5:1 or better against the panels', () => {
  for (const [sev, hex] of Object.entries({ ...SEV.SEV_COLOR, unknown: SEV.SEV_UNKNOWN })) {
    const r = contrast(hex, PANEL);
    assert.ok(r >= 4.5, `${sev} #${hex.toString(16)} is ${r.toFixed(2)}:1`);
  }
});

test('the pulse keeps a glow\'s edge brighter than its body at every phase and stack size', () => {
  const EDGE = 0.85, BODY = 0.34;
  for (const n of [1, 2, 4, 9]) {
    for (const ph of [0, 0.25, 0.5, 1]) {
      const edge = SEV.pulseOpacity(EDGE, n, ph), body = SEV.pulseOpacity(BODY, n, ph);
      assert.ok(edge > body, `n=${n} ph=${ph}: edge ${edge} must exceed body ${body}`);
      assert.ok(edge <= 1 && body > 0);
    }
  }
  assert.match(SRC, /sp\.material\.opacity=pulseOpacity\(sp\.userData\.op0,/, 'animate() must scale the captured opacity');
});

test('reduced motion stills the pulse', () => {
  assert.equal(SEV.REDUCED_MOTION, false, 'no matchMedia under node, so the lifted flag reads false');
  assert.match(SRC, /ph=REDUCED_MOTION\?\.5:/);
});
