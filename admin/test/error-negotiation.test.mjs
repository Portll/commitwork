// A browser navigation must never land on a raw JSON body. It happened twice on 2026-08-25: a bare
// request to the published host, and again after an OAuth callback — both times a `{"ok":false,...}`
// blob on a blank page from a host that had just shown a branded login screen.
//
// The rule is content negotiation, not path matching: the OAuth callback is an /auth/ URL a person
// reaches by CLICKING, so deciding by path would have kept it on JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loginPage } from '../lib/login-page.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// split(/\r?\n/): under a CRLF checkout `l === '}'` never matches `'}\r'`, so the lift below found
// no column-0 close and this whole suite failed on Windows. See admin/test/lib/panel-source.mjs.
const L = serverSource().split(/\r?\n/);

function lift(name) {
  const s = L.findIndex((l) => l.startsWith(`function ${name}(`));
  assert.ok(s > -1, `serve.mjs no longer declares a top-level ${name} — update this extractor`);
  const e = L.findIndex((l, i) => i > s && l === '}');
  assert.ok(e > s, `could not find the column-0 close of ${name}`);
  return L.slice(s, e + 1).join('\n');
}

// loginPage is INJECTED, not lifted: errorPage renders through it, and it now lives in
// admin/lib/login-page.mjs where it can simply be imported.
const build = () => new Function(
  'LOCAL_PORT', 'loginPage', 'esc',
  `${lift('errorPage')}\n${lift('sendErr')}\nreturn { errorPage, sendErr };`,
)(7879, loginPage, esc);

const capture = (accept) => {
  const sent = [];
  const ctx = {
    req: { headers: accept ? { accept } : {} },
    send: (code, body, ct) => { sent.push({ code, body, ct }); },
  };
  return { ctx, sent };
};

test('the lift works — a broken extract would make every case below vacuous', () => {
  const { sendErr, errorPage } = build();
  assert.equal(typeof sendErr, 'function');
  assert.match(errorPage(500, 'T', 'D'), /HTTP 500/);
});

test('a browser navigation gets HTML, not a JSON body', () => {
  const { sendErr } = build();
  const { ctx, sent } = capture('text/html,application/xhtml+xml');
  sendErr(ctx, 400, 'Sign-in expired', 'Start again.');
  assert.equal(sent[0].code, 400);
  assert.match(sent[0].ct, /text\/html/);
  assert.match(sent[0].body, /Sign-in expired/);
  assert.ok(typeof sent[0].body === 'string' && !sent[0].body.trimStart().startsWith('{'),
    'a person navigating here must not receive a JSON document');
});

test('a fetch/XHR caller keeps the {ok:false,error} shape the client already parses', () => {
  const { sendErr } = build();
  const { ctx, sent } = capture('application/json');
  sendErr(ctx, 400, 'Sign-in expired', 'Start again.');
  assert.equal(sent[0].body.ok, false);
  assert.equal(sent[0].body.error, 'Start again.');
  assert.equal(sent[0].ct, undefined, 'the JSON branch leaves the default content type alone');
});

test('a request with no Accept header is treated as a machine, not a person', () => {
  const { sendErr } = build();
  const { ctx, sent } = capture(null);
  sendErr(ctx, 500, 'T', 'D');
  assert.equal(sent[0].body.ok, false, 'curl and fetch send no Accept; defaulting to HTML would break them');
});

test('the detail is what the JSON carries, falling back to the title when absent', () => {
  const { sendErr } = build();
  const { ctx, sent } = capture('application/json');
  sendErr(ctx, 404, 'Not found', '');
  assert.equal(sent[0].body.error, 'Not found');
});

test('the error page escapes a hostile title and detail', () => {
  const { errorPage } = build();
  const html = errorPage(500, '<img src=x onerror=alert(1)>', '<b>d</b>');
  assert.ok(!html.includes('<img src=x'), 'the title must not reach the page as an element');
  assert.ok(!html.includes('<b>d</b>'));
});

// The catch-all is inside the server callback, not a named function, so it cannot be lifted. Assert
// on its source: it must branch on Accept rather than always writing JSON.
test('the catch-all negotiates instead of always answering JSON', () => {
  const src = L.join('\n');
  const at = src.indexOf('[admin] request failed:');
  assert.ok(at > -1, 'the catch-all log line moved — update this test');
  const block = src.slice(at, at + 1200);
  assert.match(block, /text\/html/, 'the catch-all must branch on Accept');
  assert.match(block, /errorPage\(500/, 'a navigation into the catch-all must get the branded page');
});
