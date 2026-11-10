// Renders a full HTML project status page from a status object (bin/projectstatus.mjs renderHtml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml } from '../projectstatus.mjs';

const base = {
  generatedAt: '2025-01-01T00:00:00Z',
  anchor: { sha: 'abc123', branch: 'main', dirty: false },
  fleet: [],
  issues: { state: 'absent' },
  docs: { docs: [], maxAgeDays: 30 },
  cra: { state: 'absent' },
};

test('renders a minimal page with no fleet, absent issues, no docs, absent CRA', () => {
  const html = renderHtml(base);
  assert.ok(html.startsWith('<!doctype html><html><head><meta charset="utf-8">'));
  assert.ok(html.includes('<title>commitwork \u2014 project status</title>'));
  assert.ok(html.includes('<h1>commit<b>w</b>ork \u2014 project status</h1>'));
  assert.ok(html.includes('Generated 2025-01-01T00:00:00Z at abc123 (main).'));
  assert.ok(html.includes('<h2>Fleet</h2>'));
  assert.ok(html.includes('<h2>Issues</h2>'));
  assert.ok(html.includes('<h2>Documentation</h2>'));
  assert.ok(html.includes('<h2>CRA</h2>'));
  assert.ok(html.includes('absent.'));
  assert.ok(html.endsWith('</body></html>\n'));
});

test('renders a scanned fleet row with severity cells', () => {
  const s = {
    ...base,
    fleet: [{ label: 'core', scanned: true, repos: 5, open: { crit: 1, high: 2, med: 3, low: 4 }, generatedAge: '2h ago', freshness: 'green' }],
  };
  const html = renderHtml(s);
  assert.ok(html.includes('<tr><td>core</td><td>5</td><td>crit 1 \u00b7 high 2 \u00b7 med 3 \u00b7 low 4</td><td>2h ago</td><td>green</td></tr>'));
});

test('renders an unscanned fleet row with grey dot and explicit uncertainty', () => {
  const s = { ...base, fleet: [{ label: 'edge', scanned: false }] };
  const html = renderHtml(s);
  assert.ok(html.includes('<tr><td>edge</td><td>\u2014</td><td><span class="dot grey"></span> not scanned <small>(explicit uncertainty)</small></td><td>\u2014</td><td>\u2014</td></tr>'));
});

test('renders absent issue store with grey dot', () => {
  const html = renderHtml(base);
  assert.ok(html.includes('<p><span class="dot grey"></span> no issue store <small>(tracker not yet initialised \u2014 explicit uncertainty)</small></p>'));
});

test('renders issue store error with orange dot and escaped message', () => {
  const s = { ...base, issues: { state: 'error', message: 'bad <store>' } };
  const html = renderHtml(s);
  assert.ok(html.includes('<p><span class="dot orange"></span> <b>ISSUE STORE ERROR:</b> bad &lt;store&gt; \u2014 a broken store is not "no issues"; fix it (<code>node bin/issue.mjs verify</code>).</p>'));
});

test('renders present issue store with counts and severity breakdown', () => {
  const s = {
    ...base,
    issues: { state: 'present', open: 10, claimed: 2, blocked: 1, unsatisfiable: 0, closed: 5, slaBreached: 3, suspect: 1, bySeverity: { crit: 1, high: 2, med: 3, low: 4, unknown: 0 } },
  };
  const html = renderHtml(s);
  assert.ok(html.includes('Open <b>10</b> \u00b7 claimed 2 \u00b7 blocked 1 \u00b7 unsatisfiable 0 \u00b7 closed 5 \u00b7 SLA breached <b>3</b> \u00b7 suspect 1'));
  assert.ok(html.includes('Severity (non-closed): crit 1 \u00b7 high 2 \u00b7 med 3 \u00b7 low 4 \u00b7 unknown 0'));
});

test('renders documentation rows with status dots and notes', () => {
  const s = {
    ...base,
    docs: {
      docs: [
        { status: 'green', path: 'README.md', stamp: { date: '2025-01-01' }, reasons: [] },
        { status: 'orange', path: 'docs/api.md', stamp: null, reasons: ['stale'] },
        { status: 'grey', path: 'docs/misc.md', stamp: null, reasons: [] },
      ],
      maxAgeDays: 30,
    },
  };
  const html = renderHtml(s);
  assert.ok(html.includes('<tr><td><span class="dot green"></span>green</td><td>README.md</td><td>verified 2025-01-01</td></tr>'));
  assert.ok(html.includes('<tr><td><span class="dot orange"></span>orange</td><td>docs/api.md</td><td>stale</td></tr>'));
  assert.ok(html.includes('<tr><td><span class="dot grey"></span>grey</td><td>docs/misc.md</td><td></td></tr>'));
});

test('renders CRA present state with open count', () => {
  const s = { ...base, cra: { state: 'present', open: 7 } };
  const html = renderHtml(s);
  assert.ok(html.includes('Open Art. 14 cases: <b>7</b>'));
});

test('renders CRA non-present state as plain text', () => {
  const s = { ...base, cra: { state: 'absent' } };
  const html = renderHtml(s);
  assert.ok(html.includes('<p>absent.</p>'));
});

test('renders dirty anchor with dirty suffix', () => {
  const s = { ...base, anchor: { sha: 'def456', branch: 'dev', dirty: true } };
  const html = renderHtml(s);
  assert.ok(html.includes('Generated 2025-01-01T00:00:00Z at def456 (dev, dirty).'));
});

test('renders button and table headers with exact markup', () => {
  const html = renderHtml(base);
  assert.ok(html.includes('<button onclick="window.print()" title="Print to PDF">Download PDF</button>'));
  assert.ok(html.includes('<table><tr><th>Area</th><th>Repos</th><th>Open findings</th><th>Rollup age</th><th>Freshness</th></tr>'));
  assert.ok(html.includes('<p class="mut">Generated 2025-01-01T00:00:00Z at abc123 (main). Regenerate: <code>node bin/projectstatus.mjs</code>.</p>'));
  assert.ok(html.includes('<p class="mut"><span class="dot green"></span>fresh &nbsp; <span class="dot orange"></span>needs updating &nbsp; <span class="dot grey"></span>unknown freshness \u2014 max age 30d (bin/docs-doctor.mjs)</p>'));
  assert.ok(html.includes('</table>\n<h2>CRA</h2>'));
});
