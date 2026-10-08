// The report pages the admin panel embeds follow its light/dark choice through
// lib/theme-follower.mjs. Each page is generated for real into a scratch dir, and the assertions
// read the file that was written: the follower is inlined ahead of the styles, the page never
// writes the panel's key on load, and it takes the house palette in both modes, embedded or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLLOWER_JS, TOGGLE_JS } from '../../lib/theme-follower.mjs';
import { houseTokens, houseTokenValues } from '../../lib/house-css.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const lum = (h) => {
  const n = parseInt(h.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
  const ch = [16, 8, 0].map((s) => ((n >> s) & 255) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function assertFollowsMode(html, label) {
  const at = html.indexOf(`<script>${FOLLOWER_JS}</script>`);
  assert.ok(at > -1, `${label}: the shared follower is not inlined`);
  assert.ok(at < html.indexOf('<style>') && at < html.indexOf('</head>'), `${label}: the follower must run in <head>, before the first styled paint`);
  assert.equal(html.split(FOLLOWER_JS).length - 1, 1, `${label}: one follower`);
  assert.ok(html.includes(`<script>${TOGGLE_JS}</script>`), `${label}: the standalone toggle goes through the follower`);
  assert.doesNotMatch(html, /data-theme|dataset\.theme/, `${label}: nothing keys on the retired data-theme attribute`);
  assert.doesNotMatch(html, /setItem\('cw-theme'/, `${label}: loading the page must never write the panel's key`);

  // One theme, embedded or standalone: the house tokens carry both modes, and the page adds no
  // palette of its own and no embedded override beside them.
  assert.ok(html.includes(houseTokens()), `${label}: the house tokens are not inlined`);
  assert.doesNotMatch(html.split(houseTokens()).join(''), /(?<![\w-])--(?:bg|ink|acc)\s*:/, `${label}: the page declares a palette of its own`);
  assert.doesNotMatch(html, /html\[data-embed\]\[data-mode/, `${label}: an embedded palette would make embedded and standalone differ`);
  const { light, dark } = houseTokenValues();
  for (const [mode, t] of Object.entries({ light, dark })) {
    for (const fg of ['ink', 'mut']) {
      for (const bg of ['bg', 'panel']) {
        const r = contrast(t[fg], t[bg]);
        assert.ok(r >= 4.5, `${label} ${mode}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${r.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(lum(light.bg) > 0.6 && lum(dark.bg) < 0.05, `${label}: the page really changes ground with the mode`);
}

const T = (h) => new Date(Date.UTC(2026, 7, 1, h)).toISOString();

// docs/THEME.md Rule 7: an absent, refuted or unjudged value wears the house sheet's .pill.na or
// .pill.unk. Until 2026-10-07 both reports drew it as a filled --panel2 chip of their own.
function assertAbsenceIsHollow(html, label) {
  assert.ok(html.includes('.pill.unk{') && html.includes('.pill.na{'), `${label}: the house sheet's absence pills are not inlined`);
  const own = html.split(houseTokens()).join('');
  assert.doesNotMatch(own, /\.(?:chip|resp)\.(?:na|none|bad)\{/, `${label}: an absent value has a filled style of its own`);
  assert.doesNotMatch(own, /class="chip (?:na|none)"|'chip '\+\(un\?'med':'none'\)|chip '\+cls\+'">'\+\(cls!=='na'/,
    `${label}: an absent value is still drawn as a chip`);
}

// Lift one client function out of a generated page and run it, so the assertion is on what the
// page draws rather than on the words in its source.
function lift(html, start, end, names, ...args) {
  const a = html.indexOf(start);
  assert.ok(a > -1, `${start} not found in the page`);
  const b = html.indexOf(end, a);
  assert.ok(b > a, `${end} not found after ${start}`);
  const name = /function (\w+)\(/.exec(start)[1];
  return new Function(...names, `${html.slice(a, b)}\nreturn ${name};`)(...args);
}
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function assertRuntimeAbsences(html) {
  const DISPL = { 'in-scope-confirmed': 'in scope', 'in-scope-refuted': 'refuted', 'host-attributed': 'host, not this project', undetermined: 'not judged' };
  const adjline = lift(html, 'function adjline(f){', '\nfunction fcard(', ['DISPL', 'esc'], DISPL, escHtml);
  assert.match(adjline({ disposition: 'in-scope-refuted', signals: ['404'] }), /^<div class="resp quiet"><span class="pill na">refuted<\/span>/);
  assert.match(adjline({ disposition: 'undetermined' }), /^<div class="resp quiet"><span class="pill unk">not judged<\/span>/);
  assert.match(adjline({ disposition: 'host-attributed' }), /^<div class="resp"><span class="chip info">/, 'a host-attributed finding is a known state');
  assert.equal(adjline({ disposition: 'in-scope-confirmed' }), '');
  assert.match(html, /'<span class="pill na">'\+c\.refuted\+' refuted<\/span> '/);
  assert.match(html, /'<span class="pill unk">'\+c\.undetermined\+' not judged<\/span>'/);
  assert.match(html, /f\.confirmed===false\?' quiet"><span class="pill na">not live<\/span> '/);
  // the scope chip: a verified area is plain metadata, an unverified scope is unknown, none is n/a
  assert.match(html, /e\.className=!un\?'mut':c\.scope==='none'\?'pill na':'pill unk';/);
}

function assertDashboardAbsences(html) {
  const G = { crit: '⬤', high: '▲', med: '◆', low: '▬', ok: '✓', na: '–', unknown: '?' };
  const cellHtml = lift(html, 'function cellHtml(r,col){', '\nlet sortCol', ['G', 'DEPCOLS', 'depSev', 'esc'],
    G, new Set(['deps-osv', 'npm-audit']), () => null, escHtml);
  const row = (grid) => ({ name: 'r', findings: [], grid });
  assert.match(cellHtml(row({}), 'deps-osv'), /^<span class="pill na"[^>]*>–<\/span>$/, 'a dep column with nothing read');
  assert.match(cellHtml(row({ sast: { sev: 'noscan', text: 'tool missing' } }), 'sast'), /^<span class="pill unk"[^>]*>tool missing<\/span>$/);
  assert.match(cellHtml(row({ sast: { sev: 'na', text: '—' } }), 'sast'), /^<span class="pill na">—<\/span>$/);
  assert.match(cellHtml(row({}), 'sast'), /^<span class="pill na">—<\/span>$/, 'a missing cell');
  assert.equal(cellHtml(row({ sast: { sev: 'high', text: '3' } }), 'sast'), '<span class="chip high">▲ 3</span>', 'a finding keeps its chip');
  assert.equal(cellHtml(row({ sast: { sev: 'ok', text: '0' } }), 'sast'), '<span class="chip ok">✓ 0</span>');
}

let dashboard = null;
const dashboardOnce = () => (dashboard ??= buildDashboard());

test('the CVE dashboard has no filled style of its own for an absent cell', () => {
  assertAbsenceIsHollow(dashboardOnce(), 'dashboard');
});

test('the CVE dashboard draws an absent cell as .pill.na and an unscanned one as .pill.unk', () => {
  assertDashboardAbsences(dashboardOnce());
});

function buildRuntime() {
  const root = mkdtempSync(join(tmpdir(), 'cw-page-modes-'));
  try {
    const out = join(root, 'out'), scan = join(root, 'no-runtime-scan');
    mkdirSync(out, { recursive: true }); mkdirSync(scan, { recursive: true });
    const r = spawnSync(process.execPath, [join(CW, 'monitor', 'runtime-report.mjs'), scan],
      { env: { ...process.env, CW_MONITOR_OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(join(out, 'runtime.html'), 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
let runtime = null;
const runtimeOnce = () => (runtime ??= buildRuntime());

test('the runtime report has no filled style of its own for an absent result', () => {
  assertAbsenceIsHollow(runtimeOnce(), 'runtime');
});

test('the runtime report draws refuted, unjudged and not-live results as .pill.na or .pill.unk', () => {
  assertRuntimeAbsences(runtimeOnce());
});

test('the timeline follows the panel\'s mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-page-modes-'));
  try {
    const out = join(root, 'out');
    mkdirSync(join(out, 'history'), { recursive: true });
    writeFileSync(join(out, 'history', 'sweep-1.json'), JSON.stringify({
      sliceVersion: 1, sliceId: 'sweep-1', generated: T(0), kind: 'sweep', toolRuns: { alpha: { osv: 1 } }, scope: { repos: ['alpha'] },
      totals: { crit: 0, high: 1, med: 0, low: 0, cves: 1 }, counts: { born: 1, cleaned: 0, unconfirmed: 0, accepted: 0, carried: 0 },
      findings: [{ repo: 'alpha', id: 'GHSA-1', package: 'lodash', severity: 'high', state: 'persisting', key: 'alpha|osv|GHSA-1|lodash|' }],
      resolved: [], carried: [], anchors: {},
    }));
    writeFileSync(join(out, 'history', 'index.json'), JSON.stringify([{ stamp: '20260801000000', sliceId: 'sweep-1', sliceVersion: 1, file: 'sweep-1.json', generated: T(0) }]));
    const r = spawnSync(process.execPath, [join(CW, 'monitor', 'timeline.mjs')],
      { env: { ...process.env, CW_MONITOR_OUT: out, CW_ISSUES: join(root, 'never-written-issues.json') }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assertFollowsMode(readFileSync(join(out, 'timeline.html'), 'utf8'), 'timeline');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// a one-repo, scanned-clean batch in its own registry — the smallest batch rollup.mjs will publish
function buildDashboard() {
  const root = mkdtempSync(join(tmpdir(), 'cw-page-modes-'));
  try {
    const at = '2026-08-27T00:00:05.000Z';
    const regPath = join(root, 'projects.json');
    writeFileSync(regPath, JSON.stringify({ reportsRoot: join(root, 'reports'), monitorOutput: 'primary-area', defaultManifest: 'security-baseline', roots: [], projects: [],
      areas: [{ slug: 'primary-area', label: 'primary', out: 'primary-area', primary: true, members: ['clean-repo'] }] }));
    mkdirSync(join(root, 'reports', 'primary-area'), { recursive: true });
    const batch = join(root, 'reports', 'sweep-20260827000000-primary-area');
    mkdirSync(join(batch, 'clean-repo'), { recursive: true });
    writeFileSync(join(batch, 'batch-manifest.json'), JSON.stringify({
      sliceId: 'sweep-20260827000000', kind: 'sweep', group: 'all', only: null, sweptAll: false,
      area: 'primary-area', areaOut: 'reports/primary-area', startedAt: '2026-08-27T00:00:00.000Z',
      scope: { repos: [{ name: 'clean-repo', manifests: ['security-baseline'] }], excluded: [], lifecycle: {} }, anchors: {},
    }));
    writeFileSync(join(batch, 'clean-repo', 'osv.sarif'), JSON.stringify({ runs: [{ tool: { driver: { name: 'osv-scanner', rules: [] } }, results: [] }] }));
    writeFileSync(join(batch, 'clean-repo', 'npm-audit.json'), JSON.stringify({ vulnerabilities: {} }));
    writeFileSync(join(batch, 'clean-repo', 'checks-status.json'), JSON.stringify([{ check: 'deps-osv', status: 'pass', durationMs: 5, at }, { check: 'npm-audit', status: 'pass', durationMs: 5, at }]));
    const r = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch = undefined;', join(CW, 'monitor', 'rollup.mjs'), batch], {
      cwd: CW, encoding: 'utf8',
      env: { ...process.env, CW_SKIP_SETUP: '1', CW_REGISTRY: regPath, CW_MONITOR_OUT: '', CW_NOW: at, CW_CHAIN_ANCHORS: join(root, 'chain-tips.jsonl') },
    });
    assert.equal(r.status, 0, r.stderr);
    return readFileSync(join(root, 'reports', 'primary-area', 'dashboard.html'), 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the CVE dashboard follows the panel\'s mode', () => {
  assertFollowsMode(buildDashboard(), 'dashboard');
});

test('the runtime report follows the panel\'s mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-page-modes-'));
  try {
    const out = join(root, 'out'), scan = join(root, 'no-runtime-scan');
    mkdirSync(out, { recursive: true }); mkdirSync(scan, { recursive: true });
    const r = spawnSync(process.execPath, [join(CW, 'monitor', 'runtime-report.mjs'), scan],
      { env: { ...process.env, CW_MONITOR_OUT: out }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assertFollowsMode(readFileSync(join(out, 'runtime.html'), 'utf8'), 'runtime');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
