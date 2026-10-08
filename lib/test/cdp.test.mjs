import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, parseDevToolsUrl, launch, connect, newPage, withBrowser, jsString } from '../cdp.mjs';

test('an absent browser is UNAVAILABLE — neither a pass nor a failure', () => {
  const none = findChrome({ env: {}, exists: () => false });
  assert.match(none.unavailable, /no Chrome/);
  assert.equal(none.path, undefined);

  const bad = findChrome({ env: { CW_CHROME: '/nope/chrome' }, exists: () => false });
  assert.match(bad.unavailable, /is not a file/, 'an explicit override that does not resolve is named, not fallen back from');

  const ok = findChrome({ env: { CW_CHROME: '/x/chrome' }, exists: (p) => p === '/x/chrome' });
  assert.equal(ok.path, '/x/chrome');
});

test('the DevTools endpoint is read from the browser, never assumed', () => {
  assert.equal(parseDevToolsUrl('DevTools listening on ws://127.0.0.1:51234/devtools/browser/abc'),
    'ws://127.0.0.1:51234/devtools/browser/abc');
  assert.equal(parseDevToolsUrl('some other output'), null, 'no endpoint is null, not a guessed port');
  assert.equal(parseDevToolsUrl(''), null);
});

test('a selector becomes a literal that evaluates back to itself and carries no markup', () => {
  const ls = String.fromCharCode(0x2028);
  for (const sel of ['#b', 'a[title="x\'y"]', 'p\\q', '</script><img src=x>', `x${ls}y`]) {
    const lit = jsString(sel);
    assert.doesNotMatch(lit, /[<>/]/, lit);
    assert.equal(new Function(`return ${lit};`)(), sel);
  }
});

const chrome = findChrome();

test('THE DRIVER OBSERVES: a real browser, a real DOM, a real console', { skip: chrome.unavailable || false }, async () => {
  const r = await withBrowser(async (conn) => {
    const p = await newPage(conn);
    assert.equal(await p.selfWitness(), true, 'the driver must prove it can read before anything else');
    const g = await p.goto('data:text/html,<title>cw-test</title><h1 id=h>hello</h1>'
      + '<button id=b onclick="document.title=%27clicked%27">go</button>'
      + '<script>console.log("page-said-this")</script>');
    assert.equal(g.loaded, true, 'the load event fired — not a timeout read as success');
    assert.equal(await p.title(), 'cw-test');
    assert.equal(await p.text('#h'), 'hello');
    assert.equal(await p.count('h1'), 1);
    assert.equal(await p.count('.does-not-exist'), 0);
    assert.equal(await p.click('#b'), true);
    assert.equal(await p.title(), 'clicked', 'the click had a real effect, not just a truthy return');
    assert.equal(await p.click('#nope'), false, 'clicking nothing reports false rather than throwing');
    assert.ok(p.consoleLines.some((l) => l.text === 'page-said-this'), 'console is captured');
    return true;
  });
  assert.equal(r.result, true, r.unavailable);
});

test('NEGATIVE CONTROL: the driver reports a page it could NOT read as such', { skip: chrome.unavailable || false }, async () => {
  const r = await withBrowser(async (conn) => {
    const p = await newPage(conn);
    await p.selfWitness();
    await p.goto('data:text/html,<h1>only this</h1>');
    // An absent element must be null/0, never an empty string that reads as "present but blank".
    assert.equal(await p.text('#missing'), null);
    assert.equal(await p.count('#missing'), 0);
    // A page error is captured rather than swallowed.
    await assert.rejects(() => p.evaluate('throw new Error("boom")'), /boom/,
      'an evaluate that throws must reject — a swallowed error is a page that looks fine');
    return true;
  });
  assert.equal(r.result, true, r.unavailable);
});

test('a bogus browser path yields unavailable from launch, with no orphan process', async () => {
  const b = await launch({ env: { CW_CHROME: '/definitely/not/here' }, timeoutMs: 500 });
  assert.match(b.unavailable, /is not a file/);
  assert.equal(b.proc, undefined);
});

test('connect refuses a socket that never opens rather than hanging forever', async () => {
  const conn = connect('ws://127.0.0.1:1/devtools/browser/nope', { timeoutMs: 300 });
  await assert.rejects(() => conn.send('Browser.getVersion'), /socket|closed|timed out/);
});
