// Formats a probe report with per-host lines and a summary (bin/probe-public.mjs formatReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReport } from '../probe-public.mjs';

test('renders an ok row with status and ms padding', () => {
  const r = formatReport({
    rows: [{ ok: true, hostname: 'a', status: 200, ms: 10, area: 'x' }],
    counts: { ok: 1 },
    ok: true,
  });
  assert.equal(r, "ok   a                            200       10ms  [x]\n\nall 1 published hostname(s) answered as declared\nok=1");
});

test('renders a failing row with state and detail line', () => {
  const r = formatReport({
    rows: [{ ok: false, hostname: 'b', state: 'timeout', ms: 500, area: 'y', detail: 'boom' }],
    counts: { timeout: 1 },
    ok: false,
  });
  assert.equal(r, "FAIL b                            timeout   500ms  [y]\n       boom\n\n1 of 1 published hostname(s) did NOT answer as declared\ntimeout=1");
});

test('renders a failing row whose status is present instead of state', () => {
  const r = formatReport({
    rows: [{ ok: false, hostname: 'c', status: 503, ms: 1, area: 'z', detail: 'err' }],
    counts: { 'unexpected-status': 1 },
    ok: false,
  });
  assert.equal(r, "FAIL c                            503        1ms  [z]\n       err\n\n1 of 1 published hostname(s) did NOT answer as declared\nunexpected-status=1");
});

test('renders a row where both status and state are undefined', () => {
  const r = formatReport({
    rows: [{ ok: true, hostname: 'd', ms: 0, area: 'w' }],
    counts: { ok: 1 },
    ok: true,
  });
  assert.equal(r, "ok   d                            undefined     0ms  [w]\n\nall 1 published hostname(s) answered as declared\nok=1");
});

test('summarizes all ok with the all-answered message', () => {
  const r = formatReport({
    rows: [
      { ok: true, hostname: 'h1', status: 200, ms: 5, area: 'a' },
      { ok: true, hostname: 'h2', status: 200, ms: 6, area: 'b' },
    ],
    counts: { ok: 2 },
    ok: true,
  });
  assert.equal(r, "ok   h1                           200        5ms  [a]\nok   h2                           200        6ms  [b]\n\nall 2 published hostname(s) answered as declared\nok=2");
});

test('summarizes mixed results with the did-not-answer message', () => {
  const r = formatReport({
    rows: [
      { ok: true, hostname: 'h1', status: 200, ms: 5, area: 'a' },
      { ok: false, hostname: 'h2', state: 'unreachable', ms: 999, area: 'b', detail: 'no route' },
    ],
    counts: { ok: 1, unreachable: 1 },
    ok: false,
  });
  assert.equal(r, "ok   h1                           200        5ms  [a]\nFAIL h2                           unreachable   999ms  [b]\n       no route\n\n1 of 2 published hostname(s) did NOT answer as declared\nok=1 \u00b7 unreachable=1");
});

test('joins multiple count states with the separator', () => {
  const r = formatReport({
    rows: [
      { ok: true, hostname: 's1', status: 200, ms: 1, area: 'a' },
      { ok: false, hostname: 's2', state: 'timeout', ms: 2, area: 'b', detail: 't' },
      { ok: false, hostname: 's3', state: 'skipped', ms: 3, area: 'c', detail: 's' },
    ],
    counts: { ok: 1, timeout: 1, skipped: 1 },
    ok: false,
  });
  assert.equal(r, "ok   s1                           200        1ms  [a]\nFAIL s2                           timeout     2ms  [b]\n       t\nFAIL s3                           skipped     3ms  [c]\n       s\n\n2 of 3 published hostname(s) did NOT answer as declared\nok=1 \u00b7 timeout=1 \u00b7 skipped=1");
});

test('omits the count line when all counts are zero', () => {
  const r = formatReport({
    rows: [{ ok: true, hostname: 'only', status: 200, ms: 1, area: 'a' }],
    counts: { ok: 0, 'unexpected-status': 0, unreachable: 0, timeout: 0, skipped: 0 },
    ok: true,
  });
  assert.equal(r, "ok   only                         200        1ms  [a]\n\nall 1 published hostname(s) answered as declared\n");
});

test('pads a long hostname to the fixed width', () => {
  const r = formatReport({
    rows: [{ ok: true, hostname: 'x'.repeat(30), status: 200, ms: 1, area: 'a' }],
    counts: { ok: 1 },
    ok: true,
  });
  assert.equal(r, "ok   xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx 200        1ms  [a]\n\nall 1 published hostname(s) answered as declared\nok=1");
});

test('pads a short ms value to the fixed width', () => {
  const r = formatReport({
    rows: [{ ok: true, hostname: 'h', status: 200, ms: 1, area: 'a' }],
    counts: { ok: 1 },
    ok: true,
  });
  assert.equal(r, "ok   h                            200        1ms  [a]\n\nall 1 published hostname(s) answered as declared\nok=1");
});
