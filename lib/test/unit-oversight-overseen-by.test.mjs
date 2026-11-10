// Computes the latest stance per reviewer for a subject and classifies the result (lib/oversight.mjs overseenBy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overseenBy } from '../oversight.mjs';

test('returns none with reason when subject names nothing', () => {
  assert.deepEqual(overseenBy([], null), { state: "none", corroborated: [], disputed: [], reason: "subject names nothing" });
});

test('returns none with empty lists when no records match the subject', () => {
  assert.deepEqual(overseenBy([], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "none", corroborated: [], disputed: [] });
});

test('returns corroborated when one reviewer corroborates', () => {
  assert.deepEqual(overseenBy([{ who: 'alice', stance: 'corroborate', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "corroborated", corroborated: ["alice"], disputed: [] });
});

test('returns disputed when one reviewer disputes', () => {
  assert.deepEqual(overseenBy([{ who: 'bob', stance: 'dispute', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "disputed", corroborated: [], disputed: ["bob"] });
});

test('returns mixed when both corroborate and dispute', () => {
  assert.deepEqual(overseenBy([
    { who: 'alice', stance: 'corroborate', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } },
    { who: 'bob', stance: 'dispute', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }
  ], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "mixed", corroborated: ["alice"], disputed: ["bob"] });
});

test('last stance per person wins when a reviewer changes their mind', () => {
  assert.deepEqual(overseenBy([
    { who: 'alice', stance: 'corroborate', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } },
    { who: 'alice', stance: 'dispute', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }
  ], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "disputed", corroborated: [], disputed: ["alice"] });
});

test('ignores records with invalid stance values', () => {
  assert.deepEqual(overseenBy([
    { who: 'alice', stance: 'approve', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } },
    { who: 'bob', stance: 'corroborate', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }
  ], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "corroborated", corroborated: ["bob"], disputed: [] });
});

test('ignores records whose subject does not match', () => {
  assert.deepEqual(overseenBy([
    { who: 'alice', stance: 'corroborate', subject: { repo: 'other', file: 'f', rule: 'x', package: 'p' } },
    { who: 'bob', stance: 'dispute', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }
  ], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "disputed", corroborated: [], disputed: ["bob"] });
});

test('handles null records in the array without throwing', () => {
  assert.deepEqual(overseenBy([null, { who: 'bob', stance: 'dispute', subject: { repo: 'r', file: 'f', rule: 'x', package: 'p' } }], { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "disputed", corroborated: [], disputed: ["bob"] });
});

test('returns none with empty lists when records is null', () => {
  assert.deepEqual(overseenBy(null, { repo: 'r', file: 'f', rule: 'x', package: 'p' }), { state: "none", corroborated: [], disputed: [] });
});
