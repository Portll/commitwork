// Formats a human-readable disk headroom status message (bin/lib/disk-headroom.mjs describeHost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeHost } from '../lib/disk-headroom.mjs';

test('returns ok message with path and one decimal free percent', () => {
  const r = describeHost({ path: '/data', verdict: 'ok', freePct: 42.5, warnPct: 20, failPct: 10 });
  assert.equal(r, "disk headroom ok \u2014 42.5% free on /data (warn 20%, fail 10%)");
});

test('returns ok message without path when path is empty', () => {
  const r = describeHost({ path: '', verdict: 'ok', freePct: 99.9, warnPct: 20, failPct: 10 });
  assert.equal(r, "disk headroom ok \u2014 99.9% free (warn 20%, fail 10%)");
});

test('returns unknown message with reason and path', () => {
  const r = describeHost({ path: '/var', verdict: 'unknown', reason: 'statfs failed' });
  assert.equal(r, "DISK HEADROOM UNKNOWN on /var \u2014 statfs failed. Treat this as unmeasured, not healthy.");
});

test('returns unknown message without path when path is undefined', () => {
  const r = describeHost({ verdict: 'unknown', reason: 'no access' });
  assert.equal(r, "DISK HEADROOM UNKNOWN \u2014 no access. Treat this as unmeasured, not healthy.");
});

test('returns fail message with uppercased verdict and reason', () => {
  const r = describeHost({ path: '/opt', verdict: 'fail', reason: 'below fail threshold' });
  assert.equal(r, "DISK HEADROOM FAIL on /opt \u2014 below fail threshold. A volume this full makes Docker and every writer fail in ways that do not name the disk.");
});

test('returns fail message without path when path is null', () => {
  const r = describeHost({ path: null, verdict: 'fail', reason: 'disk full' });
  assert.equal(r, "DISK HEADROOM FAIL \u2014 disk full. A volume this full makes Docker and every writer fail in ways that do not name the disk.");
});
