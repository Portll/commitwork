// A lane at zero because every finding was judged away is not the same fact as a lane at zero
// because nothing was found, and both rendered identically. `triaged` is the third tone: a zero
// somebody argued for, with the rows still present and struck through.
//
// setTabN is inline in admin/index.html, lifted and run against a DOM shim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const at = SRC.indexOf('function setTabN(');
assert.ok(at > -1, 'setTabN was not found in admin/index.html — the extraction anchor moved');
const end = SRC.indexOf('\n}', at);
const FN = SRC.slice(at, end + 2);

function run(view, n, note, annotated, { critical = false } = {}) {
  const el = {
    textContent: '', title: '', _t: null,
    classList: {
      _s: new Set(),
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
      has(c) { return this._s.has(c); },
    },
    removeAttribute() { this.title = ''; },
  };
  const fn = new Function('document', 'CRITICAL_LANE', 'refreshGroupBadges',
    `${FN}; return setTabN;`)(
    { getElementById: (id) => (id === `vn-${view}` ? el : null) },
    new Set(critical ? [view] : []),
    () => {},
  );
  fn(view, n, note, annotated);
  return el;
}

test('the lift is live — a broken extract would make every case below vacuous', () => {
  const el = run('leaks', 5, null, 0);
  assert.equal(el.textContent, '5');
  assert.ok(el.classList.has('warn'), 'a non-zero non-critical lane must warn, or the harness is dead');
});

test('THE POINT: zero-with-annotations is triaged, not clean', () => {
  const el = run('leaks', 0, null, 15);
  assert.ok(el.classList.has('triaged'), 'every finding judged away must not render as a clean scan');
  assert.ok(!el.classList.has('warn'));
  assert.ok(!el.classList.has('crit'));
  assert.match(el.title, /15 finding/, 'the badge must say how many were judged');
  assert.match(el.title, /Not the same as nothing found/);
});

test('a genuinely clean zero stays quiet — no tone, no title', () => {
  const el = run('leaks', 0, null, 0);
  assert.ok(!el.classList.has('triaged'), 'nothing found must not claim a judgment nobody made');
  assert.ok(!el.classList.has('warn'));
  assert.equal(el.title, '', 'a clean zero has nothing to explain');
});

test('a cleared badge (never scanned) is not triaged, whatever the annotation count says', () => {
  const el = run('leaks', null, null, 15);
  assert.equal(el.textContent, '', 'absence renders nothing at all');
  assert.ok(!el.classList.has('triaged'), 'unscanned must never borrow a tone that implies it was read');
});

test('open findings outrank annotations — a partly-triaged lane still warns', () => {
  const el = run('leaks', 3, null, 12);
  assert.ok(el.classList.has('warn'), '3 still open is a queue, not a closed lane');
  assert.ok(!el.classList.has('triaged'));
});

test('crit still outranks everything for a critical lane', () => {
  const el = run('malware', 2, null, 5, { critical: true });
  assert.ok(el.classList.has('crit'));
  assert.ok(!el.classList.has('triaged'));
  assert.ok(!el.classList.has('warn'), 'crit and warn must not both apply');
});

test('an explicit note is not overwritten by the triaged default', () => {
  const el = run('leaks', 0, 'a caller said something more specific', 15);
  assert.equal(el.title, 'a caller said something more specific');
  assert.ok(el.classList.has('triaged'), 'the tone still applies — only the wording deferred');
});

test('a stale triaged class is cleared when the lane reopens', () => {
  // Same element, two renders: the toggle must remove the class, not just fail to add it.
  const el = run('leaks', 0, null, 15);
  assert.ok(el.classList.has('triaged'));
  const again = run('leaks', 4, null, 15);
  assert.ok(!again.classList.has('triaged'), 'a reopened lane must lose the tone');
});
