// The generated Top 100 page.
//
// The assertion that earns its keep is the LAST one: the generator counts the classes itself, and
// the document states its own counts in a table a human maintains. Two independent derivations of
// the same fact must agree, so either drifting is caught. The first draft of tally() disagreed
// (36 Unobservable against the document's 32, and 0 uninstalled) because it counted every mention
// rather than each row's primary verdict — six entries carry a context-dependent pair.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tally } from '../top100-html.mjs';

const CW = fileURLToPath(new URL('../..', import.meta.url));
const MD = join(CW, 'docs/TOP-100.md');
const GEN = join(CW, 'bin/top100-html.mjs');
const render = (env = {}) => execFileSync('node', [GEN, '--stdout'],
  { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 8 << 20 });

describe('top100-html', () => {
  test('is deterministic when CW_NOW is pinned', () => {
    const a = render({ CW_NOW: '2026-01-01T00:00:00Z' });
    const b = render({ CW_NOW: '2026-01-01T00:00:00Z' });
    assert.equal(a, b, 'two pinned runs differ — the artifact is not reproducible');
    assert.notEqual(a, render({ CW_NOW: '2027-06-05T00:00:00Z' }),
      'the render date is not in the output, so the determinism check above proves nothing');
  });

  test('is self-contained — no CDN, no external stylesheet, script or font', () => {
    const html = render();
    assert.doesNotMatch(html, /<script/i, 'a script tag: the artifact must open inert over file://');
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
    assert.doesNotMatch(html, /@import|https?:\/\/fonts\./i);
  });

  test('leaves no unrendered markdown behind', () => {
    const html = render();
    const body = html.slice(html.indexOf('<body>'));
    assert.doesNotMatch(body, /^#{1,4}\s/m, 'an unrendered heading');
    assert.doesNotMatch(body, /\*\*[A-Za-z]/, 'unrendered bold');
    assert.doesNotMatch(body, /^\s*\|.*\|\s*$/m, 'an unrendered table row');
  });

  test('colours every verdict, so grey renders as grey', () => {
    const html = render();
    for (const cls of ['v-green', 'v-amber', 'v-violet', 'v-grey']) {
      assert.match(html, new RegExp(`class="v ${cls}"`), `no ${cls} chip — a verdict is rendering as plain prose`);
    }
  });

  test('the generator\'s own count agrees with the count the document states', () => {
    const md = readFileSync(MD, 'utf8');
    const t = tally(md);

    // Parse the document's hand-maintained table rows: | **Provable** — … | **56** |
    const stated = {};
    for (const [, label, n] of md.matchAll(/^\|\s*\*\*(Provable \(uninstalled\)|Provable|Indicative|Unobservable|Partial)\*\*[^|]*\|\s*\*\*(\d+)\*\*\s*\|/gm)) {
      stated[label] = Number(n);
    }
    assert.ok(Object.keys(stated).length >= 4,
      'could not parse the document\'s own tally table — this test would otherwise pass having compared nothing');

    assert.equal(t.provable, stated.Provable, 'Provable: generator vs document');
    assert.equal(t.uninstalled, stated['Provable (uninstalled)'], 'Provable (uninstalled): generator vs document');
    assert.equal(t.indicative, stated.Indicative, 'Indicative: generator vs document');
    assert.equal(t.unobservable, stated.Unobservable, 'Unobservable: generator vs document');

    const total = t.provable + t.uninstalled + t.indicative + t.unobservable + t.partial;
    assert.equal(total, t.classes, 'every class must carry exactly one primary verdict');
  });
});
