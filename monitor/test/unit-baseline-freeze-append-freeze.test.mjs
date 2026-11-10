// appends a hash-chained freeze record to a baseline list (monitor/baseline-freeze.mjs appendFreeze).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFreeze } from '../baseline-freeze.mjs';

test('rejects a non-array lane set with an unbounded pre-registration error', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: 'x', sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 1 }),
    { name: 'Error', message: 'a freeze must name the lane set it covers \u2014 an unbounded pre-registration pre-registers nothing' }
  );
});

test('rejects an empty lane set with an unbounded pre-registration error', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: [], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 1 }),
    { name: 'Error', message: 'a freeze must name the lane set it covers \u2014 an unbounded pre-registration pre-registers nothing' }
  );
});

test('rejects a non-random sampling declaration', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: ['a'], sampling: 'opportunistic', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 1 }),
    { name: 'Error', message: "a freeze must declare sampling:'random'; an opportunistic set is a selection and cannot be pre-registered as a sample" }
  );
});

test('rejects a missing adjudication protocol', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: ['a'], sampling: 'random', adjudicationProtocol: '', interRaterPlan: 'b', at: 1 }),
    { name: 'Error', message: 'a freeze must state how findings will be adjudicated, before any are' }
  );
});

test('rejects a missing inter-rater plan', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: ['a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: '', at: 1 }),
    { name: 'Error', message: 'a freeze must state how inter-rater agreement will be established' }
  );
});

test('rejects a missing timestamp', () => {
  assert.throws(
    () => appendFreeze([], { laneSet: ['a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 0 }),
    { name: 'Error', message: 'a freeze must carry the time it was made \u2014 it is what separates a pre-registration from a post-registration' }
  );
});

test('appends a record with a null previous hash to an empty list', () => {
  const r = appendFreeze([], { laneSet: ['b', 'a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 1 });
  assert.deepEqual(r, [{ at: 1, laneSet: ["a", "b"], sampling: "random", adjudicationProtocol: "a", interRaterPlan: "b", by: null, note: "", prevHash: null, hash: "8a5c8b125055db6c83087fdf222a853338793c909ee0c0d0cb7ef0ab41174090" }]);
});

test('appends a record with a previous hash to a non-empty list', () => {
  const first = appendFreeze([], { laneSet: ['a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 1 });
  const r = appendFreeze(first, { laneSet: ['a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', at: 2 });
  assert.deepEqual(r, [{ at: 1, laneSet: ["a"], sampling: "random", adjudicationProtocol: "a", interRaterPlan: "b", by: null, note: "", prevHash: null, hash: "c0dde46d027f98b2ab0e1fd2affc442750961c03cbd5ff684aa51e6519a60529" }, { at: 2, laneSet: ["a"], sampling: "random", adjudicationProtocol: "a", interRaterPlan: "b", by: null, note: "", prevHash: "c0dde46d027f98b2ab0e1fd2affc442750961c03cbd5ff684aa51e6519a60529", hash: "0279fb96d07c4139c4b0c943b92e05cc8f974e54de09453e9066cfb8ee129058" }]);
});

test('normalizes the note field to an empty string when note is null', () => {
  const r = appendFreeze([], { laneSet: ['a'], sampling: 'random', adjudicationProtocol: 'a', interRaterPlan: 'b', by: null, note: null, at: 1 });
  assert.deepEqual(r, [{ at: 1, laneSet: ["a"], sampling: "random", adjudicationProtocol: "a", interRaterPlan: "b", by: null, note: "", prevHash: null, hash: "c0dde46d027f98b2ab0e1fd2affc442750961c03cbd5ff684aa51e6519a60529" }]);
});
