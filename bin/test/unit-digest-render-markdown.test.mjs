// Renders a digest document as a Markdown string (bin/digest.mjs renderMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../digest.mjs';

test('renders the header with window and status', () => {
  const doc = { window: { since: '2024-01-01T00:00:00Z', until: '2024-01-02T00:00:00Z' }, status: 'measured', sections: {}, digestId: 'abc123' };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: 2024-01-01T00:00:00Z \u2192 2024-01-02T00:00:00Z \u00b7 status: measured\n\ndigestId: abc123\n");
});

test('renders severityCrossings items with the dedicated branch', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd1', sections: { severityCrossings: { title: 'Severity crossings', status: 'measured', input: [{ name: 'issue store', path: 'issues.json', state: 'read' }], notMeasured: [], caveats: [], items: [{ to: 'high', kind: 'raised', from: 'low', issueId: 'i1', title: 'Bug', area: 'core', repo: 'main', firstAt: '2024-01-01T00:00:00Z', state: 'open' }] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Severity crossings \u2014 measured\n\n- input: issue store `issues.json` (read)\n\n- **high** raised from low \u00b7 i1 \u00b7 Bug (core/main) \u00b7 2024-01-01T00:00:00Z \u00b7 now open\n\ndigestId: d1\n");
});

test('renders ratchetBreaches items with the dedicated branch', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd2', sections: { ratchetBreaches: { title: 'Ratchet breaches', status: 'measured', input: [{ name: 'gate-ratchet verdict journal', path: 'verdicts/gate-ratchet.jsonl', state: 'read' }], notMeasured: [], caveats: [], items: [{ gate: 'gate-ratchet', subject: 'complexity', baseline: 10, peak: 15, runs: 2, runsInWindow: 5, firstAt: '2024-01-01T00:00:00Z', lastAt: '2024-01-02T00:00:00Z', standing: true, key: 'k1' }] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Ratchet breaches \u2014 measured\n\n- input: gate-ratchet verdict journal `verdicts/gate-ratchet.jsonl` (read)\n\n- gate-ratchet \u00b7 complexity: 10 \u2192 peak 15 \u00b7 2 of 5 run(s) \u00b7 2024-01-01T00:00:00Z \u2026 2024-01-02T00:00:00Z \u00b7 **standing** \u00b7 `k1`\n\ndigestId: d2\n");
});

test('renders returnedWarnings with one occurrence and one set-aside', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd3', sections: { returnedWarnings: { title: 'Returned warnings', status: 'measured', input: [{ name: 'disregarded-warning register', path: 'warnings.json', state: 'read' }], notMeasured: [], caveats: [], items: [{ key: 'k1', source: 'ratchetBreaches', code: 'C1', subject: 'sub', from: 'ratchetBreaches', firstSeenAt: '2024-01-01T00:00:00Z', lastSeenAt: '2024-01-01T00:00:00Z', occurrences: 1, disregarded: { at: '2023-12-01T00:00:00Z', who: 'alice', why: 'known issue', setAsides: 1, firstAt: '2023-12-01T00:00:00Z' } }] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Returned warnings \u2014 measured\n\n- input: disregarded-warning register `warnings.json` (read)\n\n- **RETURNED** \u00b7 `k1` \u00b7 seen 1 time(s) since it was set aside, first 2024-01-01T00:00:00Z \u00b7 set aside 2023-12-01T00:00:00Z by alice: known issue\n\ndigestId: d3\n");
});

test('renders returnedWarnings with multiple occurrences and set-asides', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd4', sections: { returnedWarnings: { title: 'Returned warnings', status: 'measured', input: [{ name: 'disregarded-warning register', path: 'warnings.json', state: 'read' }], notMeasured: [], caveats: [], items: [{ key: 'k2', source: 'failedWork', code: 'C2', subject: 'sub2', from: 'failedWork', firstSeenAt: '2024-01-01T00:00:00Z', lastSeenAt: '2024-01-03T00:00:00Z', occurrences: 3, disregarded: { at: '2023-12-01T00:00:00Z', who: 'bob', why: 'flaky', setAsides: 2, firstAt: '2023-12-01T00:00:00Z' } }] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Returned warnings \u2014 measured\n\n- input: disregarded-warning register `warnings.json` (read)\n\n- **RETURNED** \u00b7 `k2` \u00b7 seen 3 time(s) since it was set aside, first 2024-01-01T00:00:00Z, last 2024-01-03T00:00:00Z \u00b7 set aside 2023-12-01T00:00:00Z by bob: flaky (2 set-asides since 2023-12-01T00:00:00Z)\n\ndigestId: d4\n");
});

test('renders undetermined entries in a section', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd5', sections: { ratchetBreaches: { title: 'Ratchet breaches', status: 'measured', input: [{ name: 'gate-ratchet verdict journal', path: 'v/gate-ratchet.jsonl', state: 'read' }], notMeasured: [], caveats: [], undetermined: [{ gate: 'gate-ratchet', runs: 2, byVerdict: { undetermined: 2 } }], items: [] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Ratchet breaches \u2014 measured\n\n- input: gate-ratchet verdict journal `v/gate-ratchet.jsonl` (read)\n- undetermined: {\"gate\":\"gate-ratchet\",\"runs\":2,\"byVerdict\":{\"undetermined\":2}}\n\nNone in window over the inputs above.\n\ndigestId: d5\n");
});

test('renders a measured section with no items', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd6', sections: { severityCrossings: { title: 'Severity crossings', status: 'measured', input: [{ name: 'issue store', path: 'issues.json', state: 'read' }], notMeasured: [], caveats: [], items: [] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Severity crossings \u2014 measured\n\n- input: issue store `issues.json` (read)\n\nNone in window over the inputs above.\n\ndigestId: d6\n");
});

test('renders a partial section with no items', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'partial', digestId: 'd7', sections: { severityCrossings: { title: 'Severity crossings', status: 'partial', input: [{ name: 'issue store', path: 'issues.json', state: 'read' }], notMeasured: ['area x: no ingest in window'], caveats: [], items: [] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: partial\n\n## Severity crossings \u2014 partial\n\n- input: issue store `issues.json` (read)\n- not measured: area x: no ingest in window\n\nNone in the measured part of the window; the parts above marked not measured say nothing.\n\ndigestId: d7\n");
});

test('renders a generic section with items using the default branch', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'measured', digestId: 'd8', sections: { failedWork: { title: 'Failed work', status: 'measured', input: [{ name: 'work log', path: 'work.jsonl', state: 'read' }], notMeasured: [], caveats: [], items: [{ at: '2024-01-01T00:00:00Z', type: 'fail', area: 'core', subject: 'test-x', detail: 'assertion failed', key: 'k9' }] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: measured\n\n## Failed work \u2014 measured\n\n- input: work log `work.jsonl` (read)\n\n- 2024-01-01T00:00:00Z \u00b7 fail \u00b7 core \u00b7 test-x \u2014 assertion failed \u00b7 `k9`\n\ndigestId: d8\n");
});

test('renders a not-measured section with no items', () => {
  const doc = { window: { since: 's', until: 'u' }, status: 'not-measured', digestId: 'd9', sections: { severityCrossings: { title: 'Severity crossings', status: 'not-measured', input: [{ name: 'issue store', path: 'issues.json', state: 'absent' }], notMeasured: ['issue store absent at issues.json'], caveats: [], items: [] } } };
  assert.equal(renderMarkdown(doc), "# commitwork digest\n\nWindow: s \u2192 u \u00b7 status: not-measured\n\n## Severity crossings \u2014 not-measured\n\n- input: issue store `issues.json` (absent)\n- not measured: issue store absent at issues.json\n\ndigestId: d9\n");
});
