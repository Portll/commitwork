// admin — the profile page's linked-GitHub card, lifted from the served panel source and rendered
// as HTML in every state. The button that starts /auth/github/link must render disabled, with its
// reason in view, whenever the server says the flow cannot run — never as a link that fails after
// GitHub's consent screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelScript } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelScript('index.html');
const line = (prefix) => {
  const at = SRC.indexOf(prefix);
  assert.ok(at > -1, `${prefix} is not in the served panel source`);
  return SRC.slice(at, SRC.indexOf('\n', at));
};
const fnSrc = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} is not in the served panel source`);
  return SRC.slice(at, SRC.indexOf('\n}\n', at) + 2);
};
// the panel's own esc and pill, so an escaping change there is exercised here too
const card = new Function(`${line('const esc=(x)=>')}\n${line('const pill=(s,txt)=>')}\n${fnSrc('pfGithubCard')}\nreturn pfGithubCard;`)();

const UNCONFIGURED = 'GitHub sign-in is not configured on this box (GITHUB_OAUTH_CLIENT_ID)';
const button = (html) => {
  const m = /<button[^>]*id="pf-gh-oauth"[^>]*>/.exec(html);
  assert.ok(m, 'no sign-in-with-GitHub button rendered');
  return m[0];
};

test('unconfigured: the button is disabled and the reason is on the page', () => {
  const html = card({ email: 'op@example.com', github: null, githubLink: { available: false, reason: UNCONFIGURED } });
  const b = button(html);
  assert.match(b, /\sdisabled[\s>]/);
  assert.match(b, /aria-describedby="pf-gh-why"/);
  assert.match(html, new RegExp(`id="pf-gh-why">${UNCONFIGURED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  assert.ok(!html.includes('/auth/github/link'), 'a disabled flow must not leave a live link behind');
});

test('configured: the button is enabled and says what GitHub is asked for', () => {
  const html = card({ email: 'op@example.com', github: null, githubLink: { available: true, reason: null } });
  assert.doesNotMatch(button(html), /disabled/);
  assert.match(html, /read:user/);
  assert.ok(!html.includes('id="pf-gh-why"'));
});

test('no status from the server renders as unavailable, never as available', () => {
  const b = button(card({ email: 'op@example.com', github: null }));
  assert.match(b, /\sdisabled[\s>]/);
});

test('the reason is escaped — it is server text on its way into markup', () => {
  const html = card({ github: null, githubLink: { available: false, reason: '<img src=x onerror=alert(1)>' } });
  assert.ok(!html.includes('<img'), 'an unescaped reason reached the markup');
});

test('the typed form survives only behind the "enter manually" disclosure', () => {
  const html = card({ github: null, githubLink: { available: true, reason: null } });
  const d = /<details class="pf-manual"><summary>enter manually<\/summary>([\s\S]*?)<\/details>/.exec(html);
  assert.ok(d, 'no "enter manually" disclosure');
  assert.match(d[1], /id="pf-gh-login"/);
  assert.match(d[1], /id="pf-gh-id"/);
  assert.equal(html.split('id="pf-gh-login"').length - 1, 1, 'the typed form is also rendered outside the disclosure');
});

test('linked: the login and unlink, and no second way to link', () => {
  const html = card({ github: { login: 'octo-link' }, githubLink: { available: true, reason: null } });
  assert.match(html, /@octo-link/);
  assert.match(html, /id="pf-gh-unlink"/);
  assert.ok(!html.includes('pf-gh-oauth'));
});

test('the enabled button navigates to /auth/github/link', () => {
  assert.match(SRC, /pfOn\('pf-gh-oauth',\(\)=>\{ location\.assign\('\/auth\/github\/link'\); \}\);/);
});

test('every outcome the callback redirects with has a sentence on the page', () => {
  const server = serverSource();
  const sent = [...new Set([...server.matchAll(/linkOutcome\(res, '([a-z]+)'\)/g)].map((m) => m[1]))].sort();
  assert.ok(sent.length >= 5, `found only ${sent.length} outcome codes in serve.mjs — the pattern no longer matches`);
  const at = SRC.indexOf('const PF_GH_OUTCOME={');
  assert.ok(at > -1, 'PF_GH_OUTCOME is not in the served panel source');
  const block = SRC.slice(at, SRC.indexOf('\n};', at));
  const shown = [...block.matchAll(/^\s*([a-z]+):\[/gm)].map((m) => m[1]).sort();
  assert.deepEqual(shown, sent);
});
