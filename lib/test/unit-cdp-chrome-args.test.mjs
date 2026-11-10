// Chrome command-line arguments array (lib/cdp.mjs chromeArgs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeArgs } from '../cdp.mjs';

test('chromeArgs returns headless arguments by default', () => {
  const r = chromeArgs('profileA');
  assert.deepEqual(r, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=profileA", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "about:blank"]);
});

test('chromeArgs returns headless arguments when headless true is passed explicitly', () => {
  const r = chromeArgs('profileB', { headless: true });
  assert.deepEqual(r, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=profileB", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "about:blank"]);
});

test('chromeArgs returns non\u2011headless arguments when headless false is passed', () => {
  const r = chromeArgs('profileC', { headless: false });
  assert.deepEqual(r, ["--remote-debugging-port=0", "--user-data-dir=profileC", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "about:blank"]);
});

test('chromeArgs works with an empty profile string and explicit headless false', () => {
  const r = chromeArgs('', { headless: false });
  assert.deepEqual(r, ["--remote-debugging-port=0", "--user-data-dir=", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "about:blank"]);
});

test('chromeArgs throws TypeError when options argument is not an object', () => {
  assert.throws(() => chromeArgs('profileD', null), { name: "TypeError", message: "Cannot read properties of null (reading 'headless')" });
});
