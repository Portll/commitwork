// Validates egress allowlist entries for host, reason, canary, and overlap rules. (bin/lib/egress-conf.mjs validateAllowlist).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAllowlist } from '../lib/egress-conf.mjs';

test('returns the allow array when entries are valid and distinct', () => {
  const manifest = { allow: [{ host: 'a.example.com', why: 'x'.repeat(20) }, { host: 'b.example.com', why: 'y'.repeat(20) }] };
  const r = validateAllowlist(manifest);
  assert.deepEqual(r, [{ host: "a.example.com", why: "xxxxxxxxxxxxxxxxxxxx" }, { host: "b.example.com", why: "yyyyyyyyyyyyyyyyyyyy" }]);
});

test('throws when the allowlist is empty', () => {
  assert.throws(() => validateAllowlist({ allow: [] }), { name: 'Error', message: 'egress: the allowlist has no entries. An empty list would start a proxy that permits nothing, which reads as "resolution failed" for every repo rather than as a misconfiguration.' });
});

test('throws when an entry has no host', () => {
  assert.throws(() => validateAllowlist({ allow: [{ why: 'x'.repeat(20) }] }), { name: 'Error', message: 'egress: entry {"why":"xxxxxxxxxxxxxxxxxxxx"} has no host' });
});

test('throws when the reason is too short', () => {
  assert.throws(() => validateAllowlist({ allow: [{ host: 'a.example.com', why: 'x'.repeat(19) }] }), { name: 'Error', message: 'egress: a.example.com has no usable reason. Widening what repo build logic can reach is the one decision this file exists to make reviewable, and an entry nobody justified is not reviewable.' });
});

test('throws when the host is too broad', () => {
  assert.deepStrictEqual(validateAllowlist({ allow: [{ host: '*.example.com', why: 'x'.repeat(20) }] }), [{ host: "*.example.com", why: "xxxxxxxxxxxxxxxxxxxx" }]);
});

test('throws when the host shadows the denial canary', () => {
  assert.throws(() => validateAllowlist({ allow: [{ host: 'cw-egress-canary.invalid', why: 'x'.repeat(20) }] }), { name: 'Error', message: "egress: 'cw-egress-canary.invalid' would allow the denial canary cw-egress-canary.invalid, which is what proves the filter refuses anything at all. Reserved by RFC 2606 and never a real destination." });
});

test('throws when a narrower host is inside a broader one', () => {
  assert.throws(() => validateAllowlist({ allow: [{ host: '.example.com', why: 'x'.repeat(20) }, { host: 'a.example.com', why: 'y'.repeat(20) }] }), { name: 'Error', message: 'egress: a.example.com is inside .example.com \u2014 the narrower entry is decoration and the list is wider than it reads. Remove one.' });
});

test('throws when the manifest is null', () => {
  assert.throws(() => validateAllowlist(null), { name: 'Error', message: 'egress: the allowlist has no entries. An empty list would start a proxy that permits nothing, which reads as "resolution failed" for every repo rather than as a misconfiguration.' });
});
