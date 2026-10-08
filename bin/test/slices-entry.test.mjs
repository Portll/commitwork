// bin/slices.mjs end to end. Its store is fixed at <script>/../sitemap/data with no env override, so
// the script (node builtins only) is copied verbatim into a scratch root and run there — never
// against this checkout's sitemap/data. Pins: snapshot copies the sitemap byte for byte under its
// db-date, upserts index.json by date (sorted) and rewrites the discovery file; the date comes from
// --date or the sitemap's `generated`, never the wall clock; a missing source, a bad date, an
// undatable sitemap and an empty slug each exit 1 and write nothing; list reads the index back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function relocated(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-slices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  copyFileSync(join(CW, 'bin', 'slices.mjs'), join(root, 'bin', 'slices.mjs'));
  const data = join(root, 'sitemap', 'data');
  return { root, data, script: join(root, 'bin', 'slices.mjs') };
}

const sitemap = (s, slug, doc) => { mkdirSync(s.data, { recursive: true }); writeFileSync(join(s.data, `${slug}.sitemap.json`), JSON.stringify(doc, null, 2)); };
const run = (s, args) => {
  const r = spawnSync(process.execPath, [s.script, ...args], { encoding: 'utf8', cwd: s.root });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('snapshot --date copies the sitemap byte for byte and writes the index and discovery files', (t) => {
  const s = relocated(t);
  sitemap(s, 'widget-site', { generated: '2026-03-04T10:00:00.000Z', services: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  const r = run(s, ['snapshot', 'widget-site', '--date', '2026-05-06']);
  assert.equal(r.code, 0, r.err);
  const slice = join(s.data, 'slices', 'widget-site', '2026-05-06.sitemap.json');
  assert.ok(readFileSync(slice).equals(readFileSync(join(s.data, 'widget-site.sitemap.json'))), 'not a byte copy');
  assert.deepEqual(json(join(s.data, 'slices', 'widget-site', 'index.json')),
    [{ date: '2026-05-06', file: '2026-05-06.sitemap.json', services: 3, generated: '2026-03-04T10:00:00.000Z' }]);
  assert.deepEqual(json(join(s.data, 'widget-site.snapshots.json')),
    [{ date: '2026-05-06', file: 'slices/widget-site/2026-05-06.sitemap.json' }]);
  assert.match(r.out, /snapshot widget-site @ 2026-05-06/);
});

test('with no --date the db-date is the sitemap\'s own `generated`; a re-snapshot upserts by date, sorted', (t) => {
  const s = relocated(t);
  sitemap(s, 'widget-site', { generated: '2026-03-04T10:00:00.000Z', services: [{ id: 'a' }] });
  const r = run(s, ['snapshot', 'widget-site']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /no --date given; using sitemap\.generated → 2026-03-04/);
  assert.equal(run(s, ['snapshot', 'widget-site', '--date', '2026-01-01']).code, 0);
  sitemap(s, 'widget-site', { generated: '2026-03-04T11:00:00.000Z', services: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(run(s, ['snapshot', 'widget-site']).code, 0, 'same date again');
  const index = json(join(s.data, 'slices', 'widget-site', 'index.json'));
  assert.deepEqual(index.map((r2) => [r2.date, r2.services]), [['2026-01-01', 1], ['2026-03-04', 2]], 'one row per date, the newer copy wins');
  assert.deepEqual(json(join(s.data, 'widget-site.snapshots.json')).map((x) => x.date), ['2026-01-01', '2026-03-04']);
});

test('snapshot refuses — exit 1, nothing written — on a missing source, a bad date, an undatable sitemap', (t) => {
  const s = relocated(t);
  const missing = run(s, ['snapshot', 'widget-site', '--date', '2026-05-06']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /no source sitemap at .*widget-site\.sitemap\.json/);
  assert.equal(existsSync(join(s.data, 'slices')), false);

  sitemap(s, 'widget-site', { services: [] });
  const bad = run(s, ['snapshot', 'widget-site', '--date', '06/05/2026']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--date must be YYYY-MM-DD, got "06\/05\/2026"/);
  const undatable = run(s, ['snapshot', 'widget-site']);
  assert.equal(undatable.code, 1);
  assert.match(undatable.err, /no --date and sitemap has no usable `generated` date/);
  assert.equal(existsSync(join(s.data, 'slices')), false, 'a refused snapshot created the store');
});

test('the slug is sanitised as the front end does, and one that sanitises to nothing is refused', (t) => {
  const s = relocated(t);
  sitemap(s, 'widgetsite', { generated: '2026-03-04', services: [] });
  assert.equal(run(s, ['snapshot', 'Widget Site!', '--date', '2026-05-06']).code, 0);
  assert.ok(existsSync(join(s.data, 'slices', 'widgetsite', '2026-05-06.sitemap.json')));
  const empty = run(s, ['snapshot', '!!!']);
  assert.equal(empty.code, 1);
  assert.match(empty.err, /slug "!!!" sanitises to empty/);
});

test('list reads the index back, and says so when there is none', (t) => {
  const s = relocated(t);
  const none = run(s, ['list', 'widget-site']);
  assert.equal(none.code, 0);
  assert.match(none.out, /no slices yet for "widget-site"/);
  sitemap(s, 'widget-site', { generated: '2026-03-04', services: [{ id: 'a' }, { id: 'b' }] });
  run(s, ['snapshot', 'widget-site', '--date', '2026-05-06']);
  const r = run(s, ['list', 'widget-site']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /slices · widget-site {2}\(1\)/);
  assert.match(r.out, / {2}2026-05-06 {4}2 svc {2}2026-05-06\.sitemap\.json {2}2026-03-04/);
});

test('an unreadable index is an error naming it, not an empty list', (t) => {
  const s = relocated(t);
  mkdirSync(join(s.data, 'slices', 'widget-site'), { recursive: true });
  writeFileSync(join(s.data, 'slices', 'widget-site', 'index.json'), '[{"date": ');
  const r = run(s, ['list', 'widget-site']);
  assert.equal(r.code, 1);
  assert.match(r.err, /cannot read .*index\.json/);
});

test('no verb prints usage and exits 0; an unknown verb prints usage and exits 1', (t) => {
  const s = relocated(t);
  const none = run(s, []);
  assert.equal(none.code, 0);
  assert.match(none.out, /commitwork slices — versioned sitemap-state store/);
  const unknown = run(s, ['snapshop', 'widget-site']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /snapshot <slug>/);
});
