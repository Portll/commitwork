import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suppressionExpiry } from '../suppression-expiry.mjs';

const NOW = '2026-01-15T00:00:00Z';
const s = (over = {}) => ({ repo: 'r1', file: 'src/a.js', rule: 'no-eval', reason: 'vendored', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-06-01T00:00:00Z', ...over });
const ids = (list) => list.map((x) => [x.repo, x.file, x.rule, x.package]);

test('each suppression lands in exactly one bucket by its expiry', () => {
  const r = suppressionExpiry({
    now: NOW,
    suppressions: [
      s({ repo: 'active' }),
      s({ repo: 'soon', expiresAt: '2026-01-20T00:00:00Z' }),
      s({ repo: 'gone', expiresAt: '2026-01-10T00:00:00Z' }),
      s({ repo: 'undated', expiresAt: undefined }),
    ],
  });
  assert.deepEqual(r.active.map((x) => x.repo), ['active']);
  assert.deepEqual(r.expiringSoon.map((x) => x.repo), ['soon']);
  assert.deepEqual(r.expired.map((x) => x.repo), ['gone']);
  assert.deepEqual(r.undated.map((x) => x.repo), ['undated']);
});

test('a suppression with no expiry is undated and never active', () => {
  for (const expiresAt of [undefined, null]) {
    const r = suppressionExpiry({ now: NOW, suppressions: [s({ expiresAt })] });
    assert.equal(r.active.length, 0);
    assert.equal(r.undated.length, 1);
    assert.equal(r.undated[0].expiresAt, null);
  }
});

test('window edges: expiry at now is expired, at the horizon is expiring soon, past it is active', () => {
  const at = (expiresAt) => suppressionExpiry({ now: NOW, suppressions: [s({ expiresAt })] });
  assert.equal(at('2026-01-15T00:00:00Z').expired.length, 1);
  assert.equal(at('2026-01-15T00:00:01Z').expiringSoon.length, 1);
  assert.equal(at('2026-01-29T00:00:00Z').expiringSoon.length, 1);
  assert.equal(at('2026-01-29T00:00:01Z').active.length, 1);
});

test('windowDays defaults to 14 and moves the horizon when given', () => {
  const sup = [s({ expiresAt: '2026-01-25T00:00:00Z' })];
  assert.equal(suppressionExpiry({ now: NOW, suppressions: sup }).expiringSoon.length, 1);
  assert.equal(suppressionExpiry({ now: NOW, suppressions: sup, windowDays: 5 }).active.length, 1);
});

test('identity ignores line and differs by package', () => {
  const r = suppressionExpiry({ now: NOW, suppressions: [s({ line: 10 }), s({ package: 'lodash', line: 10 })] });
  assert.deepEqual(ids(r.active), [['r1', 'src/a.js', 'no-eval', null], ['r1', 'src/a.js', 'no-eval', 'lodash']]);
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ line: 10 }), s({ line: 99, reason: 'moved' })] }), /duplicate suppression identity/);
});

test('buckets sort field by field, not by a joined string', () => {
  const r = suppressionExpiry({ now: NOW, suppressions: [s({ repo: 'r1a' }), s({ repo: 'r1' }), s({ repo: 'r1', file: 'src/b.js' })] });
  assert.deepEqual(r.active.map((x) => `${x.repo}:${x.file}`), ['r1:src/a.js', 'r1:src/b.js', 'r1a:src/a.js']);
});

test('output does not depend on input order', () => {
  const sup = [s({ repo: 'b' }), s({ repo: 'a', expiresAt: '2026-01-20T00:00:00Z' }), s({ repo: 'c', expiresAt: null })];
  assert.deepEqual(suppressionExpiry({ now: NOW, suppressions: sup }), suppressionExpiry({ now: NOW, suppressions: [...sup].reverse() }));
});

test('dates must be ISO-8601 instants with a zone on a real calendar day', () => {
  for (const bad of ['2026/01/01', '2026-01-01', '2026-01-01T00:00:00', 'Jan 1 2026', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', 1767225600000]) {
    assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ createdAt: bad })] }), /createdAt must be an ISO-8601 instant/, String(bad));
  }
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ expiresAt: 'soon' })] }), /expiresAt must be an ISO-8601 instant/);
  assert.throws(() => suppressionExpiry({ now: '2026-01-15', suppressions: [] }), /now must be an ISO-8601 instant/);
  assert.throws(() => suppressionExpiry({ suppressions: [] }), /now must be an ISO-8601 instant/);
  const offset = suppressionExpiry({ now: '2026-01-15T10:00:00+10:00', suppressions: [s({ expiresAt: '2026-01-15T00:00:00Z' })] });
  assert.equal(offset.expired.length, 1);
});

test('expiry before creation, an empty reason and a non-string package are refused', () => {
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ createdAt: '2026-06-02T00:00:00Z' })] }), /expiresAt is before createdAt/);
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ reason: '  ' })] }), /reason must be a non-empty string/);
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ package: 7 })] }), /package must be a non-empty string/);
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ package: '' })] }), /package must be a non-empty string/);
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [s({ file: '' })] }), /file must be a non-empty string/);
});

test('bad top-level arguments are refused', () => {
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: 'x' }), /suppressions must be an array/);
  assert.throws(() => suppressionExpiry(), /suppressions must be an array/);
  for (const windowDays of [0, -1, 1.5, '14']) {
    assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [], windowDays }), /windowDays must be a positive integer/);
  }
  assert.throws(() => suppressionExpiry({ now: NOW, suppressions: [null] }), /suppressions\[0\] must be an object/);
});

test('no suppressions gives four empty buckets', () => {
  assert.deepEqual(suppressionExpiry({ now: NOW, suppressions: [] }), { active: [], expiringSoon: [], expired: [], undated: [] });
});
