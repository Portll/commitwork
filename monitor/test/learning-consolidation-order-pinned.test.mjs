import test from 'node:test';
import assert from 'node:assert/strict';

import { rebuildLearning } from '../learning.mjs';

const noteEvent = (issueId, note, hash) => ({
  type: 'fix-authored',
  issueId,
  at: '2026-01-01T00:00:00.000Z',
  data: {
    rule: 'js/xss',
    pathPrefix: 'admin/routes/',
    package: null,
    evidence: { note, who: issueId.endsWith('1') ? 'alice' : 'bob' },
  },
  prevHash: null,
  hash,
});

test('consolidation pins candidate order independently of arrival order', () => {
  const events = [
    noteEvent('ISS-TEST-S-000001', 'check CSP header before template renders', 'h1'),
    noteEvent('ISS-TEST-S-000002', 'check the CSP header before template rendering', 'h2'),
    noteEvent('ISS-TEST-S-000003', 'check CSP header before template render', 'h3'),
  ];
  const a = rebuildLearning({ issuesDoc: { events }, now: '2026-02-01T00:00:00.000Z' });
  const b = rebuildLearning({ issuesDoc: { events: [events[2], events[0], events[1]] }, now: '2026-02-01T00:00:00.000Z' });
  const key = 'js/xss|admin/routes/|';
  assert.deepEqual(a.patterns[key].consolidated, b.patterns[key].consolidated);
  assert.deepEqual(a.patterns[key].consolidated, {
    text: 'check CSP header before template renders',
    supportCount: 3,
    sourceAnnotations: ['h1', 'h2', 'h3'],
  });
  assert.equal(a.patterns[key].distinctAnnotators, 2);
});
