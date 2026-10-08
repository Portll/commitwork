// bin/lib/theme.mjs's header states which of its colours the panel shares. It once claimed all of
// them, and went on claiming it after the panel moved from orange to gold. This measures the claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE } from '../lib/theme.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hex = (rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;

function panelRoot() {
  const css = readFileSync(join(REPO, 'admin/static/panel.css'), 'utf8');
  const at = css.indexOf(':root{');
  assert.ok(at >= 0, 'admin/static/panel.css has no :root block');
  const root = css.slice(at, css.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  const panel = Object.fromEntries([...root.matchAll(/--([a-z0-9-]+):(#[0-9a-fA-F]{6})\b/g)].map(([, k, v]) => [k, v.toLowerCase()]));
  assert.ok(panel.acc && panel.live && panel.bg, 'panel :root parsed to nothing usable');
  return panel;
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every token but blocked is the panel :root value of the same name, as the theme header says', () => {
  const panel = panelRoot();
  const differs = Object.keys(PALETTE).filter((k) => panel[k] !== hex(PALETTE[k])).sort();
  assert.deepEqual(differs, ['blocked'], 'the colours shared with the panel changed; update the header of bin/lib/theme.mjs to match');
  assert.equal(panel.blocked, undefined, 'the panel now has a --blocked token; the terminal should take it');
  const header = readFileSync(join(REPO, 'bin/lib/theme.mjs'), 'utf8').split('\n').slice(0, 12)
    .map((l) => l.replace(/^\/\/ ?/, '')).join(' ');
  assert.match(header, /Every token except `blocked` is the same-named token in admin\/static\/panel\.css :root/);
});

test('blocked is distinct from crit and high and clears 4.5:1 on the dark --bg', () => {
  const panel = panelRoot();
  assert.notEqual(hex(PALETTE.blocked), hex(PALETTE.crit));
  assert.notEqual(hex(PALETTE.blocked), hex(PALETTE.high));
  const ratio = contrast(PALETTE.blocked, rgbOf(panel.bg));
  assert.ok(ratio >= 4.5, `blocked is ${ratio.toFixed(2)}:1 on ${panel.bg}`);
});
