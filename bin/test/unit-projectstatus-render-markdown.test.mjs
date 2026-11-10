// Render a markdown project status report from a status object (bin/projectstatus.mjs renderMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../projectstatus.mjs';

test('renders header and anchor information', () => {
  const s = {
    generatedAt: '2023-01-01T00:00:00Z',
    anchor: { sha: 'deadbeef', branch: 'main', dirty: false },
    fleet: [],
    issues: { state: 'absent' },
    docs: { maxAgeDays: 30, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  const lines = out.split('\n');
  assert.ok(lines[0].startsWith('# commitwork \u2014 project status'));
  assert.match(lines[3], /Generated 2023-01-01T00:00:00Z at `deadbeef` \(main\)\./);
});

test('renders fleet rows for scanned and not scanned areas', () => {
  const s = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [
      { label: 'A', scanned: true, repos: 2, open: { crit: 1, high: 0, med: 2, low: 0 }, generatedAge: '5h ago', freshness: 'fresh' },
      { label: 'B', scanned: false },
    ],
    issues: { state: 'absent' },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  const rows = out.split('\n').filter(l => l.startsWith('| A') || l.startsWith('| B'));
  assert.equal(rows[0], "| Area | Scanned | Open findings | Rollup age | Freshness |");
  assert.equal(rows[1], "| A | 2 repo(s) | crit 1 \u00b7 high 0 \u00b7 med 2 \u00b7 low 0 | 5h ago | fresh |");
});

test('renders issues when store is absent', () => {
  const s = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: { state: 'absent' },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  assert.ok(out.includes('no issue store (tracker not yet initialised \u2014 explicit uncertainty)'));
});

test('renders issues when store has error', () => {
  const s = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: { state: 'error', message: 'boom' },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  assert.ok(out.includes('**ISSUE STORE ERROR:** boom'));
});

test('renders full issue summary with severity breakdown', () => {
  const s = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: {
      state: 'present',
      open: 5,
      claimed: 2,
      blocked: 1,
      unsatisfiable: 0,
      closed: 3,
      slaBreached: 1,
      suspect: 0,
      bySeverity: { crit: 1, high: 1, med: 2, low: 1, unknown: 0 },
    },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  assert.ok(out.includes('Open **5** \u00b7 claimed 2 \u00b7 blocked 1 \u00b7 unsatisfiable 0 \u00b7 closed 3 \u00b7 SLA breached **1** \u00b7 suspect 0'));
  assert.ok(out.includes('Severity (non-closed): crit 1 \u00b7 high 1 \u00b7 med 2 \u00b7 low 1 \u00b7 unknown 0'));
});

test('renders documentation table and attention list', () => {
  const s = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: { state: 'absent' },
    docs: {
      maxAgeDays: 7,
      docs: [
        { status: 'orange', path: 'src/a.js', reasons: ['outdated'] },
        { status: 'grey', path: 'src/b.js', reasons: ['missing'] },
        { status: 'green', path: 'src/c.js', reasons: [] },
      ],
    },
    docCounts: { green: 1, orange: 1, grey: 1 },
    cra: { state: 'absent' },
  };
  const out = renderMarkdown(s);
  const lines = out.split('\n');
  assert.ok(lines.includes('| green | 1 |'));
  assert.ok(lines.includes('| orange | 1 |'));
  assert.ok(lines.includes('| grey | 1 |'));
  assert.ok(out.includes('Needs attention:'));
  assert.ok(out.includes('\ud83d\udfe0 `src/a.js` \u2014 outdated'));
  assert.ok(out.includes('\u26aa `src/b.js` \u2014 missing'));
});

test('renders CRA open count when present and fallback when not', () => {
  const sPresent = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: { state: 'absent' },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'present', open: 4 },
  };
  const sAbsent = {
    generatedAt: '',
    anchor: { sha: '', branch: '', dirty: false },
    fleet: [],
    issues: { state: 'absent' },
    docs: { maxAgeDays: 0, docs: [] },
    docCounts: {},
    cra: { state: 'absent' },
  };
  const outPresent = renderMarkdown(sPresent);
  const outAbsent = renderMarkdown(sAbsent);
  assert.ok(outPresent.includes('Open Art. 14 cases: **4**'));
  assert.ok(outAbsent.includes('absent.'));
});
