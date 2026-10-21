// The modernization map follows the admin panel's light/dark choice through
// lib/theme-follower.mjs. A synthetic project is rendered for real and the artifact is read back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { FOLLOWER_JS } from '../../lib/theme-follower.mjs';
import { houseTokens, houseTokenValues } from '../../lib/house-css.mjs';

const MAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function render() {
  const root = mkdtempSync(join(tmpdir(), 'cw-map-modes-'));
  try {
    writeFileSync(join(root, 'data.json'), JSON.stringify({
      meta: { title: 'Acme Widgets', subtitle: 'synthetic', asOf: '2026-08-20', logo: null, kpis: [], counts: { resolved: 0, open: 1, inProgress: 0 }, severityLegend: {}, statusLegend: {} },
      versionAxis: [{ id: 'old', era: 'Legacy', band: 'legacy' }, { id: 'cur', era: 'Current', band: 'now' }],
      waves: [{ id: 'w1', short: 'W1', label: 'first wave', axis: 'cur', status: 'done' }],
      tracks: [{ id: 'svc-a', index: 0, cohort: 'app', colour: '#0072bc', enter: 'old', reach: 'cur', cve: { total: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } }],
      infraSiding: [],
      subsystems: [{ subsystemId: 's1', subsystemName: 'Core', color: '#0072bc', nodes: [{ name: 'svc-a', kind: 'service', currentVersion: '1.0', journey: [], issues: [] }] }],
      remediationLog: [],
    }));
    execFileSync('node', [join(MAP, 'generate.mjs')], { env: { ...process.env, MAP_ROOT: root }, stdio: 'pipe' });
    return readFileSync(join(root, 'index.html'), 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const HTML = render();

function palette(selector) {
  const at = HTML.indexOf(selector + '{');
  assert.ok(at > -1, `no ${selector} palette`);
  const body = HTML.slice(at + selector.length + 1, HTML.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
}
const lum = (h) => {
  const n = parseInt(h.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
  const ch = [16, 8, 0].map((s) => ((n >> s) & 255) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the map inlines the shared follower in <head>, before its styles', () => {
  const at = HTML.indexOf(`<script>${FOLLOWER_JS}</script>`);
  assert.ok(at > -1, 'the shared follower is not inlined');
  assert.ok(at < HTML.indexOf('<style>') && at < HTML.indexOf('</head>'));
  assert.equal(HTML.split(FOLLOWER_JS).length - 1, 1);
});

// The page's own :root block: the first one after the house tokens.
function ownRoot() {
  const rest = HTML.slice(HTML.indexOf(houseTokens()) + houseTokens().length);
  const at = rest.indexOf(':root{');
  assert.ok(at > -1, 'the map has no alias block after the house tokens');
  const body = rest.slice(at + 6, rest.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
}

// The map takes the house palette: houseTokens() carries both modes, and the page's own names are
// aliases onto it (var(), color-mix, a shadow or the typeface), never a hex value of their own.
test('the map takes the house tokens and declares no palette of its own', () => {
  assert.ok(HTML.includes(houseTokens()), 'the house tokens are not inlined');
  assert.doesNotMatch(HTML.split(houseTokens()).join(''), /(?<![\w-])--(?:bg|ink|acc)\s*:/, 'the map declares a palette beside the house one');
  const own = ownRoot();
  for (const [k, v] of Object.entries(own)) assert.doesNotMatch(v, /#[0-9a-f]{3,8}\b/i, `--${k} is a literal (${v}), not an alias of a house token`);
  assert.doesNotMatch(HTML, /html\[data-mode=dark\]\{[^}]*--(?:paper|ink2|ink3|hair|crit-ink)\s*:/, 'a dark block restating the aliases would drift from the tokens');
});

test('text reads at 4.5:1 or better on the paper and the panels in both modes', () => {
  const own = ownRoot();
  const tokens = houseTokenValues();
  const resolve = (t, name) => {
    const v = own[name] ?? `var(--${name})`;
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    assert.ok(m, `--${name} is not a plain alias (${v}), so its contrast cannot be read here`);
    return m[1] in t ? t[m[1]] : resolve(t, m[1]);
  };
  for (const [mode, t] of Object.entries({ light: tokens.light, dark: tokens.dark })) {
    for (const fg of ['ink', 'ink2', 'ink3', 'plan-ink', 'done-ink', 'crit-ink', 'high-ink', 'med-ink', 'low-ink', 'open-ink', 'chip-ink', 'pend-ink']) {
      for (const bg of ['paper', 'panel']) {
        const r = contrast(resolve(t, fg), resolve(t, bg));
        assert.ok(r >= 4.5, `${mode}: --${fg} on --${bg} is ${r.toFixed(2)}:1`);
      }
    }
    assert.ok(mode === 'light' ? lum(t.panel) > 0.9 : lum(t.panel) < 0.02, `${mode}: the paper really changes`);
  }
});

test('the map\'s own surfaces are drawn from the tokens, not a white literal', () => {
  // SVG presentation attributes lose to any CSS rule and cannot follow a mode by themselves, so the
  // paper, capsules and badge grounds carry var() in a style, or a class the palette colours.
  assert.doesNotMatch(HTML, /fill:'#fff(fff)?'/, 'a white fill literal in the client script stays white on dark paper');
  assert.match(HTML, /style:'fill:var\(--paper\)'/);
  assert.match(HTML, /\.ic-cap\{fill:var\(--cap\)/);
  assert.match(HTML, /\.cvebadge-bg\{fill:var\(--cap\)/);
  assert.doesNotMatch(HTML, /\.wave-roundel\{[^}]*fill/, 'a CSS fill on the roundel outranks its status colour');
});
