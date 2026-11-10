// Writes a digest as two-space JSON and rendered Markdown named by its window end (bin/digest.mjs writeDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeDigest } from '../digest.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inTmp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'writeDigest-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const read = (p) => readFileSync(p, 'utf8');
const W = { since: '2025-01-01T00:00:00.000Z', until: '2025-01-02T00:00:00.000Z' };
const head = (status) => ['# commitwork digest', '', `Window: 2025-01-01T00:00:00.000Z \u2192 2025-01-02T00:00:00.000Z \u00b7 status: ${status}`, ''];
const mdOf = (dir, doc) => {
  writeDigest(doc, { root: dir, reportsRoot: join(dir, 'r') });
  return read(join(dir, 'r', 'digest', 'digest-20250102T000000Z.md'));
};

test('creates the missing digest directory and writes two-space JSON and header-only Markdown', () => inTmp((dir) => {
  const doc = { window: { since: '2025-06-01T00:00:00.000Z', until: '2025-06-01T01:00:00.000Z' }, status: 'not-measured', sections: {}, digestId: 'xyz789' };
  const base = join(dir, 'new', 'reports', 'digest', 'digest-20250601T010000Z');
  const r = writeDigest(doc, { root: dir, reportsRoot: join(dir, 'new', 'reports') });
  assert.deepEqual(r, { json: `${base}.json`, md: `${base}.md` });
  assert.equal(read(`${base}.json`), '{\n  "window": {\n    "since": "2025-06-01T00:00:00.000Z",\n    "until": "2025-06-01T01:00:00.000Z"\n  },\n  "status": "not-measured",\n  "sections": {},\n  "digestId": "xyz789"\n}\n');
  assert.equal(read(`${base}.md`), '# commitwork digest\n\nWindow: 2025-06-01T00:00:00.000Z \u2192 2025-06-01T01:00:00.000Z \u00b7 status: not-measured\n\ndigestId: xyz789\n');
}));

test('names the files from the window end with fractional seconds dropped and whole seconds kept', () => inTmp((dir) => {
  const rr = join(dir, 'r');
  const a = writeDigest({ window: { since: 'x', until: '2025-07-04T09:00:01.5Z' }, status: 's', sections: {}, digestId: 'a' }, { root: dir, reportsRoot: rr });
  const b = writeDigest({ window: { since: 'x', until: '2025-07-04T09:00:00Z' }, status: 's', sections: {}, digestId: 'b' }, { root: dir, reportsRoot: rr });
  assert.deepEqual(a, { json: join(rr, 'digest', 'digest-20250704T090001Z.json'), md: join(rr, 'digest', 'digest-20250704T090001Z.md') });
  assert.deepEqual(b, { json: join(rr, 'digest', 'digest-20250704T090000Z.json'), md: join(rr, 'digest', 'digest-20250704T090000Z.md') });
}));

test('replaces an existing digest of the same window end in an existing directory', () => inTmp((dir) => {
  const d = join(dir, 'r', 'digest');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'digest-20250102T000000Z.json'), 'old');
  writeFileSync(join(d, 'digest-20250102T000000Z.md'), 'old');
  const doc = { window: W, status: 'measured', sections: {}, digestId: 'new1' };
  writeDigest(doc, { root: dir, reportsRoot: join(dir, 'r') });
  assert.equal(read(join(d, 'digest-20250102T000000Z.json')), `${JSON.stringify(doc, null, 2)}\n`);
  assert.equal(read(join(d, 'digest-20250102T000000Z.md')), [...head('measured'), 'digestId: new1', ''].join('\n'));
}));

test('renders severity crossings with escaped titles and optional from, repo and state', () => inTmp((dir) => {
  const items = [
    { issueId: 'i1', kind: 'raised', from: 'low', to: 'high', firstAt: '2025-01-01T10:00:00Z', area: 'core', repo: 'web', title: 'a*b', state: 'open' },
    { issueId: 'i2', kind: 'entered', from: null, to: 'critical', firstAt: '2025-01-01T11:00:00Z', area: 'ops', repo: null, title: 'line1\nline2', state: null },
  ];
  const s = { title: 'Severity crossings', status: 'measured', input: [{ name: 'issue store', path: 'monitor/issues.json', state: 'read' }], notMeasured: [], caveats: ['chain | broken'], items };
  assert.equal(mdOf(dir, { window: W, status: 'measured', sections: { severityCrossings: s }, digestId: 'd1' }), [...head('measured'),
    '## Severity crossings \u2014 measured', '', '- input: issue store `monitor/issues.json` (read)', '- caveat: chain \\| broken', '',
    '- **high** raised from low \u00b7 i1 \u00b7 a\\*b (core/web) \u00b7 2025-01-01T10:00:00Z \u00b7 now open',
    '- **critical** entered \u00b7 i2 \u00b7 line1 line2 (ops) \u00b7 2025-01-01T11:00:00Z', '', 'digestId: d1', ''].join('\n'));
}));

test('renders ratchet breaches with undetermined runs, missing peaks and standing or cleared subjects', () => inTmp((dir) => {
  const items = [
    { gate: 'size', subject: 'src/a_b.js', baseline: 10, peak: 12, runs: 2, runsInWindow: 3, firstAt: 'T1', lastAt: 'T2', standing: true, key: 'size:a`b' },
    { gate: 'size', subject: 'x', baseline: 0, peak: null, runs: 1, runsInWindow: 3, firstAt: 'T3', lastAt: 'T3', standing: false },
  ];
  const s = { title: 'Ratchet breaches', status: 'partial', input: [{ name: 'size verdict journal', path: 'v/size.jsonl', state: 'read' }],
    notMeasured: ['lint: journal absent'], caveats: [], undetermined: [{ gate: 'size', runs: 1, byVerdict: { error: 1 } }], items };
  assert.equal(mdOf(dir, { window: W, status: 'partial', sections: { ratchetBreaches: s }, digestId: 'd2' }), [...head('partial'),
    '## Ratchet breaches \u2014 partial', '', '- input: size verdict journal `v/size.jsonl` (read)', '- not measured: lint: journal absent',
    '- undetermined: {"gate":"size","runs":1,"byVerdict":{"error":1}}', '',
    "- size \u00b7 src/a\\_b.js: 10 \u2192 peak 12 \u00b7 2 of 3 run(s) \u00b7 T1 \u2026 T2 \u00b7 **standing** \u00b7 `size:a'b`",
    '- size \u00b7 x: 0 \u2192 peak ? \u00b7 1 of 3 run(s) \u00b7 T3 \u2026 T3 \u00b7 cleared', '', 'digestId: d2', ''].join('\n'));
}));

test('renders empty sections by status: none-in-window when measured, nothing when not measured, measured-part when partial', () => inTmp((dir) => {
  const sections = {
    returnedWarnings: { title: 'Returned warnings', status: 'measured', input: [{ name: 'disregarded-warning register', path: 'r.jsonl', state: 'absent' }], notMeasured: [], caveats: [], items: [] },
    severityCrossings: { title: 'Severity crossings', status: 'not-measured', input: [], notMeasured: ['issue store absent at i.json'], caveats: [], items: [] },
    ratchetBreaches: { title: 'Ratchet breaches', status: 'partial', input: [], notMeasured: [], caveats: [], items: [] },
  };
  assert.equal(mdOf(dir, { window: W, status: 'partial', sections, digestId: 'd3' }), [...head('partial'),
    '## Returned warnings \u2014 measured', '', '- input: disregarded-warning register `r.jsonl` (absent)', '', 'None in window over the inputs above.', '',
    '## Severity crossings \u2014 not-measured', '', '- not measured: issue store absent at i.json', '',
    '## Ratchet breaches \u2014 partial', '', '', 'None in the measured part of the window; the parts above marked not measured say nothing.', '',
    'digestId: d3', ''].join('\n'));
}));

test('renders returned warnings with repeat counts and other sections as generic event lines', () => inTmp((dir) => {
  const rw = { title: 'Returned warnings', status: 'measured', input: [], notMeasured: [], caveats: [], items: [
    { key: 'k1', occurrences: 2, firstSeenAt: 'F1', lastSeenAt: 'L1', disregarded: { at: 'A1', who: 'al_ice', why: 'noise <x>', setAsides: 2, firstAt: 'A0' } },
    { key: 'k2', occurrences: 1, firstSeenAt: 'F2', lastSeenAt: 'L2', disregarded: { at: 'A2', who: 'bob', why: 'ok', setAsides: 1, firstAt: 'A2' } },
  ] };
  const churn = { title: 'Churn', status: 'measured', input: [], notMeasured: [], caveats: [], items: [
    { at: 'T1', type: 'added', area: null, subject: 's[1]', detail: 'd', key: 'kk' },
    { at: 'T2', type: 'removed', area: 'core', subject: 's2' },
  ] };
  assert.equal(mdOf(dir, { window: W, status: 'measured', sections: { returnedWarnings: rw, churn }, digestId: 'd4' }), [...head('measured'),
    '## Returned warnings \u2014 measured', '', '',
    '- **RETURNED** \u00b7 `k1` \u00b7 seen 2 time(s) since it was set aside, first F1, last L1 \u00b7 set aside A1 by al\\_ice: noise \\<x\\> (2 set-asides since A0)',
    '- **RETURNED** \u00b7 `k2` \u00b7 seen 1 time(s) since it was set aside, first F2 \u00b7 set aside A2 by bob: ok', '',
    '## Churn \u2014 measured', '', '',
    '- T1 \u00b7 added \u00b7 - \u00b7 s\\[1\\] \u2014 d \u00b7 `kk`', '- T2 \u00b7 removed \u00b7 core \u00b7 s2', '',
    'digestId: d4', ''].join('\n'));
}));

test('throws before writing anything when the document has no window', () => inTmp((dir) => {
  assert.throws(() => writeDigest({ status: 's', sections: {} }, { root: dir, reportsRoot: join(dir, 'r') }),
    { name: 'TypeError', message: "Cannot read properties of undefined (reading 'until')" });
  assert.equal(existsSync(join(dir, 'r')), false);
}));

test('writes the JSON and then throws when the document has no sections to render', () => inTmp((dir) => {
  const base = join(dir, 'r', 'digest', 'digest-20250102T000000Z');
  assert.throws(() => writeDigest({ window: W, status: 'measured', digestId: 'd5' }, { root: dir, reportsRoot: join(dir, 'r') }),
    { name: 'TypeError', message: 'Cannot convert undefined or null to object' });
  assert.equal(read(`${base}.json`), '{\n  "window": {\n    "since": "2025-01-01T00:00:00.000Z",\n    "until": "2025-01-02T00:00:00.000Z"\n  },\n  "status": "measured",\n  "digestId": "d5"\n}\n');
  assert.equal(existsSync(`${base}.md`), false);
}));
