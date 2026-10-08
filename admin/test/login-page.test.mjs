// loginPage() is the only thing an unauthenticated visitor on the published port ever sees, and it
// had no test. On 2026-08-25 a notice added to it called esc(), which lives inside errorPage() and
// is not in scope here — every published request with a stale cw_admin_sid cookie threw a
// ReferenceError and served the generic 500. Loopback skips the auth gate, so no local check
// reached the branch.
//
// loginPage now lives in admin/lib/login-page.mjs and is IMPORTED — a real module beats
// a lift, which could only ever test a copy of the source. errorPage is still module-scope in
// serve.mjs, which cannot be imported (it starts a listener and reads the keychain), so it is still
// lifted. Counting braces does not work — the body holds braces inside template literals — so it is
// bounded at the first line that is exactly `}`, the column-0 close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loginPage as loginPageModule } from '../lib/login-page.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = serverSource();
// split(/\r?\n/): this file reads serve.mjs DIRECTLY rather than through admin/test/lib/panel-source.mjs,
// so it does not get that helper's line-ending normalisation. Under a CRLF checkout every line ends
// `\r`, `l === '}'` never matches `'}\r'`, and lift() ran to the end of the file or found nothing —
// "could not find the column-0 close of errorPage" on every Windows run.
const LINES = SRC.split(/\r?\n/);

function lift(name) {
  const start = LINES.findIndex((l) => l.startsWith(`function ${name}(`));
  assert.ok(start > -1, `serve.mjs no longer declares a top-level function ${name} — update this extractor`);
  const end = LINES.findIndex((l, i) => i > start && l === '}');
  assert.ok(end > start, `could not find the column-0 close of ${name}`);
  return LINES.slice(start, end + 1).join('\n');
}

// LOCAL_PORT is the only module-scope binding errorPage closes over. loginPage takes it as a
// required option now, so it is supplied here and callers below need not know.
const build = () => ({
  loginPage: (opts) => loginPageModule({ localPort: 7879, ...opts }),
  errorPage: new Function('loginPage', 'esc',
    `const LOCAL_PORT=7879;\n${lift('errorPage')}\nreturn errorPage;`)(loginPageModule, esc),
});

test('the extracted functions construct at all — a scope error here is the outage', () => {
  const { loginPage, errorPage } = build();
  assert.equal(typeof loginPage, 'function');
  assert.equal(typeof errorPage, 'function');
});

test('sign-in renders without a notice', () => {
  const { loginPage } = build();
  const html = loginPage({ bootstrapOpen: false, providers: {} });
  assert.match(html, /Sign in/);
  assert.ok(html.length > 500);
});

test('a notice renders, and is the branch that threw', () => {
  const { loginPage } = build();
  const html = loginPage({ bootstrapOpen: false, providers: {}, notice: 'Session expired.' });
  assert.match(html, /Session expired\./);
});

test('a hostile notice is escaped, never reflected as markup', () => {
  const { loginPage } = build();
  const html = loginPage({ bootstrapOpen: false, providers: {}, notice: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img src=x'), 'the notice must not reach the page as an element');
  assert.match(html, /&lt;img src=x/);
});

test('bootstrapOpen names the operator port rather than offering a sign-in', () => {
  const { loginPage } = build();
  const html = loginPage({ bootstrapOpen: true, providers: {} });
  assert.match(html, /No account yet/);
  assert.match(html, /7879/);
});

test('the Google button is absent unless the provider is on', () => {
  const { loginPage } = build();
  assert.ok(!/id="google"/.test(loginPage({ bootstrapOpen: false, providers: {} })));
  assert.match(loginPage({ bootstrapOpen: false, providers: { google: true } }), /id="google"/);
});

test('the sign-in link carries a return path so login lands back on the view', () => {
  const { loginPage } = build();
  const html = loginPage({ bootstrapOpen: false, providers: { google: true } });
  assert.match(html, /\/auth\/login\/google\?return=/);
});

test('errorPage renders branded HTML, not a JSON body', () => {
  const { errorPage } = build();
  const html = errorPage(500, 'Something went wrong', 'the detail');
  assert.match(html, /Something went wrong/);
  assert.match(html, /HTTP 500/);
  assert.ok(!html.trimStart().startsWith('{'), 'a user-facing error must never be a raw JSON body');
});

test('errorPage escapes its title, detail and back target', () => {
  const { errorPage } = build();
  const html = errorPage(404, '<b>t</b>', '<b>d</b>', { back: "'+alert(1)+'" });
  assert.ok(!html.includes('<b>t</b>'));
  assert.ok(!html.includes('<b>d</b>'));
  assert.ok(!html.includes("'+alert(1)+'"), 'back is embedded in a single-quoted JS string and must be escaped');
});

// docs/THEME.md §3.7: the sign-in page's own rules take every colour from the tokens except the two
// literals listed there. The reversed buttons were a fixed white and black, and a second copy of the
// dark theme's values on light; a new literal must be listed in §3.7 before it lands here.
test('the sign-in rules carry no colour literal but the two THEME.md §3.7 lists', () => {
  const html = loginPageModule({ localPort: 7879, bootstrapOpen: false, providers: {} });
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const literals = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const hex of m[2].match(/#[0-9a-f]{3,8}\b/gi) || []) literals.push(`${m[1].trim()} ${hex}`);
  }
  assert.deepEqual(literals.sort(), ['.qr #fff', 'input #000000']);
  const theme = readFileSync(join(HERE, '..', '..', 'docs', 'THEME.md'), 'utf8');
  const s37 = theme.slice(theme.indexOf('### 3.7'), theme.indexOf('\n## 4.'));
  assert.match(s37, /`#000`.*sign-in/i, 'THEME.md §3.7 does not list the sign-in field ink');
  assert.match(s37, /`#fff`.*QR/, 'THEME.md §3.7 does not list the QR frame');
});
