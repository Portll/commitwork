// EPSS score and detail maps keyed by CVE id from a feed response (monitor/epss.mjs epssRecordsFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { epssRecordsFrom } from '../epss.mjs';

const CVE = 'CVE-2024-1234';
const nul = (o) => Object.assign(Object.create(null), o);
const want = (scores, detail) => ({ scores: nul(scores), detail: nul(detail) });
const empty = () => want({}, {});
const one = (entry) => epssRecordsFrom({ data: [entry] });

test('a response without data entries yields empty null-prototype maps', () => {
  assert.deepEqual(epssRecordsFrom(null), empty());
  assert.deepEqual(epssRecordsFrom(undefined), empty());
  assert.deepEqual(epssRecordsFrom({}), empty());
  assert.deepEqual(epssRecordsFrom({ data: null }), empty());
  assert.deepEqual(epssRecordsFrom({ data: [] }), empty());
});

test('string fields give a parsed score and a verbatim detail triple', () => {
  const r = one({ cve: CVE, epss: '0.00012', percentile: '0.03000', date: '2024-01-01' });
  assert.deepEqual(r, want(
    { [CVE]: 0.00012 },
    { [CVE]: { probability: '0.00012', percentile: '0.03000', date: '2024-01-01' } },
  ));
});

test('numeric fields are stringified in the detail and a zero score is kept', () => {
  assert.deepEqual(one({ cve: CVE, epss: 0.5, percentile: 0.9, date: 20240101 }), want(
    { [CVE]: 0.5 },
    { [CVE]: { probability: '0.5', percentile: '0.9', date: '20240101' } },
  ));
  assert.deepEqual(one({ cve: CVE, epss: 0, percentile: 0, date: '' }), want(
    { [CVE]: 0 },
    { [CVE]: { probability: '0', percentile: '0', date: '' } },
  ));
});

test('falsy entries are skipped and later entries are still read', () => {
  const valid = { cve: CVE, epss: 0.5, percentile: 0.9, date: 'd' };
  assert.deepEqual(epssRecordsFrom({ data: [null] }), empty());
  assert.deepEqual(epssRecordsFrom({ data: [null, undefined, 0, '', false, valid] }), want(
    { [CVE]: 0.5 },
    { [CVE]: { probability: '0.5', percentile: '0.9', date: 'd' } },
  ));
});

test('a cve that is not a string is skipped even when it coerces to a valid id', () => {
  for (const cve of [[CVE], { toString: () => CVE }, 123, null, undefined]) {
    assert.deepEqual(one({ cve, epss: 0.5, percentile: 0.9, date: 'd' }), empty());
  }
});

test('a cve id needs a four digit year and at least four trailing digits', () => {
  for (const cve of [CVE, 'CVE-2024-12345', `CVE-2024-${'9'.repeat(10)}`]) {
    assert.deepEqual(one({ cve, epss: 0.25 }), want({ [cve]: 0.25 }, {}));
  }
  const rejected = [
    'CVE-2024-123', 'CVE-202-1234', 'CVE-20245-1234', 'CVE-2024-12a4', 'cve-2024-1234',
    ' CVE-2024-1234', 'CVE-2024-1234 ', 'CVE-2024-1234\n', '__proto__', 'constructor', '',
  ];
  for (const cve of rejected) {
    assert.deepEqual(one({ cve, epss: 0.25, percentile: 0.9, date: 'd' }), empty());
  }
});

test('a non-numeric epss records no score but keeps the detail verbatim', () => {
  for (const epss of ['abc', '', 'Infinity']) {
    assert.deepEqual(one({ cve: CVE, epss, percentile: '0.5', date: 'd' }), want(
      {},
      { [CVE]: { probability: epss, percentile: '0.5', date: 'd' } },
    ));
  }
});

test('a missing or null percentile or date records the score without a detail', () => {
  const partials = [
    {},
    { date: 'd' },
    { percentile: 0.9 },
    { percentile: null, date: 'd' },
    { percentile: 0.9, date: null },
    { percentile: null, date: null },
  ];
  for (const rest of partials) {
    assert.deepEqual(one({ cve: CVE, epss: 0.5, ...rest }), want({ [CVE]: 0.5 }, {}));
  }
});

test('a missing or null epss records neither a score nor a detail', () => {
  assert.deepEqual(one({ cve: CVE, percentile: 0.9, date: 'd' }), empty());
  assert.deepEqual(one({ cve: CVE, epss: undefined, percentile: 0.9, date: 'd' }), empty());
  assert.deepEqual(one({ cve: CVE, epss: null, percentile: 0.9, date: 'd' }), empty());
});

test('mixed entries are recorded independently and a repeated cve keeps the last values', () => {
  const r = epssRecordsFrom({ data: [
    { cve: 'CVE-2024-1111', epss: 0.1, percentile: 0.5, date: 'a' },
    { cve: 'bad', epss: 0.9, percentile: 0.9, date: 'z' },
    { cve: 'CVE-2024-2222', epss: 'x', percentile: 0.7, date: 'c' },
    { cve: 'CVE-2024-3333', epss: 0.3 },
    { cve: 'CVE-2024-1111', epss: 0.2, percentile: 0.6, date: 'b' },
  ] });
  assert.deepEqual(r, want(
    { 'CVE-2024-1111': 0.2, 'CVE-2024-3333': 0.3 },
    {
      'CVE-2024-1111': { probability: '0.2', percentile: '0.6', date: 'b' },
      'CVE-2024-2222': { probability: 'x', percentile: '0.7', date: 'c' },
    },
  ));
});
