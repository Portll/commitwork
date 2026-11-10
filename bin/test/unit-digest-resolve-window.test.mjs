// The digest time window ending now, one day back by default (bin/digest.mjs resolveWindow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWindow } from '../digest.mjs';

const NOW = Date.UTC(2024, 0, 2);

function freeze(t, now = NOW) {
  t.mock.timers.enable({ apis: ['Date'], now });
}

test('returns the day before now as the window start when since is omitted', (t) => {
  freeze(t);
  assert.deepEqual(resolveWindow({ env: {} }), {
    since: '2024-01-01T00:00:00.000Z',
    until: '2024-01-02T00:00:00.000Z',
  });
});

test('treats an explicit null since as omitted and steps back across a leap day', (t) => {
  freeze(t, Date.UTC(2024, 2, 1));
  assert.deepEqual(resolveWindow({ since: null, env: {} }), {
    since: '2024-02-29T00:00:00.000Z',
    until: '2024-03-01T00:00:00.000Z',
  });
});

test('normalises a since with a timezone offset to UTC ISO form', (t) => {
  freeze(t);
  assert.deepEqual(resolveWindow({ since: '2024-01-01T10:00:00+02:00', env: {} }), {
    since: '2024-01-01T08:00:00.000Z',
    until: '2024-01-02T00:00:00.000Z',
  });
});

test('treats a numeric zero since as the epoch rather than as omitted', (t) => {
  freeze(t);
  assert.deepEqual(resolveWindow({ since: 0, env: {} }), {
    since: '1970-01-01T00:00:00.000Z',
    until: '2024-01-02T00:00:00.000Z',
  });
});

test('throws a RangeError when since is not a parseable timestamp', (t) => {
  freeze(t);
  assert.throws(
    () => resolveWindow({ since: 'not-a-date', env: {} }),
    { name: 'RangeError', message: '--since is not a parseable timestamp: "not-a-date"' }
  );
});

test('throws a RangeError when since is an empty string', (t) => {
  freeze(t);
  assert.throws(
    () => resolveWindow({ since: '', env: {} }),
    { name: 'RangeError', message: '--since is not a parseable timestamp: ""' }
  );
});

test('throws a RangeError when since equals the window end', (t) => {
  freeze(t);
  assert.throws(
    () => resolveWindow({ since: '2024-01-02T00:00:00.000Z', env: {} }),
    { name: 'RangeError', message: '--since 2024-01-02T00:00:00.000Z is not before the window end 2024-01-02T00:00:00.000Z' }
  );
});

test('throws a RangeError when since is one millisecond after the window end', (t) => {
  freeze(t);
  assert.throws(
    () => resolveWindow({ since: '2024-01-02T00:00:00.001Z', env: {} }),
    { name: 'RangeError', message: '--since 2024-01-02T00:00:00.001Z is not before the window end 2024-01-02T00:00:00.000Z' }
  );
});

test('returns the window when since is one millisecond before the end', (t) => {
  freeze(t);
  assert.deepEqual(resolveWindow({ since: '2024-01-01T23:59:59.999Z', env: {} }), {
    since: '2024-01-01T23:59:59.999Z',
    until: '2024-01-02T00:00:00.000Z',
  });
});
