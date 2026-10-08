// node --test sitemap/test/ — prefers-reduced-motion stops auto-rotation in both viewers, as it
// already stills the glow pulse. The flag and the rotation code are LIFTED from each page by source
// anchor and evaluated with matchMedia stubbed both ways, so the tests run the pages' own code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const DEMO = page('demo.html'), MAIN = page('mainline.html');

function lift(src, startAnchor, endAnchor, label) {
  const a = src.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found — the lift is stale, not the code`);
  const b = src.indexOf(endAnchor, a);
  assert.ok(b > a, `${label}: end anchor not found after start — the lift is stale`);
  return src.slice(a, b + endAnchor.length);
}
// matchMedia as the browser answers it: reduce true/false, or absent altogether
const media = (reduce) => (reduce === undefined ? undefined : (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }));

const THEMES = new Function(`${lift(DEMO, 'const THEMES={', '\n};', 'view table')}\nreturn THEMES;`)();
const demoMotion = (reduce) => new Function('matchMedia',
  `${lift(DEMO, 'const SEV_COLOR=', '(0.8+0.4*ph));', 'severity + motion block')}\nreturn { REDUCED_MOTION, spinRate };`)(media(reduce));

test('demo: the drifting views rotate normally and not at all under reduced motion', () => {
  const drifting = Object.keys(THEMES).filter((k) => THEMES[k].autoRotate > 0);
  assert.ok(drifting.length >= 2, `expected the slab views to drift, found ${drifting}`);
  for (const reduce of [false, undefined]) {
    const m = demoMotion(reduce);
    assert.equal(m.REDUCED_MOTION, false);
    for (const k of drifting) assert.equal(m.spinRate(THEMES[k]), THEMES[k].autoRotate, `${k} keeps its drift`);
  }
  const still = demoMotion(true);
  assert.equal(still.REDUCED_MOTION, true);
  for (const k of Object.keys(THEMES)) assert.equal(still.spinRate(THEMES[k]), 0, `${k} must not rotate under reduced motion`);
});

test('demo: buildScene sets rotation only through spinRate', () => {
  assert.match(DEMO, /controls\.autoRotateSpeed=spinRate\(T\);controls\.autoRotate=controls\.autoRotateSpeed>0;/);
  assert.equal((DEMO.match(/controls\.autoRotate=/g) || []).length, 1, 'a second autoRotate assignment would bypass the gate');
  assert.match(DEMO, /ph=REDUCED_MOTION\?\.5:/, 'the glow pulse stays gated too');
});

const mainFlag = lift(MAIN, 'const REDUCED_MOTION=', '.matches;', 'mainline flag');
const mainSpin = lift(MAIN, 'if(controls){controls.autoRotate=', '}', 'mainline animate spin');
const mainToggle = lift(MAIN, 'if(REDUCED_MOTION){', '}', 'mainline spin toggle');

test('mainline: the spin toggle rotates the view, except under reduced motion', () => {
  const rotates = (reduce, spin) => new Function('matchMedia', 'spin',
    `${mainFlag}\nconst controls={};\n${mainSpin}\nreturn controls.autoRotate;`)(media(reduce), spin);
  assert.equal(rotates(false, true), true);
  assert.equal(rotates(undefined, true), true);
  assert.equal(rotates(false, false), false);
  assert.equal(rotates(true, true), false, 'reduced motion must hold the view still even with spin on');
  assert.match(MAIN, /let scene,camera,renderer,controls,raf,spin=false;/, 'spin starts off');
  assert.equal((MAIN.match(/autoRotate=/g) || []).length, 1, 'a second autoRotate assignment would bypass the gate');
});

test('mainline: under reduced motion the spin button is disabled and says why', () => {
  const button = (reduce) => {
    const b = { disabled: false, title: '' };
    new Function('matchMedia', '$', `${mainFlag}\n${mainToggle}`)(media(reduce), () => b);
    return b;
  };
  assert.deepEqual(button(false), { disabled: false, title: '' });
  const off = button(true);
  assert.equal(off.disabled, true);
  assert.match(off.title, /reduced motion/);
});
