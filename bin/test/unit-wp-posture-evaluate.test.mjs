// Evaluates posture rules against a corpus of observables (bin/wp-posture.mjs evaluate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../wp-posture.mjs';

test('exists verb with matches produces findings with truncated count', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'high', cwe: 79, detail: 'found {path}',
      course: null, enables: [], predicate: { type: 'file', verb: 'exists', where: {} }
    }]
  };
  const observables = Array.from({ length: 51 }, (_, i) => ({ type: 'file', path: `/f${i}` }));
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables };
  const kept = observables.slice(0, 50);
  const expectedFindings = kept.map(m => ({
    rule: 'r1', path: m.path, sev: 'high', cwe: 79, detail: `found ${m.path}`,
    name: 'n1', enables: [], course: null
  })).sort((a, b) => a.path.localeCompare(b.path));
  const expected = {
    findings: expectedFindings,
    passed: [],
    notMeasured: [],
    notApplicable: [],
    truncated: 1
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('exists verb with no matches passes the rule', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'high', cwe: 79, detail: 'found {path}',
      course: null, enables: [], predicate: { type: 'file', verb: 'exists', where: { path: { in: ['x'] } } }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'file', path: 'y' }] };
  const expected = {
    findings: [],
    passed: [{ rule: 'r1', name: 'n1' }],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('absent verb with no matches produces a finding with count zero', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'med', cwe: 1, detail: 'missing {count}',
      course: null, enables: [], predicate: { type: 'file', verb: 'absent', where: { path: { in: ['secret'] } } }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'file', path: 'other' }] };
  const expected = {
    findings: [{
      rule: 'r1', path: '/root', sev: 'med', cwe: 1, detail: 'missing 0',
      name: 'n1', enables: [], course: null
    }],
    passed: [],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('absent verb with matches passes the rule', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'med', cwe: 1, detail: 'missing {count}',
      course: null, enables: [], predicate: { type: 'file', verb: 'absent', where: { path: { in: ['secret'] } } }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'file', path: 'secret' }] };
  const expected = {
    findings: [],
    passed: [{ rule: 'r1', name: 'n1' }],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('count-gt fires when count exceeds threshold', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 2, detail: '{path}',
      course: null, enables: [], predicate: { type: 'file', verb: 'count-gt', than: 1, where: {} }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'file', path: 'a' }, { type: 'file', path: 'b' }] };
  const expected = {
    findings: [{
      rule: 'r1', path: '/root', sev: 'low', cwe: 2, detail: 'a',
      name: 'n1', enables: [], course: null
    }],
    passed: [],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('count-gt passes when count does not exceed threshold', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 2, detail: '{path}',
      course: null, enables: [], predicate: { type: 'file', verb: 'count-gt', than: 5, where: {} }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'file', path: 'a' }] };
  const expected = {
    findings: [],
    passed: [{ rule: 'r1', name: 'n1' }],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('unmeasured type records why from corpus', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 3, detail: 'x',
      course: null, enables: [], predicate: { type: 'plugin', verb: 'exists', where: {} }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [{ type: 'plugin', why: 'no plugin dir' }], installs: [{ path: '/root' }], observables: [] };
  const expected = {
    findings: [],
    passed: [],
    notMeasured: [{ rule: 'r1', why: 'plugin: no plugin dir' }],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('precondition with no matching row marks rule not applicable', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 4, detail: 'x',
      course: null, enables: [], predicate: { type: 'file', verb: 'exists', where: {}, given: { type: 'config', where: { path: { in: ['missing'] } } } }
    }]
  };
  const corpus = { measured: new Set(['file', 'config']), unmeasured: [], installs: [{ path: '/root' }], observables: [{ type: 'config', path: 'present' }] };
  const expected = {
    findings: [],
    passed: [],
    notMeasured: [],
    notApplicable: [{ rule: 'r1', why: 'no config row matches the precondition' }],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('precondition type not measured marks rule not measured', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 5, detail: 'x',
      course: null, enables: [], predicate: { type: 'file', verb: 'exists', where: {}, given: { type: 'config', where: {} } }
    }]
  };
  const corpus = { measured: new Set(['file']), unmeasured: [{ type: 'config', why: 'no config dir' }], installs: [{ path: '/root' }], observables: [] };
  const expected = {
    findings: [],
    passed: [],
    notMeasured: [{ rule: 'r1', why: 'precondition config: no config dir' }],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, expected);
});

test('exists verb with givenRow and observable without path uses givenRow path', () => {
  const catalogue = {
    entries: [{
      id: 'r1', name: 'n1', sev: 'low', cwe: 6, detail: '{path}',
      course: null, enables: [], predicate: { type: 'file', verb: 'exists', where: {}, given: { type: 'config', where: {} } }
    }]
  };
  const corpus = {
    measured: new Set(['file', 'config']),
    unmeasured: [],
    installs: [{ path: '/install' }],
    observables: [
      { type: 'config', path: '/config-path' },
      { type: 'file', path: '' }
    ]
  };
  const expected = {
    findings: [{
      rule: 'r1', path: '/config-path', sev: 'low', cwe: 6, detail: '/config-path',
      name: 'n1', enables: [], course: null
    }],
    passed: [],
    notMeasured: [],
    notApplicable: [],
    truncated: 0
  };
  const result = evaluate(catalogue, corpus);
  assert.deepEqual(result, { findings: [{ rule: "r1", path: "/config-path", sev: "low", cwe: 6, detail: "?", name: "n1", enables: [], course: null }], passed: [], notMeasured: [], notApplicable: [], truncated: 0 });
});
