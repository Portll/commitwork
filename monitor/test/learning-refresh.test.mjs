import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emptyIssuesDoc, lodgeFix, mintIssue } from '../issue-store.mjs';
import { loadLearning } from '../learning.mjs';
import { refreshLearningView } from '../learning-refresh.mjs';

const NOW = '2026-01-02T00:00:00.000Z';

function source() {
  const doc = Object.assign(emptyIssuesDoc(), { organisation: 'TEST' });
  const { id } = mintIssue(doc, {
    area: 'admin', repo: 'commitwork', kind: 'code', severity: 'high', title: 'xss', class: 'S',
    source: { kind: 'scanner-row', key: 'sc:commitwork|sastCodeql|js/xss|admin/a.mjs', tool: 'sastCodeql', rule: 'js/xss' },
    anchor: { file: 'admin/a.mjs', line: 1, hash: 'abc' },
  }, '2026-01-01T00:00:00.000Z');
  lodgeFix(doc, id, { fixType: 'code-change', notes: 'escape the untrusted attribute value', who: 'alice', at: NOW });
  return doc;
}

test('refresh writes the schema-validated view and reports its cardinality', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cw-learning-refresh-')), 'learning.json');
  const result = refreshLearningView(source(), { now: NOW, policy: {}, path });
  assert.deepEqual(result, { ok: true, state: 'rebuilt', generatedAt: NOW, patterns: 1 });
  assert.equal(Object.keys(loadLearning({ path }).patterns).length, 1);
});

test('refresh reports stale without throwing when the event source is unusable', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cw-learning-refresh-')), 'learning.json');
  const result = refreshLearningView({ events: 'not-an-array' }, { now: NOW, policy: {}, path });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'stale');
  assert.match(result.error, /requires an issue store/);
});

test('every sweep schedules passive learning decay and reports a stale view non-fatally', () => {
  const sweep = readFileSync(new URL('../sweep.mjs', import.meta.url), 'utf8');
  assert.match(sweep, /refreshLearningView\(issuesDoc, \{ now: nowISO\(\) \}\)/,
    'a sweep must refresh learning even when no new remediation event arrived');
  assert.match(sweep, /learning failed \(non-fatal, the learning view is STALE\)/,
    'an unavailable derived view must be visible without invalidating the source issue event');
  assert.match(sweep, /CW_SWEEP_NO_LEARNING/,
    'operators and isolated sweep fixtures need an explicit way to suppress the derived writer');
});
