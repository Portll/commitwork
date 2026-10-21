// GET /api/daily: one project's suggestions from the newest report, each with its veld todo; absence
// and an unreadable report are states of their own; nothing is served off this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyView, routes } from '../routes/daily.mjs';

const suggestion = (id, repo, findingIds) => ({ id, repo, findingIds, priority: 'p1', title: 't', why: 'w', where: [{ file: 'f', line: 1 }], change: 'c', verify: { lane: 'sast', expect: 'e' }, effort: 'S', confidence: 'high' });
const report = (batch, suggestions) => ({
  schema: 'commitwork.daily-report/1', area: 'ar', batch, previousBatch: null, digestId: 'a'.repeat(64), generatedAt: '2026-10-02T01:00:00Z',
  summary: { new: 2, persisting: 0, fixed: 0, carried: 0, omitted: 0, voidLanes: 1, gapDays: null, baselineRepos: ['one'] },
  coverage: [{ repo: 'one', lane: 'sbom-syft', state: 'failed' }, { repo: 'two', lane: 'x', state: 'void' }],
  run: { model: 'm', cli: 'c', attempts: 1, costUsd: 0.5, durationMs: 1, skillSha256: null, authority: 'a' },
  headline: 'h', suggestions, notActioned: [],
});

function dir(files) {
  const d = mkdtempSync(join(tmpdir(), 'cw-daily-route-'));
  mkdirSync(d, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(d, name), typeof value === 'string' ? value : JSON.stringify(value));
  return d;
}

test('no daily directory, or none in it, is "no-reports", never an empty list of suggestions', () => {
  assert.equal(dailyView('/nonexistent/daily', 'one').state, 'no-reports');
  assert.equal(dailyView(dir({ 'ledger.json': {} }), 'one').state, 'no-reports');
});

test('the newest report is shown for the project only, with each suggestion\'s todo from the ledger', () => {
  const d = dir({
    'sweep-20261001000000.json': report('sweep-20261001000000', []),
    'sweep-20261002000000.json': report('sweep-20261002000000', [suggestion('S1', 'one', ['aaaaaaaaaaaaaaaa']), suggestion('S2', 'two', ['bbbbbbbbbbbbbbbb'])]),
    'sweep-20261002000000.todos.json': { created: ['t1'], completed: [], errors: [] },
    'ledger.json': { findings: { aaaaaaaaaaaaaaaa: { todoId: 't1' } } },
  });
  const v = dailyView(d, 'one');
  assert.equal(v.state, 'ok');
  assert.equal(v.batch, 'sweep-20261002000000');
  assert.deepEqual(v.batches, ['sweep-20261002000000', 'sweep-20261001000000']);
  assert.deepEqual(v.suggestions.map((s) => [s.id, s.todos]), [['S1', ['t1']]]);
  assert.deepEqual(v.coverage.map((c) => c.lane), ['sbom-syft']);
  assert.deepEqual(v.todos, { created: 1, completed: 0, errors: [], skipped: false });
  assert.equal(dailyView(d, 'one', 'sweep-20261001000000').suggestions.length, 0);
  assert.equal(dailyView(d, 'one', 'sweep-20260101000000').state, 'no-report-for-batch');
});

test('a report that does not meet its schema is "unreadable", and broken JSON is an error', () => {
  const v = dailyView(dir({ 'sweep-20261002000000.json': { schema: 'commitwork.daily-report/1' } }), 'one');
  assert.equal(v.state, 'unreadable');
  assert.match(v.error, /required/);
  assert.throws(() => dailyView(dir({ 'sweep-20261002000000.json': '{not json' }), 'one'));
});

test('a request that did not come from this machine is refused', () => {
  const [route] = routes;
  let sent;
  route.handle({ req: { url: '/api/daily?project=one' }, send: (status, body) => { sent = { status, body }; }, isLoopbackReq: false });
  assert.equal(sent.status, 403);
  assert.match(sent.body.error, /only on the operator port/);
});
