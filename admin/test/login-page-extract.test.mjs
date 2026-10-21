// Behaviour of the extracted loginPage(). Imports the module directly — serve.mjs cannot be
// imported (it listens and reads the keychain), which is why this page had no direct test before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loginPage } from '../lib/login-page.mjs';

const PORT = 7879;
const base = (extra = {}) => loginPage({ bootstrapOpen: false, localPort: PORT, ...extra });

// Markers chosen to be unique to one branch each.
const GOOGLE_BTN = '<button type="button" id="google" class="sso">';
const GOOGLE_TEXT = 'Sign in with Google';
const PASSKEY_BTN = '<button type="button" id="passkey" class="sso" hidden>';
const FORM = '<form id="f" novalidate>';
const SIGNIN_H1 = '<h1 id="ht">Sign in</h1>';
const BOOTSTRAP_H1 = '<h1>No account yet</h1>';
const NOTICE_OPEN = '<p class="hint" role="status">';

test('the Google button appears only when providers names it', () => {
  const on = base({ providers: { google: true } });
  assert.ok(on.includes(GOOGLE_BTN), 'configured provider must render its button');
  assert.ok(on.includes(GOOGLE_TEXT));

  for (const providers of [{}, { google: false }, undefined]) {
    const off = base(providers === undefined ? {} : { providers });
    assert.ok(!off.includes(GOOGLE_BTN), `unconfigured provider must not render a button (${JSON.stringify(providers)})`);
    assert.ok(!off.includes(GOOGLE_TEXT));
  }
});

// The passkey button needs no provider — the authenticator and the panel are the only parties, so
// it is offered on every sign-in page. A `providers`-gated assertion would wrongly pass if the two
// buttons were ever collapsed into one branch.
test('the passkey button is offered regardless of providers', () => {
  assert.ok(base().includes(PASSKEY_BTN));
  assert.ok(base({ providers: { google: true } }).includes(PASSKEY_BTN));
});

test('bootstrapOpen changes the page in both directions, not just its bytes', () => {
  const open = loginPage({ bootstrapOpen: true, localPort: PORT });
  const shut = base();

  assert.ok(open.includes(BOOTSTRAP_H1), 'bootstrap page must say no account exists');
  assert.ok(open.includes('on the operator port'));
  assert.ok(!open.includes(FORM), 'bootstrap page must not offer a sign-in form that cannot succeed');
  assert.ok(!open.includes(SIGNIN_H1));
  assert.ok(!open.includes(PASSKEY_BTN));

  assert.ok(shut.includes(SIGNIN_H1), 'sign-in page must offer the form');
  assert.ok(shut.includes(FORM));
  assert.ok(!shut.includes(BOOTSTRAP_H1));
  assert.ok(!shut.includes('on the operator port'));
});

// The operator port is the only port that will accept the first account, so naming the wrong one
// sends the reader to a page that refuses them with no explanation.
test('localPort reaches the bootstrap instruction', () => {
  const html = loginPage({ bootstrapOpen: true, localPort: 7999 });
  assert.ok(html.includes('http://127.0.0.1:7999'));
  assert.ok(!html.includes('http://127.0.0.1:7879'));
});

test('notice renders when supplied and is absent when null', () => {
  const withNotice = base({ notice: 'Session expired.' });
  assert.ok(withNotice.includes(`${NOTICE_OPEN}Session expired.</p>`));

  for (const notice of [null, undefined, '']) {
    const without = base(notice === undefined ? {} : { notice });
    assert.ok(!without.includes(NOTICE_OPEN), `notice=${JSON.stringify(notice)} must render no notice element`);
    assert.ok(!without.includes('Session expired.'));
  }
});

// Documented consequence of the branch order, not an endorsement: an expired-session notice is
// dropped when the store is empty, because bootstrapOpen replaces the whole body.
test('bootstrapOpen suppresses notice', () => {
  const html = loginPage({ bootstrapOpen: true, localPort: PORT, notice: 'Session expired.' });
  assert.ok(!html.includes('Session expired.'));
});

test('override replaces the body and is absent when null', () => {
  const html = base({ override: '<h1>Not found</h1><p class="lede">no such page</p>' });
  assert.ok(html.includes('<h1>Not found</h1>'));
  assert.ok(!html.includes(FORM), 'override must replace the form, not sit beside it');
  assert.ok(!html.includes(SIGNIN_H1));
  assert.ok(!html.includes(PASSKEY_BTN));

  assert.ok(!base().includes('<h1>Not found</h1>'));
});

test('override outranks bootstrapOpen', () => {
  const html = loginPage({ bootstrapOpen: true, localPort: PORT, override: '<h1>Not found</h1>' });
  assert.ok(html.includes('<h1>Not found</h1>'));
  assert.ok(!html.includes(BOOTSTRAP_H1));
});

// notice is the one caller-supplied value inlined without the caller escaping it — the cookie test
// at the call site decides it, but the value crosses a request boundary, so it is escaped here.
test('notice is escaped, so markup in it cannot become markup', () => {
  const payload = `<script>alert('xss')</script>&"'`;
  const html = base({ notice: payload });

  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!html.includes(payload), 'the raw payload must not survive into the document');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.ok(!html.includes("<script>alert('xss')</script>"));
  assert.ok(!html.includes('alert(&#39;xss&#39;)'.replace(/&#39;/g, "'")), 'no unescaped alert() call');
  assert.ok(html.includes('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;&amp;&quot;&#39;'),
    'every one of & < > " \' must be escaped');
});

test('each of & < > " \' is escaped individually', () => {
  for (const [raw, esc] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]) {
    const html = base({ notice: `a${raw}b` });
    assert.ok(html.includes(`${NOTICE_OPEN}a${esc}b</p>`), `${raw} must render as ${esc}`);
  }
});

// override is a TRUSTED-HTML slot: errorPage() escapes before calling. Pinned so that changing it
// to escape (which would break errorPage's markup) is a deliberate act.
test('override is inserted raw', () => {
  assert.ok(base({ override: '<b>bold</b>' }).includes('<b>bold</b>'));
});

// Negative control: a loginPage() that ignored its arguments and returned a constant would pass
// every "contains" assertion above that looks only at the branch it happens to return.
test('distinct inputs produce distinct pages', () => {
  const cases = {
    bootstrap: { bootstrapOpen: true, localPort: PORT },
    'bootstrap other port': { bootstrapOpen: true, localPort: 8123 },
    signin: { bootstrapOpen: false, localPort: PORT },
    'signin + google': { bootstrapOpen: false, localPort: PORT, providers: { google: true } },
    'signin + notice': { bootstrapOpen: false, localPort: PORT, notice: 'Session expired.' },
    override: { bootstrapOpen: false, localPort: PORT, override: '<h1>Not found</h1>' },
  };
  const names = Object.keys(cases);
  const html = Object.fromEntries(names.map((n) => [n, loginPage(cases[n])]));

  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      assert.notEqual(html[names[i]], html[names[j]], `"${names[i]}" and "${names[j]}" produced identical HTML`);
    }
  }
});

test('same inputs produce byte-identical output', () => {
  const opts = { bootstrapOpen: false, localPort: PORT, providers: { google: true }, notice: 'Session expired.' };
  assert.equal(loginPage(opts), loginPage({ ...opts }));
  assert.equal(loginPage({ bootstrapOpen: true, localPort: PORT }), loginPage({ bootstrapOpen: true, localPort: PORT }));
});

// The page's whole point is that it renders on a public hostname with zero external requests: its
// CSP forbids them, so a CDN reference is a blank page rather than an unstyled one.
test('the page issues no external request', () => {
  for (const html of [loginPage({ bootstrapOpen: true, localPort: PORT }), base({ providers: { google: true } })]) {
    assert.ok(!/(src|href)\s*=\s*["']https?:\/\//i.test(html), 'no absolute http(s) asset reference');
    assert.ok(!html.includes('//cdn.'), 'no CDN reference');
  }
});
