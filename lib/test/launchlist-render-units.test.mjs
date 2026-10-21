// lib/test/launchlist-render-units.test.mjs — case tests for pageCsp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCsp } from '../launchlist-render.mjs';

test('returns a string', () => {
  const csp = pageCsp();
  assert.equal(typeof csp, 'string');
});

test('starts with default-src none', () => {
  const csp = pageCsp();
  assert.ok(csp.startsWith("default-src 'none';"));
});

test('contains style-src with sha256 hash', () => {
  const csp = pageCsp();
  assert.match(csp, /style-src 'sha256-[A-Za-z0-9+/=]+'/);
});

test('contains script-src with two sha256 hashes', () => {
  const csp = pageCsp();
  const matches = csp.match(/script-src 'sha256-[A-Za-z0-9+/=]+' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(matches);
});

test('contains font-src self', () => {
  const csp = pageCsp();
  assert.ok(csp.includes("font-src 'self'"));
});

test('contains connect-src self', () => {
  const csp = pageCsp();
  assert.ok(csp.includes("connect-src 'self'"));
});

test('contains img-src self and data', () => {
  const csp = pageCsp();
  assert.ok(csp.includes("img-src 'self' data:"));
});

test('contains frame-ancestors none, form-action none, base-uri none', () => {
  const csp = pageCsp();
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("form-action 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
});

// The status pills are the house sheet's (docs/THEME.md §11): unmeasured is .pill.unk and n/a is
// .pill.na, so the page carries no pill style or status palette of its own.
test('every status renders as a house pill, and the page styles no pill of its own', async () => {
  const { renderPage } = await import('../launchlist-render.mjs');
  const { houseCss } = await import('../house-css.mjs');
  const row = (id, over) => ({ id, title: id, section: 's', severity: 'HARD', owner: 'o', size: 'S', evidence: [], done: false, check: true, ...over });
  const rows = [
    row('pass', { result: { status: 'pass', summary: '' } }),
    row('fail', { result: { status: 'fail', summary: '' } }),
    row('warn', { result: { status: 'warn', summary: '' } }),
    row('unmeasured', { result: { status: 'unmeasured', summary: '' } }),
    row('odd', { result: { status: 'constructor', summary: '' } }),
    row('accepted', { result: { status: 'fail', summary: '' }, accepted: true }),
    row('accepted-na', { result: { status: 'unmeasured', summary: '' }, accepted: true, na: true }),
    row('ticked', { check: false, tick: { state: 'done', by: 'op', at: 't' } }),
    row('ticked-na', { check: false, tick: { state: 'na', by: 'op', at: 't' } }),
    row('todo', { check: false }),
  ];
  const model = { generatedAt: 't', profiles: {}, sections: {}, projects: [{ project: 'p', profiles: [], rows,
    summary: { openHard: 0, openShould: 0, openLater: 0, done: 0, total: rows.length, unmeasured: 0 } }] };
  const { html } = renderPage(model);
  const pills = [...html.matchAll(/data-id="([^"]+)"[\s\S]*?<span class="pill ([^"]+)">/g)].map((m) => `${m[1]}=${m[2]}`);
  assert.deepEqual(pills, ['pass=live', 'fail=crit', 'warn=part', 'unmeasured=unk', 'odd=unk', 'accepted=done',
    'accepted-na=na', 'ticked=done', 'ticked-na=na', 'todo=plan']);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(style.includes(houseCss()), 'the page inlines the house sheet');
  const own = style.replace(houseCss(), '');
  assert.doesNotMatch(own, /\.pill\b|\.(?:pass|fail|warn|unmeasured|todo|done|na)\s*\{/, 'the page restyles a pill or a status');
});
