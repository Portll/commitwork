// SHA-256 hex of canonical JSON of baseline record fields (monitor/baseline-freeze.mjs freezeHash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeHash } from '../baseline-freeze.mjs';

test('computes hash for a fully populated record', () => {
  const rec = {
    at: '2024-01-01T00:00:00Z',
    laneSet: ['a', 'b'],
    sampling: 0.5,
    adjudicationProtocol: 'p1',
    interRaterPlan: 'plan1',
    by: 'alice',
    note: 'n1',
  };
  const r = freezeHash('prev1', rec);
  assert.equal(r, "a5908a24e94cec00cfac744583d067f179822e5e7b1ebeae4865acb9983c58b1");
});

test('computes hash when prevHash is null', () => {
  const rec = {
    at: '2024-01-02T00:00:00Z',
    laneSet: [],
    sampling: 1,
    adjudicationProtocol: 'p2',
    interRaterPlan: 'plan2',
    by: 'bob',
    note: 'n2',
  };
  const r = freezeHash(null, rec);
  assert.equal(r, "04e15de56e9f286333db2f1685b29cc7e254c2bd27db67f9b115ebcafda69c41");
});

test('computes hash when laneSet is empty', () => {
  const rec = {
    at: '2024-01-03T00:00:00Z',
    laneSet: [],
    sampling: 0,
    adjudicationProtocol: 'p3',
    interRaterPlan: 'plan3',
    by: 'carol',
    note: 'n3',
  };
  const r = freezeHash('prev3', rec);
  assert.equal(r, "b9b502a19d5ae9c1ce5660438a2c506c93f7f6bd37a1617eb91fa6c3b91ccea6");
});

test('computes hash when sampling is zero', () => {
  const rec = {
    at: '2024-01-04T00:00:00Z',
    laneSet: ['x'],
    sampling: 0,
    adjudicationProtocol: 'p4',
    interRaterPlan: 'plan4',
    by: 'dave',
    note: 'n4',
  };
  const r = freezeHash('prev4', rec);
  assert.equal(r, "f6f669c7102dfdfea1e16835da79d011ce55c54850f2903438e05478fc54d60b");
});

test('computes hash when sampling is one', () => {
  const rec = {
    at: '2024-01-05T00:00:00Z',
    laneSet: ['y'],
    sampling: 1,
    adjudicationProtocol: 'p5',
    interRaterPlan: 'plan5',
    by: 'eve',
    note: 'n5',
  };
  const r = freezeHash('prev5', rec);
  assert.equal(r, "8055075d75527a2f7d9ae8c1a896145efdb2aff951af28f3418336df98c5f40e");
});

test('computes hash when note is empty string', () => {
  const rec = {
    at: '2024-01-06T00:00:00Z',
    laneSet: ['z'],
    sampling: 0.25,
    adjudicationProtocol: 'p6',
    interRaterPlan: 'plan6',
    by: 'frank',
    note: '',
  };
  const r = freezeHash('prev6', rec);
  assert.equal(r, "4fe0878aaaaa47c530eeed198a9c83b850f2ebf1ba783d863d350ca98a99ab50");
});

test('computes hash when by is empty string', () => {
  const rec = {
    at: '2024-01-07T00:00:00Z',
    laneSet: ['w'],
    sampling: 0.75,
    adjudicationProtocol: 'p7',
    interRaterPlan: 'plan7',
    by: '',
    note: 'n7',
  };
  const r = freezeHash('prev7', rec);
  assert.equal(r, "a153804faea524c1be02c629b6a4bdb1a17dbd217ddeec8bcb8f56448b490af2");
});

test('computes hash when all optional fields are empty or zero', () => {
  const rec = {
    at: '2024-01-08T00:00:00Z',
    laneSet: [],
    sampling: 0,
    adjudicationProtocol: '',
    interRaterPlan: '',
    by: '',
    note: '',
  };
  const r = freezeHash('', rec);
  assert.equal(r, "0d266787e3090961137a51fd86ceb2b30d30e1e23c135376c63cca73776508e8");
});

test('computes hash with a long repeated laneSet entry', () => {
  const rec = {
    at: '2024-01-09T00:00:00Z',
    laneSet: ['x'.repeat(100)],
    sampling: 0.1,
    adjudicationProtocol: 'p9',
    interRaterPlan: 'plan9',
    by: 'grace',
    note: 'n9',
  };
  const r = freezeHash('prev9', rec);
  assert.equal(r, "cc9de40cdcf195fdc34fc0bdc18e90a47664e2cade8131cc5b42d6328f2ac0dd");
});

test('computes hash with multiple laneSet entries', () => {
  const rec = {
    at: '2024-01-10T00:00:00Z',
    laneSet: Array.from({ length: 5 }, (_, i) => `lane${i}`),
    sampling: 0.3,
    adjudicationProtocol: 'p10',
    interRaterPlan: 'plan10',
    by: 'heidi',
    note: 'n10',
  };
  const r = freezeHash('prev10', rec);
  assert.equal(r, "a5f950119d0715e4e764c8f13ee93e6f8eaef18148fbe56cd626014985aa4b04");
});
