// Every tracked HTML producer gives each page it writes a tab icon. A page opened from disk or from
// Pages has no origin to fall back to /favicon.ico on, so it inlines MARK_ICON (lib/brand-tokens.mjs).
// The population is `git ls-files`; content is the working tree. A producer is counted per page:
// a file that writes two documents and inlines one icon still has a page without one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DOCTYPE = /<!doctype html/gi;
const ICON = /\$\{MARK_ICON\}|<link rel="icon"/g;

// Served only from the panel origin, whose /favicon.ico route answers with the mark.
const PANEL = {
  'admin/serve.mjs': 'its shell page is a panel response',
  'admin/lib/memory-view.mjs': 'rendered by the /api/memory-view.html route',
  'admin/routes/launchlist.mjs': 'its only document is the route\'s 503 page',
  'admin/routes/offbox.mjs': 'a panel route; its CSP admits no data: image either',
};

// Matches the doctype to check a response; writes no page.
const NOT_A_PAGE = { 'bin/smoke.mjs': 'tests a served body for the doctype' };

// Producers held by an in-flight change. Remove an entry when its icon lands; the test fails until you do.
const PENDING = {
  'bin/remediation-web.mjs': 'held by the markdown docsite rewrite',
};

const tracked = () => execFileSync('git', ['ls-files', '-z', '--', '*.mjs', '*.js', '*.cjs'], { cwd: REPO, encoding: 'utf8' })
  .split('\0').filter((p) => p && !/(^|\/)(test|node_modules)\//.test(p));

const count = (text, re) => (text.match(re) || []).length;

const producers = () => tracked().flatMap((path) => {
  const text = readFileSync(join(REPO, path), 'utf8');
  const pages = count(text, DOCTYPE);
  return pages ? [{ path, pages, icons: count(text, ICON) }] : [];
});

test('every HTML producer outside the panel inlines a tab icon on every page', () => {
  const exempt = { ...PANEL, ...NOT_A_PAGE, ...PENDING };
  const bare = producers().filter((p) => !exempt[p.path] && p.icons < p.pages)
    .map((p) => `${p.path} (${p.pages} page(s), ${p.icons} icon(s))`);
  assert.deepEqual(bare, [], `these write pages with no tab icon: ${bare.join(', ')}. Interpolate MARK_ICON from lib/brand-tokens.mjs into each <head>`);
});

test('every exemption still names a producer that needs it', () => {
  const byPath = new Map(producers().map((p) => [p.path, p]));
  const spent = Object.keys({ ...PANEL, ...NOT_A_PAGE, ...PENDING })
    .filter((path) => !byPath.has(path) || byPath.get(path).icons >= byPath.get(path).pages);
  assert.deepEqual(spent, [], `remove these exemptions: they write no page or every page already has an icon: ${spent.join(', ')}`);
});

test('the guard sees the producers it was written against', () => {
  const paths = new Set(producers().map((p) => p.path));
  for (const known of ['monitor/rollup.mjs', 'lib/md-view.mjs', 'bin/cvd-palette.mjs', 'lib/docsite-page.mjs']) {
    assert.ok(paths.has(known), `${known} is an HTML producer the population no longer finds — the scan is blind, not clean`);
  }
  assert.ok(paths.size >= 25, `found ${paths.size} producers; fewer than 25 means the population query broke`);
});
