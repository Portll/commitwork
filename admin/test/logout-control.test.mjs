// The logout control must either end the session or SAY it did not — a swallowed failure looks
// exactly like success on the one control that must never be ambiguous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelSource } from './lib/panel-source.mjs';
const SRC = panelSource('index.html');
const handler = SRC.slice(SRC.indexOf('out.onclick = s.authed'), SRC.indexOf('// Remote sign-in switch'));

test('the logout handler no longer swallows its failure in a bare catch', () => {
  assert.doesNotMatch(handler, /catch\s*\(\s*_\s*\)\s*\{\s*\}/,
    'a bare catch here makes a failed logout indistinguishable from a successful one');
});

test('it reads the response and only treats an ok response as logged out', () => {
  assert.match(handler, /r\s*&&\s*r\.ok/, 'the response status must decide, not the absence of a thrown error');
});

test('success reloads, so the auth gate serves the login page rather than the panel re-rendering', () => {
  assert.match(handler, /location\.reload\(\)/);
});

test('failure is SAID in the control the operator is looking at, and stays retryable', () => {
  assert.match(handler, /FAILED/, 'the button must show the failure');
  assert.match(handler, /still signed in/, 'and must say the session survived');
  assert.match(handler, /out\.disabled\s*=\s*false/, 'and must become usable again so a retry is possible');
});
