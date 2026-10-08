// Panel-side items from the 2026-10-07 THEME conformity audit, each held as a property of the
// source a reader is served (docs/THEME.md): /config's Scanning section in both themes (§2.1, §8),
// glows derived from their tokens (Rule 2), the Slop Bucket summary on the panel's KPI tiles, and
// embedded reports without a second masthead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ADMIN, panelHtml, panelScript } from './lib/panel-source.mjs';

const REPO = resolve(ADMIN, '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8').split('\r\n').join('\n');
const THEME_CSS = read('admin/static/theme.css');
const CONFIG = panelHtml('config.html');

// Top-level rules of a flat stylesheet: [{ sel, decls: [[prop, value]] }].
function rules(css) {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; });
    out.push({ sel: m[1].trim(), decls });
  }
  return out;
}
const RULES = rules(THEME_CSS);
const block = (sel) => RULES.find((r) => r.sel === sel);

// ── item 1: /config's Scanning section ─────────────────────────────────────────────────────────
test('/config draws Scanning with the decision controls, not the dark-only Linear livery', () => {
  const linear = CONFIG.match(/\bcw-(?:linear|stage|meta|act|ghost|pri|sev|dlg|lanes?|grp|hist)\b/g) || [];
  assert.deepEqual(linear, [], 'a Linear class is near-black in both themes, so light mode shows a black block');
  for (const cls of ['cw-btn--fill cw-btn--caution', 'cw-btn--fill cw-btn--stop', 'cw-facts', 'cw-grid', 'cw-row--lane', 'cw-tick']) {
    assert.ok(CONFIG.includes(cls), `Scanning no longer uses ${cls}`);
  }
});

test('the approval dialog takes its scrim and box from theme.css, at the §6.3 scrim', () => {
  assert.match(CONFIG, /<div id="sc-modal" hidden>\s*<div class="cw-scrim" id="sc-scrim"><\/div>\s*<div class="cw-dialog"/);
  assert.doesNotMatch(CONFIG, /style="[^"]*rgba\(/, 'a hand-written scrim drifts from the documented one');
  const scrim = block('.cw-scrim');
  assert.ok(scrim, 'theme.css has no .cw-scrim');
  assert.deepEqual(scrim.decls.find(([p]) => p === 'background'), ['background', 'rgba(10,10,12,.72)']);
});

test('the decision-control tokens follow the panel theme', () => {
  const root = new Map(block(':root').decls);
  for (const t of ['bg', 'panel', 'panel2', 'line', 'line2', 'head', 'ink', 'mut', 'dim']) {
    assert.match(root.get(`--cw-${t}`) || '', new RegExp(`^var\\(--${t},#[0-9a-f]{6}\\)$`), `--cw-${t} is not an alias of --${t}`);
  }
  const light = block('.cw-light,html[data-mode=light]');
  assert.ok(light, 'no light values for the fills under the panel\'s light theme');
  const fills = new Map(light.decls);
  assert.equal(fills.get('--cw-ink-on-fill'), '#ffffff');
  for (const t of ['--cw-ok', '--cw-caution', '--cw-stop']) assert.ok(fills.has(t), `${t} keeps its dark value in light`);
  // The second witness: html[data-mode] is only a key if something on /config sets it.
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(CONFIG.includes('<script src="/static/theme-switch.js">'), '/config does not load the theme switch');
  assert.match(read('admin/static/theme-switch.js'), /setAttribute\('data-mode',m\)/, 'nothing sets html[data-mode]');
});

// ── item 4: glows derived from tokens ──────────────────────────────────────────────────────────
test('theme.css derives every coloured glow from a token (THEME Rule 2)', () => {
  const chromatic = [...THEME_CSS.matchAll(/rgba\((\d+),(\d+),(\d+),[\d.]+\)/g)]
    .filter((m) => { const c = m.slice(1, 4).map(Number); return Math.max(...c) - Math.min(...c) > 2; })
    .map((m) => m[0]);
  assert.deepEqual(chromatic, [], 'an rgba() copied from a token keeps the old hue after the token moves');
});

test('theme.css rules take colour from tokens; literals live only in token declarations', () => {
  const ALLOWED = new Set(['#fff', '#ffffff', '#1a120e', '#a4830e']);   // §3.7, plus the light gold edge
  const bad = [];
  for (const { sel, decls } of RULES) {
    for (const [p, v] of decls) {
      if (p.startsWith('--')) continue;
      for (const h of v.match(/#[0-9a-fA-F]{3,8}\b/g) || []) if (!ALLOWED.has(h.toLowerCase())) bad.push(`${sel} { ${p}: ${v} }`);
    }
  }
  assert.deepEqual(bad, []);
});

// ── item 5: the Slop Bucket summary ────────────────────────────────────────────────────────────
test('the Slop Bucket summary draws the panel KPI tiles and table wrapper, sized in rem', () => {
  const src = read('admin/static/comments.js');
  const at = src.indexOf('function cmtSummary(');
  assert.ok(at > -1, 'cmtSummary not found');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /class="kpis/);
  assert.match(body, /class="kpi/);
  assert.match(body, /class="tw"/);
  assert.doesNotMatch(body, /style=/, 'inline style in place of the panel components');
  assert.doesNotMatch(body, /\d+px/, 'px sizing (THEME Rule 4)');
});

// ── item 3: embedded reports carry no second masthead ──────────────────────────────────────────
test('each report the panel embeds hides its brand and drops its bar chrome under html[data-embed]', () => {
  const js = panelScript('index.html');
  for (const [file, src] of [['monitor/rollup.mjs', "'/reports/dashboard.html?embed=1"],
    ['monitor/runtime-report.mjs', "'/reports/runtime.html?embed=1"], ['monitor/timeline.mjs', ".html?embed=1&project="]]) {
    assert.ok(js.includes(src), `the panel no longer embeds ${file}'s page with ?embed=1`);
    const s = read(file);
    assert.match(s, /<div class="bar"><b class="embed-hide">commitwork[^<]*<\/b>/, `${file}: the brand shows inside the panel`);
    assert.match(s, /html\[data-embed\] \.bar\{[^}]*background:transparent[^}]*border-bottom:0/, `${file}: the bar keeps its masthead chrome`);
  }
  assert.ok(js.includes("'/sitemap/demo.html?embed=1"), 'the panel no longer embeds the sitemap with ?embed=1');
  const demo = read('sitemap/demo.html');
  assert.match(demo, /html\[data-embed\] header h1 \.ttl\{display:none\}/);
  assert.match(demo, /html\[data-embed\] header\{background:transparent;border-bottom:0\}/);
});

// ── the coverage survey's shell ─────────────────────────────────────────────────────────────────
// A recovered page the docsite build copies, so nothing regenerates its shell: this holds it equal
// to lib/docsite-page.mjs by test, in place of a header that claimed the build generated it.
test('the coverage survey carries the current docsite shell and does not claim a generator', async () => {
  const { CSS, SITE_LINKS, renderShellPage } = await import('../../lib/docsite-page.mjs');
  const { loadManifest, docsiteNav } = await import('../../lib/docsite-manifest.mjs');
  const survey = read('docsite/imported/commitwork-coverage-survey.html');
  assert.equal(read('docsite/pages/commitwork-coverage-survey.html'), survey, 'the built copy differs from its imported source');
  const header = survey.split('\n')[1];
  assert.doesNotMatch(header, /Generated by/, 'the build copies this page; it generates nothing in it');
  assert.match(header, /bin\/docsite-build\.mjs copies it/);
  assert.equal(survey.slice(survey.indexOf('<style>') + 7, survey.indexOf('</style>')), CSS,
    'the survey\'s shell stylesheet is not lib/docsite-page.mjs\'s (code ink, brand gap, print rules)');
  // The chrome the shell renders today, built from the public manifest alone.
  const was = process.env.CW_DOCSITE_ROOT;
  process.env.CW_DOCSITE_ROOT = join(REPO, 'docsite');
  let shell;
  try {
    shell = renderShellPage({ title: 't', bodyHtml: '', srcHash: '0'.repeat(64), nav: docsiteNav(loadManifest()),
      currentSlug: 'commitwork-coverage-survey', siteLinks: SITE_LINKS });
  } finally {
    if (was === undefined) delete process.env.CW_DOCSITE_ROOT; else process.env.CW_DOCSITE_ROOT = was;
  }
  const part = (html, re) => (re.exec(html) || [])[0];
  const HEADER = /<header class="site">[\s\S]*?<\/header>/;
  assert.equal(part(survey, HEADER), part(shell, HEADER), 'the survey\'s site header is not the shell\'s');
  const foot = part(survey, /<footer class="site">[\s\S]*?<\/footer>/);
  assert.doesNotMatch(foot, /generated from Markdown/, 'the survey has no Markdown source');
  for (const l of SITE_LINKS) assert.ok(foot.includes(`<a href="${l.href}">${l.text}</a>`), `footer lacks ${l.href}`);
  assert.match(survey, /<body[^>]*>\n<!--email_off-->\n/);
  assert.match(survey, /<\/footer>\n<!--\/email_off-->\n<\/body>/);
});
