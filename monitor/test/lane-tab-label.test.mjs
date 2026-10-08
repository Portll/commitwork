// monitor/test/lane-tab-label.test.mjs — the chip label, and the collision that would undo it.
//
// The guard that matters is not "does it shorten" but "does it ever shorten two lanes onto the same
// chip". A long label is a legible annoyance; two lanes wearing one name is a wrong identity the
// reader cannot see. Both directions are asserted, and the collision case has its own negative
// control so a rule that never collides is distinguishable from a test that never checks.

import { panelSource } from '../../admin/test/lib/panel-source.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneTabLabel, derivedLaneTabs } from '../lane-tabs.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
// env read at CALL time, never at module load, so a test that sets it afterwards is not defeated
// The panel client moved out of index.html in 54dd4bb, so reading the markup alone no longer
// finds what this asserts. CW_PANEL_HTML still wins when set — the override is the test seam and
// must not be taken away by the fix.
const panelSrc = () => (process.env.CW_PANEL_HTML
  ? readFileSync(process.env.CW_PANEL_HTML, 'utf8')
  : panelSource('index.html'));

test('laneTabLabel: the family word goes, the discriminator leads', () => {
  assert.equal(laneTabLabel('SAST · CodeQL (Python)'), 'CodeQL · Python');
  assert.equal(laneTabLabel('SAST · CodeQL (C/C++)'), 'CodeQL · C/C++');
  assert.equal(laneTabLabel('SAST · Brakeman (Ruby)'), 'Brakeman · Ruby');
  assert.equal(laneTabLabel('SAST · gosec (Go)'), 'gosec · Go');
  assert.equal(laneTabLabel('SAST · Semgrep'), 'Semgrep');
  assert.equal(laneTabLabel('Secrets · Gitleaks'), 'Gitleaks');
});

test('laneTabLabel: a trailing aside is cut from the chip, not from the record', () => {
  assert.equal(laneTabLabel('Lint · clippy (Rust, not a security scan)'), 'clippy · Rust');
  assert.equal(laneTabLabel('Lint · PMD (Java, not a security scan)'), 'PMD · Java');
  // the aside survives on `label`, which is what the tooltip and the view heading render
  const [t] = derivedLaneTabs(['lintRust'], [], () => 'Lint · clippy (Rust, not a security scan)');
  assert.equal(t.label, 'Lint · clippy (Rust, not a security scan)');
  assert.match(t.label, /not a security scan/);
});

test('laneTabLabel: degenerate input falls back rather than returning nothing', () => {
  assert.equal(laneTabLabel('Semgrep'), 'Semgrep');       // no family word to drop
  assert.equal(laneTabLabel(''), '');
  assert.equal(laneTabLabel(null), '');
  assert.equal(laneTabLabel(undefined), '');
  assert.equal(laneTabLabel('SAST · '), 'SAST ·');        // nothing after the separator -> whole (input trimmed)
  assert.equal(laneTabLabel('SAST · ()'), 'SAST · ()');   // empty parenthetical -> whole, never a bare '·'
});

test('a short form claimed by two lanes reverts to the full label FOR BOTH', () => {
  const labels = { a: 'SAST · Semgrep', b: 'Lint · Semgrep' };
  const tabs = derivedLaneTabs(['a', 'b'], [], (c) => labels[c]);
  const shorts = tabs.map((t) => t.short);
  assert.deepEqual(shorts, ['SAST · Semgrep', 'Lint · Semgrep'],
    'both collided on "Semgrep", so both must show the full label');
  assert.equal(new Set(shorts).size, 2, 'and the two must remain distinguishable');
});

test('NEGATIVE CONTROL: non-colliding lanes are NOT reverted', () => {
  // without this, a rule that reverted everything would pass the collision test above
  const labels = { a: 'SAST · Semgrep', b: 'SAST · CodeQL (Python)' };
  const tabs = derivedLaneTabs(['a', 'b'], [], (c) => labels[c]);
  assert.deepEqual(tabs.map((t) => t.short), ['Semgrep', 'CodeQL · Python']);
});

test('the REAL label set produces no collision — measured, not assumed', () => {
  const html = panelSrc();
  const m = html.match(/const SCANNER_LABEL=\{([\s\S]*?)\};/);
  assert.ok(m, 'SCANNER_LABEL not found in the panel — the shape this test reads from has moved');
  const pairs = [...m[1].matchAll(/(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g)].map((x) => [x[1], x[2]]);
  assert.ok(pairs.length > 40, `expected the full label set, parsed ${pairs.length}`);

  const byCat = Object.fromEntries(pairs);
  const tabs = derivedLaneTabs(Object.keys(byCat), [], (c) => byCat[c]);

  // THE INVARIANT IS UNIQUENESS, NOT ABSENCE OF COLLISION. Real lanes DO collide — `JVM CVEs · Trivy`
  // and `IaC config · Trivy` both reduce to `Trivy`, because the tool is the discriminator for one
  // and the subject is for the other. That is the guard working. What must never happen is two chips
  // reading the same after the guard has run.
  const shorts = tabs.map((t) => t.short);
  const dupes = shorts.filter((s, i) => shorts.indexOf(s) !== i);
  assert.deepEqual(dupes, [], `these chips are indistinguishable after the collision guard: ${dupes.join(', ')}`);

  // and the shortening must actually bite on the crowded family
  const sast = tabs.filter((t) => /^SAST · /.test(t.label));
  assert.ok(sast.length >= 10, `expected the SAST cluster, got ${sast.length}`);
  assert.equal(sast.filter((t) => /^SAST/.test(t.short)).length, 0,
    'no SAST chip should still lead with the family word');
});

test('THE CONSUMER: the panel renders `short`, not just receives it', () => {
  // a short label nothing reads is a field, not a fix
  const html = panelSrc();
  assert.match(html, /b\.textContent\s*=\s*t\.short\s*\|\|/,
    'admin/index.html must use t.short for the chip text');
  assert.match(html, /b\.title\s*=\s*`\$\{t\.label\|\|t\.key\}/,
    'the tooltip must keep the FULL label — that is where the dropped aside stays reachable');
  assert.match(html, /LANE_TITLE\[t\.key\]\s*=\s*t\.label\s*\|\|/,
    'the view heading must keep the full label');
});
