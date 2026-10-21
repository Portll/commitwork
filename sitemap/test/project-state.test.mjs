// node --test sitemap/test/ — the site map names no project of its own. The project comes from
// ?project= or from the manifest that loads; no ?project= is its own state, shown as one; and the
// tab title is derived from what loaded. The loader is LIFTED from demo.html by source anchor and
// run against a stubbed fetch, so these tests exercise the page's own code rather than a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../demo.html', import.meta.url)), 'utf8');

// [start, stop) — the stop anchor is excluded, so a lift can end where the next declaration begins
function between(startAnchor, stopAnchor, label) {
  const a = SRC.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found in demo.html — the lift is stale, not the code`);
  const b = SRC.indexOf(stopAnchor, a);
  assert.ok(b > a, `${label}: stop anchor not found after start — the lift is stale`);
  return SRC.slice(a, b);
}

const HEAD = between('const PROJECT=', "let curSnap='current';", 'project + title');
const LOADER = between('function snapUrl(snap){', '// build the snapshot list', 'snapUrl + loadSitemap');

// One page load: `files` maps a URL the page may fetch to the manifest served there; anything else
// is a 404. `boot` is stubbed — building a scene needs WebGL — and records what it was handed.
async function load(search, files = {}) {
  const fetched = [], booted = [];
  const el = { demo: { textContent: 'loading…', dataset: { state: 'loading' }, classList: { remove() {} } }, foot: { innerHTML: 'loading…' } };
  const document = { title: 'SiteMap', querySelector: (s) => (s === '.demo' ? el.demo : null) };
  const fetch = (url) => {
    fetched.push(url);
    const body = files[url];
    return Promise.resolve(body ? { ok: true, status: 200, json: async () => structuredClone(body) } : { ok: false, status: 404 });
  };
  const page = new Function('location', 'document', 'fetch', '$', 'esc', 'boot',
    `${HEAD}let curSnap='current';\n${LOADER}\nreturn { PROJECT, pageTitle, loadSitemap };`,
  )({ search }, document, fetch, (id) => el[id], (x) => String(x), (m, live) => { booted.push({ project: m.project, live }); });
  await page.loadSitemap('current');
  return { page, fetched, booted, el, title: document.title };
}

const FIXTURE = './data/fixture.sitemap.json';

test('the page carries no project name: no default slug, and a generic static title', () => {
  assert.doesNotMatch(SRC, /get\('project'\)\s*\|\|\s*'[^']/, 'a ?project= default names a project');
  assert.equal(SRC.match(/<title>([^<]*)<\/title>/)?.[1], 'SiteMap');
  assert.match(SRC, /<span class="demo" data-state="loading">loading…<\/span>/, 'before a load the badge claims no source');
});

test('no ?project= asks for nothing live and, with no fixture, says no project was chosen', async () => {
  const r = await load('');
  assert.equal(r.page.PROJECT, '');
  assert.deepEqual(r.fetched, [FIXTURE], 'nothing but the fixture is requested — never ./data/.sitemap.json');
  assert.deepEqual(r.booted, []);
  assert.equal(r.el.demo.textContent, 'NO PROJECT');
  assert.equal(r.el.demo.dataset.state, 'noproject');
  assert.match(r.el.foot.innerHTML, /no project selected/);
  assert.equal(r.title, 'SiteMap (no project)');
});

test('no ?project= loads the bundled fixture under the project the fixture declares', async () => {
  const r = await load('', { [FIXTURE]: { project: 'fixture-owner' } });
  assert.deepEqual(r.booted, [{ project: 'fixture-owner', live: false }]);
});

test('a project with a live manifest loads it, and only it', async () => {
  const r = await load('?project=Zeta_1', { './data/zeta1.sitemap.json': { project: 'zeta1' } });
  assert.equal(r.page.PROJECT, 'zeta1', 'the slug is sanitised before it reaches a URL');
  assert.deepEqual(r.fetched, ['./data/zeta1.sitemap.json']);
  assert.deepEqual(r.booted, [{ project: 'zeta1', live: true }]);
});

test('a project without data never borrows another project\'s fixture, and says so', async () => {
  const r = await load('?project=zeta', { [FIXTURE]: { project: 'someone-else' } });
  assert.deepEqual(r.booted, []);
  assert.equal(r.el.demo.textContent, 'NO DATA · zeta');
  assert.equal(r.el.demo.dataset.state, 'nodata');
  assert.match(r.el.foot.innerHTML, /no sitemap data for zeta/);
  assert.equal(r.title, 'zeta · SiteMap (no data)');
});

test('the fixture stands in only for the project it declares', async () => {
  const r = await load('?project=zeta', { [FIXTURE]: { project: 'zeta' } });
  assert.deepEqual(r.booted, [{ project: 'zeta', live: false }]);
});

test('the tab title is derived from the loaded manifest, not written in', async () => {
  const { page } = await load('');
  assert.equal(page.pageTitle('zeta'), 'zeta · SiteMap');
  assert.equal(page.pageTitle(''), 'SiteMap');
  const boot = SRC.match(/function boot\(m,live\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(boot, 'boot not found');
  assert.match(boot, /const named=live\?PROJECT:\(m\.project\|\|PROJECT\);/);
  assert.match(boot, /document\.title=pageTitle\(named\);/);
});

test('the badge state is a selector, so a later good load clears a NO DATA colour', () => {
  const boot = SRC.match(/function boot\(m,live\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(boot, /hb\.dataset\.state=live\?'live':'fixture';/);
  assert.match(SRC, /\.demo\[data-state=nodata\],header h1 \.demo\[data-state=noproject\]\{color:var\(--bad\)/);
  assert.doesNotMatch(SRC, /hb\.style\./, 'an inline colour outlives the state that set it');
});
