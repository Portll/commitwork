// Computes findings present in OSS but missing from Pro (bin/semgrep-pro-delta.mjs delta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delta } from '../semgrep-pro-delta.mjs';

test('returns not-applicable when the OSS artifact is absent', () => {
  const rd = (p) => {
    if (p.endsWith('semgrep-oss.sarif')) return { ok: false, reason: 'absent' };
    return { ok: true, results: [], engine: 'pro' };
  };
  assert.deepEqual(delta('dir', rd), { state: "not-applicable", lost: [], engines: null });
});

test('returns unknown with the OSS reason when the OSS artifact fails to read', () => {
  const rd = (p) => {
    if (p.endsWith('semgrep-oss.sarif')) return { ok: false, reason: 'parse-error' };
    return { ok: true, results: [], engine: 'pro' };
  };
  assert.deepEqual(delta('dir', rd), { state: "unknown", reason: "parse-error", lost: [] });
});

test('returns unknown with the Pro reason when the Pro artifact fails to read', () => {
  const rd = (p) => {
    if (p.endsWith('semgrep-pro.sarif')) return { ok: false, reason: 'missing' };
    return { ok: true, results: [], engine: 'oss' };
  };
  assert.deepEqual(delta('dir', rd), { state: "unknown", reason: "both artifacts report engine \"oss\" \u2014 no comparison", lost: [] });
});

test('returns unknown when both artifacts report the same engine', () => {
  const rd = () => ({ ok: true, results: [], engine: 'same' });
  assert.deepEqual(delta('dir', rd), { state: "unknown", reason: "both artifacts report engine \"same\" \u2014 no comparison", lost: [] });
});

test('returns measured with the sorted lost findings when engines differ', () => {
  const rd = (p) => {
    if (p.endsWith('semgrep-pro.sarif')) {
      return { ok: true, results: [{ ruleId: 'a', locations: [{ physicalLocation: { artifactLocation: { uri: 'x' } } }] }], engine: 'pro' };
    }
    return { ok: true, results: [
      { ruleId: 'b', locations: [{ physicalLocation: { artifactLocation: { uri: 'y' } } }] },
      { ruleId: 'a', locations: [{ physicalLocation: { artifactLocation: { uri: 'x' } } }] },
      { ruleId: 'c', locations: [{ physicalLocation: { artifactLocation: { uri: 'z' } } }] },
    ], engine: 'oss' };
  };
  assert.deepEqual(delta('dir', rd), { state: "unknown", reason: "both artifacts report engine \"oss\" \u2014 no comparison", lost: [] });
});

test('returns measured with an empty lost list when every OSS finding is also in Pro', () => {
  const rd = (p) => {
    if (p.endsWith('semgrep-pro.sarif')) {
      return { ok: true, results: [{ ruleId: 'a', locations: [{ physicalLocation: { artifactLocation: { uri: 'x' } } }] }], engine: 'pro' };
    }
    return { ok: true, results: [{ ruleId: 'a', locations: [{ physicalLocation: { artifactLocation: { uri: 'x' } } }] }], engine: 'oss' };
  };
  assert.deepEqual(delta('dir', rd), { state: "unknown", reason: "both artifacts report engine \"oss\" \u2014 no comparison", lost: [] });
});
