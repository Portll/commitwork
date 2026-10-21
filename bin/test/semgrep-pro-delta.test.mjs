// The negative delta must be measurable, and every way of NOT measuring it must be distinguishable
// from measuring zero. explicit uncertainty.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { delta, live, identity } from '../semgrep-pro-delta.mjs';

const sarif = (engine, results) => ({ ok: true, engine, results });
const find = (rule, file, line = 1, suppressed = false) => ({
  ruleId: rule,
  ...(suppressed ? { suppressions: [{ kind: 'inSource' }] } : {}),
  locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } }],
});
const reader = (pro, oss) => (p) => (p.endsWith('semgrep-oss.sarif') ? oss : pro);

describe('semgrep pro-delta', () => {
  test('a finding OSS reports and Pro does not is the negative delta', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', [find('a', 'f.js')]),
                                sarif('Semgrep OSS', [find('a', 'f.js'), find('b', 'g.js')])));
    assert.equal(d.state, 'measured');
    assert.deepEqual(d.lost, ['b@g.js']);
  });

  test('SUPPRESSED findings are not losses — nosemgrep is a judgement already made', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', []),
                                sarif('Semgrep OSS', [find('b', 'g.js', 1, true)])));
    assert.deepEqual(d.lost, [], 'a suppressed OSS finding must not read as lost');
  });

  test('IDENTITY EXCLUDES line: the same finding moved is not a loss', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', [find('a', 'f.js', 900)]),
                                sarif('Semgrep OSS', [find('a', 'f.js', 12)])));
    assert.deepEqual(d.lost, [], 'a line move must not manufacture a loss');
  });

  test('no control pass is NOT-APPLICABLE, never "zero lost"', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', []), { ok: false, reason: 'absent' }));
    assert.equal(d.state, 'not-applicable');
  });

  test('an UNPARSEABLE control pass is UNKNOWN, never "zero lost" — fail closed', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', []), { ok: false, reason: 'unparseable SARIF' }));
    assert.equal(d.state, 'unknown');
  });

  test('an unreadable PRO artifact is UNKNOWN even when the control read fine', () => {
    const d = delta('/x', reader({ ok: false, reason: 'unreadable: EACCES' }, sarif('Semgrep OSS', [])));
    assert.equal(d.state, 'unknown');
  });

  test('THE SILENT NO-OP: two passes of the SAME engine compare nothing and must say so', () => {
    const d = delta('/x', reader(sarif('Semgrep OSS', []), sarif('Semgrep OSS', [find('b', 'g.js')])));
    assert.equal(d.state, 'unknown', 'a control that never engaged Pro must not report a clean delta');
  });

  test('output is deterministic — losses are sorted', () => {
    const d = delta('/x', reader(sarif('Semgrep PRO', []),
                                sarif('Semgrep OSS', [find('z', 'z.js'), find('a', 'a.js')])));
    assert.deepEqual(d.lost, ['a@a.js', 'z@z.js']);
  });

  test('live() and identity() are the pieces the caller can reuse', () => {
    assert.equal(live([find('a', 'f.js'), find('b', 'g.js', 1, true)]).length, 1);
    assert.equal(identity(find('a', 'f.js', 77)), 'a@f.js');
  });
});
