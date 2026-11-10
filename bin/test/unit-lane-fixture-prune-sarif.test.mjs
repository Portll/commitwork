// Drops unreferenced SARIF rules and renumbers ruleIndex (bin/lane-fixture.mjs pruneSarif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSarif } from '../lane-fixture.mjs';

const ids = (...names) => names.map((id) => ({ id }));
const run = (rules, results) => (results === undefined ? { tool: { driver: { rules } } } : { tool: { driver: { rules } }, results });
const doc = (...runs) => JSON.stringify({ runs });
const pretty = (...runs) => JSON.stringify({ runs }, null, 1) + '\n';

test('Text that is not JSON comes back unchanged and unpruned', () => {
  assert.deepEqual(pruneSarif('not json'), { text: 'not json', pruned: false });
});

test('A document whose runs is not an array comes back unchanged and unpruned', () => {
  assert.deepEqual(pruneSarif('{"runs":5}'), { text: '{"runs":5}', pruned: false });
  assert.deepEqual(pruneSarif('null'), { text: 'null', pruned: false });
});

test('When every rule is referenced the original text is returned unpruned', () => {
  const text = doc(run(ids('a', 'b'), [{ ruleId: 'a' }, { ruleId: 'b' }]), { tool: { driver: { rules: {} } } }, null);
  assert.deepEqual(pruneSarif(text), { text, pruned: false });
});

test('A rule found by ruleId at the last position is the only one kept', () => {
  const r = pruneSarif(doc(run(ids('a', 'b', 'c'), [{ ruleId: 'c' }])));
  assert.deepEqual(r, { text: pretty(run(ids('c'), [{ ruleId: 'c' }])), pruned: true, removed: 2 });
});

test('A result naming the first rule keeps the rule at index zero', () => {
  const r = pruneSarif(doc(run(ids('a', 'b'), [{ ruleId: 'a' }])));
  assert.deepEqual(r, { text: pretty(run(ids('a'), [{ ruleId: 'a' }])), pruned: true, removed: 1 });
});

test('A ruleId that matches no rule keeps no rules', () => {
  const r = pruneSarif(doc(run(ids('a', 'b'), [{ ruleId: 'zz' }])));
  assert.deepEqual(r, { text: pretty(run([], [{ ruleId: 'zz' }])), pruned: true, removed: 2 });
});

test('Kept rules are ordered by first use and ruleIndex values are renumbered', () => {
  const r = pruneSarif(doc(run(ids('a', 'b', 'c'), [{ ruleIndex: 2 }, { ruleIndex: 0 }, { ruleIndex: 2 }])));
  assert.deepEqual(r, {
    text: pretty(run(ids('c', 'a'), [{ ruleIndex: 0 }, { ruleIndex: 1 }, { ruleIndex: 0 }])),
    pruned: true,
    removed: 1,
  });
});

test('A negative ruleIndex keeps no rule and is left as it was', () => {
  const r = pruneSarif(doc(run(ids('a'), [{ ruleIndex: -1 }])));
  assert.deepEqual(r, { text: pretty(run([], [{ ruleIndex: -1 }])), pruned: true, removed: 1 });
});

test('Removed counts add up across runs and a run without results loses all its rules', () => {
  const r = pruneSarif(doc(run(ids('a', 'b'), [{ ruleId: 'b' }]), run(ids('c', 'd'), [{ ruleIndex: 1 }]), run(ids('e'))));
  assert.deepEqual(r, {
    text: pretty(run(ids('b'), [{ ruleId: 'b' }]), run(ids('d'), [{ ruleIndex: 0 }]), run([])),
    pruned: true,
    removed: 3,
  });
});
