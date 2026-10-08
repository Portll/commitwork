// node --test sitemap/test/ — light and dark modes. Every view has a complete palette in both
// modes, every label and severity colour is readable on the ground it is drawn on, the chrome's
// tokens are complete and readable in both blocks, and the page carries the shared follower
// byte-for-byte. Tables and helpers are LIFTED from demo.html by source anchor and evaluated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FOLLOWER_JS } from '../../lib/theme-follower.mjs';
import { houseTokens, houseTokenValues } from '../../lib/house-css.mjs';
import { SEAL_SVG, markRecolourCss } from '../../lib/brand-tokens.mjs';

const SRC = readFileSync(fileURLToPath(new URL('../demo.html', import.meta.url)), 'utf8');

function lift(startAnchor, endAnchor, label) {
  const a = SRC.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found in demo.html — the lift is stale, not the code`);
  const b = SRC.indexOf(endAnchor, a);
  assert.ok(b > a, `${label}: end anchor not found after start — the lift is stale`);
  return SRC.slice(a, b + endAnchor.length);
}

const SEV = new Function(`${lift('const SEV_COLOR=', '(0.8+0.4*ph));', 'severity tables')}
return { SEV_COLOR, SEV_UNKNOWN, SEV_COLOR_LIGHT, SEV_UNKNOWN_LIGHT };`)();
const sevVar = new Function('SEV_COLOR', `${lift('const sevVar=', "'unknown')+')';", 'sevVar')}\nreturn sevVar;`)(SEV.SEV_COLOR);
const V = new Function('SEV_COLOR', 'SEV_UNKNOWN', 'SEV_COLOR_LIGHT', 'SEV_UNKNOWN_LIGHT',
  `${lift('const THEMES={', 'sevUnknown:SEV_UNKNOWN_LIGHT},\n};', 'view tables')}\nreturn { THEMES, THEME_MODES, themeFor, MODE_LAYER };`,
)(SEV.SEV_COLOR, SEV.SEV_UNKNOWN, SEV.SEV_COLOR_LIGHT, SEV.SEV_UNKNOWN_LIGHT);

// The scene helpers read the view being drawn (TH) and THREE; both are stubbed, and TH is set
// through the returned setter exactly as buildScene sets it.
const THREE = { NormalBlending: 'normal', AdditiveBlending: 'additive' };
const scene = new Function('THREE', 'MODE_LAYER', 'document',
  `${lift('let TH=null;', 't.sevUnknown;};', 'scene helpers')}\nreturn { set:(t)=>{TH=t;}, curMode, blend, lp, sceneSev };`,
)(THREE, V.MODE_LAYER, { documentElement: { getAttribute: () => 'light' } });

const VIEWS = Object.keys(V.THEMES);
const MODES = ['dark', 'light'];

const hex = (h) => (typeof h === 'number' ? h : parseInt(String(h).replace('#', ''), 16));
const lum = (h) => {
  const ch = [16, 8, 0].map((s) => ((hex(h) >> s) & 255) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = (n) => '#' + n.toString(16).padStart(6, '0');
// rgba() over an opaque ground -> the colour the eye actually gets
const over = (rgba, ground) => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `not an rgba(): ${rgba}`);
  const a = Number(m[4]), g = hex(ground);
  return [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + ((g >> (16 - 8 * k)) & 255) * (1 - a))).reduce((acc, c) => (acc << 8) | c, 0);
};

// The page's own blocks follow the generated house-css block; read them, not the house tokens.
const PAGE = SRC.slice(SRC.indexOf('</style>', SRC.indexOf('<style id="house-css">')));
const tokens = (selector) => {
  const at = PAGE.indexOf(selector + '{');
  assert.ok(at > -1, `${selector} token block not found`);
  const body = PAGE.slice(at + selector.length + 1, PAGE.indexOf('}', at));
  return Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+):([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
};
const OWN = { dark: tokens(':root'), light: tokens('html[data-mode=light]') };
// Each mode as the page paints it: the house tokens, the page's names resolved through them, and
// the scene tokens that mode declares.
const HOUSE = houseTokenValues();
const resolveIn = (base, t) => Object.fromEntries(Object.entries(t).map(([k, v]) => {
  const m = /^var\(--([\w-]+)\)$/.exec(v);
  return [k, m ? base[m[1]] : v];
}));
const CHROME = {
  dark: resolveIn(HOUSE.dark, { ...HOUSE.dark, ...OWN.dark }),
  light: resolveIn(HOUSE.light, { ...HOUSE.light, ...OWN.dark, ...OWN.light }),
};

test('the page carries the shared follower byte-for-byte, before its styles paint', () => {
  const at = SRC.indexOf(`<script>${FOLLOWER_JS}</script>`);
  assert.ok(at > -1, 'demo.html\'s follower has drifted from lib/theme-follower.mjs FOLLOWER_JS — paste the lib copy');
  assert.ok(at < SRC.indexOf('<style>'), 'the follower must run before the first styled paint');
  assert.equal(SRC.split('(prefers-color-scheme: light)').length - 1, 1, 'one follower, not two');
});

test('mainline.html carries the same follower before its styles, and rebuilds its scene on a mode change', () => {
  const page = readFileSync(fileURLToPath(new URL('../mainline.html', import.meta.url)), 'utf8');
  const at = page.indexOf(`<script>${FOLLOWER_JS}</script>`);
  assert.ok(at > -1, 'mainline.html\'s follower has drifted from lib/theme-follower.mjs FOLLOWER_JS — paste the lib copy');
  assert.ok(at < page.indexOf('<style'), 'the follower must run before the first styled paint');
  assert.match(page, /addEventListener\('cw-mode'/, 'without the listener the 3D scene keeps the palette it was built in');
  assert.ok(page.includes(`<span class="seal">${SEAL_SVG}</span>`), 'the header seal is not the exact SEAL_SVG');
  assert.ok(page.includes(markRecolourCss('html[data-mode=light] header h1 .seal')), 'on a light ground the header seal must take the default mark');
});

test('every view has both modes, and each mode only overrides keys the view already has', () => {
  assert.deepEqual(Object.keys(V.THEME_MODES).sort(), [...VIEWS].sort(), 'a view without THEME_MODES renders one mode only');
  for (const k of VIEWS) {
    for (const m of MODES) {
      const o = V.THEME_MODES[k][m];
      assert.ok(o && typeof o === 'object', `${k}.${m} missing`);
      for (const key of Object.keys(o)) assert.ok(key in V.THEMES[k], `${k}.${m}.${key} overrides nothing — a misspelt key is silently ignored`);
    }
  }
});

const REQUIRED = {
  common: ['bg', 'fog', 'dark'],
  scene: ['dirColor', 'lineColor', 'svcInk', 'svcInkDim', 'mat', 'sat', 'light'],
  plane: ['groundColor'],
  noir: ['floor'],
  monolith: ['grid', 'hud', 'hudDim'],
};
const required = (t) => [...REQUIRED.common, ...(t.layout === 'monolith' ? REQUIRED.monolith
  : [...REQUIRED.scene, ...(t.ground === 'plane' ? REQUIRED.plane : []), ...(t.ground === 'noir' ? REQUIRED.noir : [])])];

test('every view x mode has a complete palette', () => {
  for (const k of VIEWS) {
    for (const m of MODES) {
      const t = V.themeFor(k, m);
      for (const key of required(t)) assert.ok(t[key] !== undefined, `${k}/${m} has no ${key}`);
      assert.equal(t.fog[0], t.bg, `${k}/${m}: fog must fade into the ground it stands on`);
    }
  }
});

test('the mode is really switched: a light ground is light and a dark ground is dark', () => {
  for (const k of VIEWS) {
    const d = V.themeFor(k, 'dark'), l = V.themeFor(k, 'light');
    assert.equal(d.dark, true, `${k}/dark`);
    assert.equal(l.dark, false, `${k}/light`);
    assert.ok(lum(d.bg) <= 0.05, `${k}/dark bg ${css(d.bg)} is not dark`);
    assert.ok(lum(l.bg) >= 0.6, `${k}/light bg ${css(l.bg)} is not light`);
  }
});

// In light mode a label sits on its own pill, so the worst case is that pill over the darkest thing
// in the scene. In dark mode it is shadowed text over the ground.
const PILL = SRC.match(/html\[data-mode=light\] \.svclabel\{background:(rgba\([^)]*\))/)?.[1];

test('every service label reads at 4.5:1 or better on its ground, and dimmed is dimmer, never hidden', () => {
  assert.ok(PILL, 'the light label pill is gone');
  for (const k of VIEWS) {
    for (const m of MODES) {
      const t = V.themeFor(k, m);
      const [ink, dim] = t.layout === 'monolith' ? [t.hud, t.hudDim] : [t.svcInk, t.svcInkDim];
      const grounds = t.dark ? [t.bg, ...(t.ground === 'plane' ? [t.groundColor] : [])] : [t.bg, over(PILL, 0x000000)];
      for (const g of grounds) {
        for (const [name, c] of [['label', ink], ['dimmed label', dim]]) {
          const r = contrast(c, g);
          assert.ok(r >= 4.5, `${k}/${m} ${name} ${c} on ${css(g)} is ${r.toFixed(2)}:1`);
        }
        assert.ok(contrast(dim, g) < contrast(ink, g), `${k}/${m}: a superseded service must read as dimmer than a live one`);
      }
    }
  }
});

test('the container label reads on every interior view in each mode', () => {
  for (const k of VIEWS) {
    for (const m of MODES) {
      const t = V.themeFor(k, m);
      if (t.layout === 'monolith') continue;
      const ink = V.MODE_LAYER[t.dark ? 'dark' : 'light'].hullInk;
      assert.ok(contrast(ink, t.bg) >= 4.5, `${k}/${m} container label ${ink} is ${contrast(ink, t.bg).toFixed(2)}:1`);
    }
  }
});

test('a glow\'s severity colour stands out from the ground it is drawn on (3:1, non-text)', () => {
  for (const k of VIEWS) {
    for (const m of MODES) {
      const t = V.themeFor(k, m);
      if (t.layout === 'monolith') continue; // faults sit on the obsidian slab in both modes and keep the bright ramp
      scene.set(t);
      for (const s of ['critical', 'high', 'medium', 'low', 'no-such-severity']) {
        const c = scene.sceneSev(s), r = contrast(c, t.bg);
        assert.ok(r >= 3, `${k}/${m} ${s} ${css(c)} on ${css(t.bg)} is ${r.toFixed(2)}:1`);
      }
    }
  }
});

test('the scene picks its ramp and blending from the ground it is drawing', () => {
  scene.set(V.themeFor('city', 'light'));
  assert.equal(scene.blend(), 'normal', 'additive light washes out on a light ground');
  assert.equal(scene.sceneSev('critical'), SEV.SEV_COLOR_LIGHT.critical);
  assert.equal(scene.sceneSev('constructor'), SEV.SEV_UNKNOWN_LIGHT, 'a prototype key is not a severity');
  scene.set(V.themeFor('city', 'dark'));
  assert.equal(scene.blend(), 'additive');
  assert.equal(scene.sceneSev('critical'), SEV.SEV_COLOR.critical);
  assert.equal(scene.lp(), V.MODE_LAYER.dark);
  assert.equal(SRC.split('THREE.AdditiveBlending').length - 1, 1, 'every additive site goes through blend()');
  assert.equal(SRC.split('blending:blend()').length - 1, 1, 'the aperture pass is the one blend() site (blend-depth.test.mjs)');
});

test('the layer palettes carry the same keys in both modes', () => {
  assert.deepEqual(Object.keys(V.MODE_LAYER.light).sort(), Object.keys(V.MODE_LAYER.dark).sort());
});

const TEXT = ['ink', 'mut', 'dim', 'acc', 'link', 'ok', 'warn', 'bad', 'vuln', 'live', 'sev-critical', 'sev-high', 'sev-medium', 'sev-low', 'sev-unknown'];

test('the light chrome restates every literal the dark chrome declares; aliases follow the house tokens', () => {
  assert.ok(SRC.includes(houseTokens()), 'the house tokens are not in the page');
  for (const [name, v] of Object.entries(OWN.dark)) {
    if (/^var\(--[\w-]+\)$/.test(v)) continue;
    assert.ok(name in OWN.light, `--${name} has no light value — it would keep its dark one`);
  }
  assert.doesNotMatch(PAGE, /(?<![\w-])--(?:bg|ink|acc)\s*:/, 'the page declares a ground, ink or accent beside the house ones');
});

test('every chrome text token reads at 4.5:1 or better on the page, the panels and the cards, in both modes', () => {
  for (const m of MODES) {
    const T = CHROME[m];
    for (const name of TEXT) {
      for (const g of ['bg', 'panel', 'card']) {
        const r = contrast(T[name], T[g]);
        assert.ok(r >= 4.5, `${m} --${name} ${T[name]} on --${g} ${T[g]} is ${r.toFixed(2)}:1`);
      }
    }
  }
});

test('the fault key reads over the scene it floats on', () => {
  for (const m of MODES) {
    const T = CHROME[m], ground = V.themeFor('megalith', m).bg, bg = over(T['key-bg'], ground);
    for (const name of ['key-h', 'key-t', 'mut', 'dim']) {
      const r = contrast(T[name], bg);
      assert.ok(r >= 4.5, `${m} --${name} on the fault key is ${r.toFixed(2)}:1`);
    }
  }
});

test('the card\'s severity tokens are the scene\'s ramps, so a card and its glow agree', () => {
  for (const [m, ramp, unknown] of [['dark', SEV.SEV_COLOR, SEV.SEV_UNKNOWN], ['light', SEV.SEV_COLOR_LIGHT, SEV.SEV_UNKNOWN_LIGHT]]) {
    for (const [s, c] of Object.entries(ramp)) assert.equal(CHROME[m][`sev-${s}`], css(c), `${m} --sev-${s}`);
    assert.equal(CHROME[m]['sev-unknown'], css(unknown), `${m} --sev-unknown`);
  }
});

test('a severity names its token only when it is one; anything else is unknown', () => {
  assert.equal(sevVar('critical'), 'var(--sev-critical)');
  assert.equal(sevVar('medium'), 'var(--sev-medium)');
  for (const s of ['bogus', undefined, 'constructor', '__proto__', 'x);background:url(//e)']) assert.equal(sevVar(s), 'var(--sev-unknown)');
});

test('the view redraws when the mode changes, and ?view= selects a view without storing it', () => {
  assert.match(SRC, /const T=TH=themeFor\(curTheme,curMode\(\)\);/, 'buildScene draws the view for the current mode');
  const h = SRC.match(/addEventListener\('cw-mode',\(\)=>\{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(h, 'no cw-mode listener');
  assert.match(h, /buildScene\(\)/);
  assert.match(SRC, /let curTheme=isView\(VIEW_PARAM\)\?VIEW_PARAM:/);
  const isView = new Function('THEMES', `${lift('const isView=', 'hasOwnProperty.call(THEMES,k);', 'isView')}\nreturn isView;`)(V.THEMES);
  assert.equal(isView('noir'), true);
  assert.equal(isView('toString'), false, 'a prototype name is not a view');
});
