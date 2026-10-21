// The `modmap` view ("Modernisation plan"): an iframe view, not a NATIVE one. It is reachable only
// if three things line up that no other view needs: it is in VALID_VIEWS by explicit listing (it is
// not a NATIVE key, so the Object.keys(NATIVE) spread does not cover it), a menu button targets it,
// and viewSrc() resolves it to the live /map/<project> server route, which must exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelHtml, panelScript } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = panelHtml('index.html');
const JS = panelScript('index.html');
const SERVE = readFileSync(join(HERE, '..', 'serve.mjs'), 'utf8');

const statementAt = (needle) => {
  const from = JS.indexOf(needle);
  assert.ok(from > -1, `${needle} not found in the panel script`);
  let depth = 0, quote = null;
  for (let i = from; i < JS.length; i++) {
    const c = JS[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return JS.slice(from, i + 1);
  }
  assert.fail(`unterminated statement at ${needle}`);
};

test('reachable: listed in VALID_VIEWS explicitly (it is not a NATIVE key)', () => {
  const nativeKeys = new Function(`return Object.keys(${JS.slice(JS.indexOf('const NATIVE={') + 13, JS.indexOf('};', JS.indexOf('const NATIVE={')) + 1)})`)();
  assert.ok(!nativeKeys.includes('modmap'), 'modmap became a NATIVE view — this test and setView assumptions need revisiting');
  assert.match(statementAt('const VALID_VIEWS=new Set('), /'modmap'/, 'VALID_VIEWS would reject #modmap / /modmap/');
});

test('reachable: a menu button targets it, and the router/server accept the deep link', () => {
  assert.match(HTML, /<button[^>]*\bdata-v="modmap"/, 'no data-v="modmap" button anywhere in the panel');
  assert.match(HTML, /id="vn-modmap"/);
  const set = SERVE.match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]/);
  assert.ok(set && /'modmap'/.test(set[1]), 'a refresh on /modmap/ would 404 — PANEL_VIEWS lacks it');
});

test('reachable: placed in the Work workspace and the History section, not left to "Other"', () => {
  assert.match(JS, /timeline:'history', modmap:'history'/);
  assert.match(JS, /\['remediation','inbox','issues','daily','delivery','modmap'\]\.includes\(v\)\)return 'work'/);
});

test('render path: viewSrc resolves modmap to the live /map/<project> route and follows the project', () => {
  const slugSrc = statementAt('const projSlug=');
  const srcFn = statementAt('const viewSrc=');
  const viewSrc = (SLUGS, curProj) =>
    new Function('SLUGS', 'curProj', `${slugSrc}\n${srcFn}\nreturn viewSrc;`)(SLUGS, curProj);
  assert.equal(viewSrc({ 'Client A': 'team-a' }, 'Client A')('modmap'), '/map/team-a?embed=1', 'server-declared slug wins');
  assert.equal(viewSrc({}, 'Some Project_2')('modmap'), '/map/some-project-2?embed=1', 'fallback slug rule');
  assert.notEqual(viewSrc({}, 'a')('modmap'), viewSrc({}, 'b')('modmap'), 'the map must follow the project picker');
});

test('render path: setView puts a non-NATIVE view into the iframe; project switches reload it', () => {
  const at = JS.indexOf('function setView(v,replace){');
  assert.ok(at > -1);
  const body = JS.slice(at, JS.indexOf('\n}\n', at));
  assert.match(body, /else\{fr\.style\.display='block';const s=viewSrc\(v\);if\(fr\.getAttribute\('src'\)!==s\)fr\.src=s;\}/);
  assert.ok((JS.match(/curView==='modmap'\|\|curView==='timeline'\|\|curView==='sitemap'/g) || []).length >= 2,
    'project/refresh paths no longer re-point the iframe for modmap');
});

test('server side: /map/<slug> is a GET route that serves cached output, renders on demand, and states absence', () => {
  const at = SERVE.indexOf("const mapm = req.url.match(/^\\/map\\/");
  assert.ok(at > -1, '/map/<project> route not found in admin/serve.mjs');
  const route = SERVE.slice(at, at + 1200);
  assert.match(route, /req\.method === 'GET' && mapm/);
  assert.match(route, /map', 'data', project, 'index\.html'/);
  assert.match(route, /render=1|!existsSync\(html\)/);
  assert.match(route, /no modernization map for/, 'a project without data must say so, not return an empty 200 body');
  assert.match(SERVE.slice(at - 80, at + 120), /\[a-z0-9\]\[a-z0-9-\]\*/, 'slug charset constraint');
});
