// The terminal screen lines for a remediation brief (bin/lib/brief-tui.mjs renderScreen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScreen } from '../lib/brief-tui.mjs';

const brief = (o = {}) => ({
  counts: { repos: 1, suppressed: 0 },
  generatedAt: 'T',
  enrichment: { kev: { consulted: false }, epss: { scored: 0, of: 0 } },
  actions: [], issues: [], undetermined: [], notMeasured: [], repos: [],
  ...o,
});
const st = (o = {}) => ({ section: 0, cursor: [0, 0, 0, 0], top: [0, 0, 0, 0], expanded: false, help: false, ...o });
const act = (o = {}) => ({ worst: 'high', kev: 0, epss: null, repo: 'r', package: 'p', version: '1', fix: '2', path: 'm', findings: [], ...o });
const pad = (s, w = 64) => s.padEnd(w);
const foot = (pos, mode, w = 64) => pad(` ${pos} \u00b7 \u2191\u2193 move \u00b7 \u2190\u2192 section \u00b7 Enter ${mode} \u00b7 ? help \u00b7 q quit`, w);
const more = (n) => pad(` \u2026 ${n} more lines (brief.md has them all)`);

test('default options render 80 by 24 without color and pluralize the repo count', () => {
  const one = renderScreen(st(), brief());
  assert.equal(one.length, 24);
  assert.equal(one[0], pad('Remediation brief \u00b7 1 repo \u00b7 T', 80));
  assert.equal(one[1], pad('KEV not consulted \u00b7 EPSS for 0 of 0 advisories', 80));
  assert.equal(one[23], foot('0/0', 'detail', 80));
  const two = renderScreen(st(), brief({
    counts: { repos: 2, suppressed: 5 },
    enrichment: { kev: { consulted: true, catalogVersion: 'v9', freshness: 'fresh' }, epss: { scored: 3, of: 4 } },
  }));
  assert.equal(two[0], pad('Remediation brief \u00b7 2 repos \u00b7 T', 80));
  assert.equal(two[1], pad('KEV v9 (fresh) \u00b7 EPSS for 3 of 4 advisories \u00b7 5 suppressed in source', 80));
});

test('section tabs that exactly fill the width get no padding and one column less drops the last tab', () => {
  const tabs = ['Fixes', 'Findings', 'Undetermined', 'Not measured'].map((t, i) => ` ${i + 1} ${t} (0) `);
  assert.equal(renderScreen(st(), brief(), { cols: 69, rows: 8 })[2], tabs.join(''));
  assert.equal(renderScreen(st(), brief(), { cols: 68, rows: 8 })[2], tabs.slice(0, 3).join('') + ' '.repeat(19));
});

test('the help screen lists help lines from the first one under the header', () => {
  assert.deepEqual(renderScreen(st({ help: true }), brief(), { cols: 10, rows: 6 }), [
    'Remediati\u2026',
    'KEV not c\u2026',
    ' '.repeat(10),
    '  \u2191 \u2193  j \u2026',
    '  PgUp Pg\u2026',
    ' ? help   ',
  ]);
});

test('an empty section shows its empty text on the first list row only', () => {
  const cases = [
    [0, [], '  none found'],
    [0, [{ depsMeasured: true }], '  none found'],
    [0, [{ depsMeasured: false }], '  none found where dependency advisories were measured; see Not measured'],
    [1, [], '  none open'],
    [2, [], '  none'],
    [3, [], '  every in-scope lane ran'],
  ];
  for (const [section, repos, text] of cases) {
    const r = renderScreen(st({ section }), brief({ repos }), { cols: 80, rows: 8 });
    assert.deepEqual(r.slice(3), [pad(text, 80), ...Array(3).fill(' '.repeat(80)), foot('0/0', 'detail', 80)]);
  }
});

test('a cursor past the last item is clamped to it and the footer shows its position', () => {
  const r = renderScreen(st({ cursor: [3, 0, 0, 0] }), brief({ actions: [act({ kev: 2, epss: 0.5 })] }), { cols: 64, rows: 8 });
  assert.deepEqual(r.slice(3), [
    pad('\u203a KEV\u00d72 high  EPSS 0.50  r  p@1 \u2192 2'),
    pad(''),
    pad(''),
    pad(''),
    foot('1/1', 'detail'),
  ]);
});

test('with color the cursor row is reversed and a row of unknown severity is left unpainted', () => {
  const b = brief({ actions: [act(), act({ worst: 'zzz', repo: 's' })] });
  const r = renderScreen(st(), b, { cols: 64, rows: 8, color: true });
  assert.deepEqual(r.slice(3, 7), [
    `\x1b[7m${pad('\u203a' + ' '.repeat(7) + 'high' + ' '.repeat(13) + 'r  p@1 \u2192 2')}\x1b[0m`,
    pad(' '.repeat(8) + 'zzz' + ' '.repeat(14) + 's  p@1 \u2192 2'),
    pad(''),
    pad(''),
  ]);
});

test('expanded detail that fits the body shows no overflow notice and pads with blank lines', () => {
  const b = brief({ actions: [act()] });
  const d = [pad(' r: upgrade p@1 \u2192 2'), pad(' declared in m'), pad('')];
  assert.deepEqual(renderScreen(st({ expanded: true }), b, { cols: 64, rows: 7 }).slice(3), [...d, foot('1/1', 'list')]);
  assert.deepEqual(renderScreen(st({ expanded: true }), b, { cols: 64, rows: 8 }).slice(3), [...d, pad(''), foot('1/1', 'list')]);
});

test('expanded detail longer than the body ends with a count of the lines left out', () => {
  const b = brief({ actions: [act()] });
  assert.deepEqual(renderScreen(st({ expanded: true }), b, { cols: 64, rows: 6 }).slice(3), [
    pad(' r: upgrade p@1 \u2192 2'),
    more(2),
    foot('1/1', 'list'),
  ]);
  assert.deepEqual(renderScreen(st({ expanded: true }), b, { cols: 64, rows: 5 }).slice(3), [more(3), foot('1/1', 'list')]);
});

test('the split layout shows a rule and the selected item detail with an overflow notice', () => {
  const f = { id: 'CVE-1', severity: 'high', cvss: 7.5, kev: true, epss: 0.25, malicious: true, title: 'T1', advisory: 'A1', fixed: '2', tool: 'osv' };
  const b = brief({ actions: [act({ worst: 'crit', kev: 1, epss: 0.9, fix: '', path: '', findings: [f] })] });
  const r = renderScreen(st(), b, { cols: 64, rows: 16 });
  assert.deepEqual(r.slice(3), [
    pad('\u203a KEV\u00d71 crit  EPSS 0.90  r  p@1 \u2192 no fixed version published'),
    ...Array(5).fill(pad('')),
    '\u2500'.repeat(64),
    pad(' r: upgrade p@1 \u2192 no fixed version published'),
    pad(' declared in (no manifest path reported)'),
    pad(''),
    pad(' CVE-1  high \u00b7 CVSS 7.5 \u00b7 KEV \u00b7 EPSS 0.25 \u00b7 MALICIOUS'),
    more(3),
    foot('1/1', 'detail'),
  ]);
});

test('the list scrolls only when the cursor leaves the visible rows', () => {
  const undetermined = Array.from({ length: 6 }, (_, i) => ({ repo: 'r', id: `ID-${i}`, package: 'p', version: '', claimed: '', reason: '' }));
  for (const [cur, top, first] of [[3, 0, 0], [4, 0, 1], [2, 2, 2], [1, 2, 1], [5, 2, 2]]) {
    const r = renderScreen(st({ section: 2, cursor: [0, 0, cur, 0], top: [0, 0, top, 0] }), brief({ undetermined }), { cols: 64, rows: 8 });
    const rows = [0, 1, 2, 3].map((k) => pad(`${first + k === cur ? '\u203a' : ' '} r  ID-${first + k}  p`));
    assert.deepEqual(r.slice(3), [...rows, foot(`${cur + 1}/6`, 'detail')]);
  }
});
