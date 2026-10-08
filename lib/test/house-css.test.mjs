import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  houseCss, houseTokens, houseFonts, houseBase, houseTokenValues, HOUSE_TOKEN_NAMES, HOUSE_FACES, PILL_VARIANTS, PLEX_NOTICE,
} from '../house-css.mjs';
import { LIGHT, DARK, LIGHT_SEMANTIC, DARK_SEMANTIC, MONO, SANS } from '../brand-tokens.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONT_DIR = join(REPO, 'admin', 'static', 'fonts');

// ── a small CSS reader: enough for these sheets, which carry no braces inside strings ───────────

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function splitTop(s, sep) {
  const out = [];
  let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

function parseDecls(body) {
  return splitTop(body, ';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const k = d.indexOf(':');
    assert.ok(k > 0, `not a declaration: ${d}`);
    return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
  });
}

function parseCss(css) {
  const text = stripComments(css);
  let i = 0;
  const block = () => {
    const rules = [];
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i >= text.length) return rules;
      if (text[i] === '}') { i++; return rules; }
      const open = text.indexOf('{', i);
      assert.ok(open > 0, `unterminated rule at ${i}`);
      const prelude = text.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith('@media')) { rules.push({ prelude, rules: block() }); continue; }
      const close = text.indexOf('}', i);
      rules.push({ prelude, decls: parseDecls(text.slice(i, close)) });
      i = close + 1;
    }
  };
  return block();
}

const flat = (rules) => rules.flatMap((r) => (r.rules ? flat(r.rules) : [r]));
const declMap = (rule) => {
  const m = new Map();
  for (const [k, v] of rule.decls) {
    assert.ok(!m.has(k), `${rule.prelude} declares ${k} twice`);
    m.set(k, v);
  }
  return m;
};
const ruleFor = (rules, prelude) => {
  const hits = rules.filter((r) => r.prelude === prelude);
  assert.equal(hits.length, 1, `expected exactly one "${prelude}" rule, found ${hits.length}`);
  return declMap(hits[0]);
};

function panelRoot(file) {
  const css = stripComments(readFileSync(join(REPO, 'admin', 'static', file), 'utf8'));
  const m = /(?:^|\})\s*:root\s*\{([^}]*)\}/.exec(css);
  assert.notEqual(m, null, `${file} has no bare :root block`);
  return new Map(parseDecls(m[1]));
}

const fontFaces = (css) => [...stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/g)]
  .map((m) => Object.fromEntries(parseDecls(m[1])));

// ── tokens ──────────────────────────────────────────────────────────────────────────────────────

const expected = (base, semantic) => {
  const out = {};
  for (const [k, v] of Object.entries(base)) out[k === 'ok' ? 'live' : k] = v;
  for (const [k, v] of Object.entries(semantic)) out[k] = v;
  out.done = base.sev;
  out['done-fill'] = semantic['sev-fill'];
  return out;
};

describe('tokens', () => {
  const rules = parseCss(houseTokens());
  const root = ruleFor(rules, ':root');
  const dark = ruleFor(rules, 'html[data-mode=dark]');

  test('light on :root and dark on html[data-mode=dark] carry exactly LIGHT and DARK', () => {
    for (const [label, decl, want] of [['light', root, expected(LIGHT, LIGHT_SEMANTIC)], ['dark', dark, expected(DARK, DARK_SEMANTIC)]]) {
      for (const [name, value] of Object.entries(want)) assert.equal(decl.get(`--${name}`), value, `${label} --${name}`);
      const custom = [...decl.keys()].filter((k) => k.startsWith('--')).map((k) => k.slice(2));
      const extra = label === 'light' ? ['mono', 'sans', 'cra-50', 'cra-75', 'cra-90', 'cra-over'] : [];
      assert.deepEqual(custom.sort(), [...HOUSE_TOKEN_NAMES, ...extra].sort(), `${label} declares a token outside the house vocabulary`);
    }
    assert.equal(root.get('color-scheme'), 'light');
    assert.equal(dark.get('color-scheme'), 'dark');
    assert.equal(root.get('--mono'), `"IBM Plex Mono",${MONO}`);
    assert.equal(root.get('--sans'), `"IBM Plex Sans",${SANS}`);
    for (const [clock, sev] of [['50', 'low'], ['75', 'med'], ['90', 'high'], ['over', 'crit']]) {
      assert.equal(root.get(`--cra-${clock}`), `var(--${sev})`, `--cra-${clock} must alias the ramp so each theme re-grades it`);
    }
  });

  test('every house colour token equals the panel stylesheets — the second witness', () => {
    const light = panelRoot('panel-light.css');
    const panel = panelRoot('panel.css');
    const values = houseTokenValues();
    for (const name of HOUSE_TOKEN_NAMES) {
      assert.equal(values.light[name], light.get(`--${name}`), `light --${name} differs from panel-light.css`);
      assert.equal(values.dark[name], panel.get(`--${name}`), `dark --${name} differs from panel.css`);
    }
  });

  test('a page opened with scripts off follows the OS: the no-JS block is the dark set', () => {
    const media = rules.filter((r) => r.rules);
    assert.equal(media.length, 1);
    assert.match(media[0].prelude, /^@media\s*\(prefers-color-scheme:\s*dark\)$/);
    const fallback = ruleFor(media[0].rules, 'html:not([data-mode])');
    assert.deepEqual([...fallback.entries()], [...dark.entries()]);
  });

  test('every var() the base sheet reads is a token the sheet defines', () => {
    const defined = new Set([...root.keys()]);
    const used = new Set([...houseBase().matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    assert.ok(used.size > 10, `parsed only ${used.size} var() reads`);
    for (const name of used) assert.ok(defined.has(name), `houseBase() reads ${name}, which no token block defines`);
  });
});

// ── fonts ───────────────────────────────────────────────────────────────────────────────────────

describe('fonts', () => {
  const saved = process.env.CW_FONTS_DIR;
  const temps = [];
  const temp = () => { const d = mkdtempSync(join(tmpdir(), 'house-css-')); temps.push(d); return d; };
  afterEach(() => {
    if (saved === undefined) delete process.env.CW_FONTS_DIR; else process.env.CW_FONTS_DIR = saved;
    while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
  });

  test('served faces are the ones panel.css declares, url for url', () => {
    const key = (f) => JSON.stringify([f['font-family'], f['font-style'], f['font-weight'], f.src, f['unicode-range'], f['font-display']]);
    const panel = fontFaces(readFileSync(join(REPO, 'admin', 'static', 'panel.css'), 'utf8')).map(key).sort();
    const house = fontFaces(houseFonts('served')).map(key).sort();
    assert.equal(panel.length, 8);
    assert.deepEqual(house, panel);
    assert.equal(houseFonts(), houseFonts('served'));
  });

  test('inline reads the directory named by CW_FONTS_DIR at call time', () => {
    const dir = temp();
    for (const f of HOUSE_FACES) writeFileSync(join(dir, f.file), `wOF2${f.file}`);
    process.env.CW_FONTS_DIR = dir;
    const faces = fontFaces(houseFonts('inline'));
    assert.equal(faces.length, HOUSE_FACES.length);
    faces.forEach((f, k) => {
      const m = /^url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\) format\("woff2"\)$/.exec(f.src);
      assert.ok(m, f.src);
      assert.equal(Buffer.from(m[1], 'base64').toString(), `wOF2${HOUSE_FACES[k].file}`);
    });
  });

  test('inline throws on a missing font directory rather than falling back', () => {
    process.env.CW_FONTS_DIR = join(temp(), 'absent');
    assert.throws(() => houseFonts('inline'), (e) => e.code === 'ENOENT' && /IBMPlexSans-Regular-Latin1\.woff2/.test(e.message));
    assert.throws(() => houseCss({ fonts: 'inline' }), (e) => e.code === 'ENOENT');
  });

  test('inline throws on one missing face, and on a file that is not woff2', () => {
    const dir = temp();
    for (const f of HOUSE_FACES.slice(1)) writeFileSync(join(dir, f.file), 'wOF2x');
    process.env.CW_FONTS_DIR = dir;
    assert.throws(() => houseFonts('inline'), (e) => e.code === 'ENOENT');
    writeFileSync(join(dir, HOUSE_FACES[0].file), '<html>not a font');
    assert.throws(() => houseFonts('inline'), /is not a woff2 file/);
  });

  test('weights takes only the faces a page uses, and reads only those files', () => {
    const dir = temp();
    writeFileSync(join(dir, 'IBMPlexSans-SemiBold-Latin1.woff2'), 'wOF2a');
    writeFileSync(join(dir, 'IBMPlexSans-Italic-Latin1.woff2'), 'wOF2b');
    writeFileSync(join(dir, 'IBMPlexMono-Regular-Latin1.woff2'), 'wOF2c');
    process.env.CW_FONTS_DIR = dir;
    const faces = fontFaces(houseFonts('inline', { weights: { sans: [600, 'italic'], mono: [400] } }));
    assert.deepEqual(faces.map((f) => [f['font-family'], f['font-style'], f['font-weight']]),
      [['"IBM Plex Sans"', 'italic', '400'], ['"IBM Plex Sans"', 'normal', '600'], ['"IBM Plex Mono"', 'normal', '400']]);
    assert.deepEqual(fontFaces(houseFonts('served', { weights: { mono: [700] } })).map((f) => f.src),
      ['url("/static/fonts/IBMPlexMono-Bold-Latin1.woff2") format("woff2")']);
    assert.throws(() => houseFonts('served', { weights: { sans: [300] } }), RangeError);
    assert.throws(() => houseFonts('served', { weights: { serif: [400] } }), RangeError);
    assert.throws(() => houseFonts('served', { weights: [400] }), TypeError);
  });

  test('the real faces inline byte for byte', () => {
    delete process.env.CW_FONTS_DIR;
    const [face] = fontFaces(houseFonts('inline', { weights: { mono: [400] } }));
    const b64 = /base64,([^"]+)"/.exec(face.src)[1];
    assert.ok(Buffer.from(b64, 'base64').equals(readFileSync(join(FONT_DIR, 'IBMPlexMono-Regular-Latin1.woff2'))));
  });

  test('an inlined face travels with the OFL notice the licence file carries; a served one points at the file', () => {
    delete process.env.CW_FONTS_DIR;
    const licence = readFileSync(join(FONT_DIR, 'LICENSE-IBM-Plex.txt'), 'utf8').split(/\r?\n/)[0];
    const inline = houseFonts('inline', { weights: { mono: [400] } });
    assert.ok(inline.startsWith(PLEX_NOTICE), 'the notice must precede the faces it covers');
    assert.ok(PLEX_NOTICE.includes(licence.replace(/^Copyright /, '')), `the notice no longer quotes "${licence}"`);
    assert.match(PLEX_NOTICE, /SIL Open Font License, Version 1\.1/);
    assert.doesNotMatch(PLEX_NOTICE, /https?:\/\//, 'a self-contained artifact carries no URL, and the notice lands in every one');
    assert.ok(!houseFonts('served').includes(PLEX_NOTICE), 'a served face stays beside LICENSE-IBM-Plex.txt');
    assert.equal(houseFonts('inline', { weights: {} }), '', 'no face inlined, no notice');
    assert.ok(houseCss({ fonts: 'inline', weights: { sans: [400] } }).includes(PLEX_NOTICE));
  });

  test("'none' emits no @font-face, and an unknown mode is refused", () => {
    assert.equal(houseFonts('none'), '');
    const css = houseCss({ fonts: 'none' });
    assert.equal(fontFaces(css).length, 0);
    assert.ok(flat(parseCss(css)).some((r) => r.prelude === ':root'));
    assert.throws(() => houseFonts('cdn'), RangeError);
  });
});

// ── base elements ───────────────────────────────────────────────────────────────────────────────

describe('base', () => {
  const rules = flat(parseCss(houseBase()));
  const rule = (p) => ruleFor(rules, p);

  test('body sets the ground, the ink and the Sans body; headings are --head at 600', () => {
    const body = rule('body');
    assert.equal(body.get('background'), 'var(--bg)');
    assert.equal(body.get('color'), 'var(--ink)');
    assert.match(body.get('font'), /\svar\(--sans\)$/);
    const h = rule('h1,h2,h3,h4,h5,h6');
    assert.equal(h.get('color'), 'var(--head)');
    assert.equal(h.get('font-weight'), '600');
    assert.equal(h.get('font-family'), 'var(--sans)');
  });

  test('links underline in --acc; code is --head on --panel2; th is Mono uppercase --head on --panel2', () => {
    const a = rule('a');
    assert.equal(a.get('text-decoration'), 'underline');
    assert.equal(a.get('text-decoration-color'), 'var(--acc)');
    const code = rule('code');
    assert.equal(code.get('color'), 'var(--head)');
    assert.equal(code.get('background'), 'var(--panel2)');
    const th = rule('th');
    assert.match(th.get('font'), /\svar\(--mono\)$/);
    assert.equal(th.get('text-transform'), 'uppercase');
    assert.equal(th.get('color'), 'var(--head)');
    assert.equal(th.get('background'), 'var(--panel2)');
  });

  test('a hovered row takes a 2px --acc2 rule on its first cell and never a fill', () => {
    const hover = rules.filter((r) => /\btr:hover\b/.test(r.prelude));
    assert.ok(hover.length >= 1);
    for (const r of hover) {
      for (const [k] of r.decls) assert.doesNotMatch(k, /^background/, `${r.prelude} fills the row`);
    }
    assert.equal(rule('tbody tr:hover>td:first-child').get('box-shadow'), 'inset 2px 0 0 var(--acc2)');
  });

  test('focus is a 2px --acc outline, and .tnum sets tabular figures', () => {
    assert.equal(rule(':focus-visible').get('outline'), '2px solid var(--acc)');
    assert.equal(rule('.tnum').get('font-variant-numeric'), 'tabular-nums');
  });

  test('every pill variant derives its fill at 12% and its border at 28% of its own token', () => {
    const mix = (t, p) => `color-mix(in srgb,var(--${t}) ${p}%,transparent)`;
    for (const [cls, token] of Object.entries(PILL_VARIANTS)) {
      const r = rule(`.pill.${cls}`);
      assert.equal(r.get('color'), `var(--${token})`, cls);
      assert.equal(r.get('background'), cls === 'exploited' ? 'var(--sev-fill)' : mix(token, 12), cls);
      assert.equal(r.get('border-color'), mix(token, 28), cls);
      assert.equal(rule(`.pill.${cls}::before`).get('background'), `var(--${token})`, cls);
    }
    for (const t of ['live', 'part', 'plan', 'crit', 'high', 'med', 'low']) assert.ok(Object.values(PILL_VARIANTS).includes(t), t);
  });

  // THEME.md Rule 7: an unknown is drawn as an absence. A page that needs one takes these, not a
  // style of its own; the panel's rules are the second witness.
  test('.pill.unk and .pill.na carry no state colour and no fill, and equal the panel rules', () => {
    const STATE = /var\(--(?:live|part|crit|high|med|low|sev|done|machine|attest)\)/;
    const panel = stripComments(readFileSync(join(REPO, 'admin', 'static', 'panel.css'), 'utf8'));
    const panelRule = (sel) => {
      const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(panel);
      assert.notEqual(m, null, `panel.css has no ${sel} rule`);
      return new Map(parseDecls(m[1]));
    };
    for (const sel of ['.pill.unk', '.pill.na', '.pill.na::before']) {
      const house = rule(sel);
      for (const [k, v] of house) assert.doesNotMatch(v, STATE, `${sel} ${k} takes a state colour`);
      if (house.has('background')) assert.equal(house.get('background'), 'transparent', `${sel} is filled`);
      assert.deepEqual([...house].sort(), [...panelRule(sel)].sort(), `${sel} differs from panel.css`);
    }
    assert.equal(rule('.pill.unk').get('border-style'), 'dashed');
  });

  test('no text is set below .625rem, and relative sizes carry the floor', () => {
    const FLOOR = 0.625;
    const floorOf = (v) => {
      let m;
      if ((m = /^(\d*\.?\d+)rem$/.exec(v))) return Number(m[1]);
      if ((m = /^(\d*\.?\d+)px$/.exec(v))) return Number(m[1]) / 16;
      if ((m = /^max\((.*)\)$/.exec(v))) {
        const abs = splitTop(m[1], ',').map((x) => floorOf(x.trim())).filter((x) => x !== null);
        return abs.length ? Math.max(...abs) : null;
      }
      return null;
    };
    const sizeOf = (prop, v) => {
      if (prop === 'font-size') return v;
      const m = /^(?:(?:italic|normal|oblique|bold|[1-9]00)\s+)*((?:max|min|clamp)\([^)]*\)|[\d.]+[a-z%]+|inherit)(?:\/\S+)?\s/.exec(`${v} `);
      assert.ok(m || v === 'inherit', `cannot read a size from font:${v}`);
      return m ? m[1] : 'inherit';
    };
    let seen = 0;
    for (const r of flat(parseCss(houseCss({ fonts: 'none' })))) {
      for (const [k, v] of r.decls) {
        if (k !== 'font-size' && k !== 'font') continue;
        const size = sizeOf(k, v);
        if (size === 'inherit') continue;
        seen++;
        const floor = floorOf(size);
        assert.notEqual(floor, null, `${r.prelude} sets ${k}:${v}, a relative size with no rem floor`);
        assert.ok(floor >= FLOOR, `${r.prelude} sets ${k}:${v}, below .625rem`);
      }
    }
    assert.ok(seen >= 12, `read only ${seen} sizes`);
  });
});

describe('output', () => {
  test('same inputs give byte-identical output', () => {
    assert.equal(houseCss(), houseCss());
    assert.equal(houseCss({ fonts: 'none' }), houseCss({ fonts: 'none' }));
    assert.equal(houseCss({ fonts: 'inline', weights: { sans: [400] } }), houseCss({ fonts: 'inline', weights: { sans: [400] } }));
  });

  test('houseCss is the fonts, then the tokens, then the base', () => {
    assert.equal(houseCss(), `${houseFonts('served')}\n${houseTokens()}\n${houseBase()}`);
    assert.equal(houseCss({ fonts: 'none' }), `${houseTokens()}\n${houseBase()}`);
  });
});
