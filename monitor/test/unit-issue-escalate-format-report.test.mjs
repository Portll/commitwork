// formatReport creates a human-readable or JSON summary of an escalation report (monitor/issue-escalate.mjs formatReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../issue-escalate.mjs';

test('returns JSON when json option is true', () => {
  const r = {
    at: '2023-01-01T00:00:00Z',
    reason: 'test',
    exit: 0,
    overdue: 1,
    paged: 2,
    failed: 3,
    lostRecords: 4,
    pending: []
  };
  assert.equal(formatReport(r, { json: true }), "{\n  \"at\": \"2023-01-01T00:00:00Z\",\n  \"reason\": \"test\",\n  \"exit\": 0,\n  \"overdue\": 1,\n  \"paged\": 2,\n  \"failed\": 3,\n  \"lostRecords\": 4,\n  \"pending\": []\n}");
});

test('dry\u2011run reason produces header and pending lines', () => {
  const r = {
    at: '2023-01-02T00:00:00Z',
    reason: 'dry-run',
    overdue: 5,
    pending: [
      {
        ref: 'ISSUE-1',
        severity: 'high',
        overdueByDays: 7,
        slaDueAt: '2023-01-10'
      },
      {
        ref: 'ISSUE-2',
        severity: 'low',
        overdueByDays: 3,
        slaDueAt: '2023-01-08'
      }
    ]
  };
  assert.equal(formatReport(r), "issue-escalate (dry): 5 overdue, untouched, unpaged issue(s) would page at 2023-01-02T00:00:00Z\n  ISSUE-1  high       7 d over  due 2023-01-10\n  ISSUE-2  low        3 d over  due 2023-01-08");
});

test('non\u2011dry\u2011run and non\u2011nothing\u2011overdue\u2011unpaged reason produces summary line', () => {
  const r = {
    at: '2023-01-03T00:00:00Z',
    reason: 'some-error',
    overdue: 2,
    paged: 1,
    failed: 0,
    lostRecords: 0,
    pending: []
  };
  assert.equal(formatReport(r), "issue-escalate: 2 overdue \u00b7 1 paged \u00b7 0 failed \u00b7 0 unrecorded (some-error)");
});

test('nothing\u2011overdue\u2011unpaged reason produces specific line', () => {
  const r = {
    at: '2023-01-04T00:00:00Z',
    reason: 'nothing-overdue-unpaged',
    overdue: 0,
    paged: 0,
    failed: 0,
    lostRecords: 0,
    pending: []
  };
  assert.equal(formatReport(r), "issue-escalate: nothing overdue and unpaged at 2023-01-04T00:00:00Z");
});

test('dry\u2011run with empty pending array still includes header only', () => {
  const r = {
    at: '2023-01-05T00:00:00Z',
    reason: 'dry-run',
    overdue: 0,
    pending: []
  };
  assert.equal(formatReport(r), "issue-escalate (dry): 0 overdue, untouched, unpaged issue(s) would page at 2023-01-05T00:00:00Z");
});

test('json default false does not trigger JSON branch', () => {
  const r = {
    at: '2023-01-06T00:00:00Z',
    reason: 'dry-run',
    overdue: 1,
    pending: []
  };
  assert.equal(formatReport(r, {}), "issue-escalate (dry): 1 overdue, untouched, unpaged issue(s) would page at 2023-01-06T00:00:00Z");
});
