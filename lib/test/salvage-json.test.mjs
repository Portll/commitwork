// G3 — the salvage must not depend on which property the schema emits first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salvageObject, keyFromAnchor } from '../salvage-json.mjs';

const VERDICT_FIRST = 'Let me think.\n{"verdict":"real","findings":[{"classification":"real","reason":"x"}]}\n';
const VERDICT_LAST = 'Let me think.\n{"findings":[{"classification":"real","reason":"x"}],"verdict":"real"}\n';

test('the schema order that happens to work today salvages', () => {
  const r = salvageObject(VERDICT_FIRST, 'verdict');
  assert.equal(r.value.verdict, 'real');
  assert.equal(r.value.findings.length, 1);
});

test('the REORDERED schema salvages the same object — this is the pin', () => {
  const r = salvageObject(VERDICT_LAST, 'verdict');
  assert.equal(r.value.verdict, 'real');
  assert.equal(r.value.findings[0].classification, 'real');
  assert.equal(VERDICT_LAST.lastIndexOf('{"verdict"'), -1, 'the old anchor finds nothing here, which is why it was a defect');
});

test('the outermost object wins over a nested member that also carries the key', () => {
  const text = 'x {"verdict":"outer","findings":[{"verdict":"inner","classification":"real"}]} y';
  const r = salvageObject(text, 'verdict');
  assert.equal(r.value.verdict, 'outer');
});

test('the LAST qualifying object wins over an example quoted earlier in the reasoning', () => {
  const text = 'The schema looks like {"verdict":"<string>","findings":[]} so I answer:\n{"findings":[],"verdict":"false-positive"}';
  assert.equal(salvageObject(text, 'verdict').value.verdict, 'false-positive');
});

test('braces inside strings do not end the object early, and escapes are honoured', () => {
  const text = 'note {"reason":"a } inside \\" a quote","verdict":"real","findings":[]}';
  const r = salvageObject(text, 'verdict');
  assert.equal(r.value.verdict, 'real');
  assert.equal(r.value.reason, 'a } inside " a quote');
});

test('no object with the key, unbalanced text, arrays and empties return null — never a guess', () => {
  assert.equal(salvageObject('{"classification":"real"}', 'verdict'), null);
  assert.equal(salvageObject('{"verdict":"real"', 'verdict'), null);
  // An object INSIDE an array still salvages — the model wrapped its answer in a list. Whether the
  // salvaged shape is acceptable is the caller's shapeCheck, not this scanner's guess.
  assert.equal(salvageObject('[{"verdict":"real"}]', 'verdict').value.verdict, 'real');
  assert.equal(salvageObject('', 'verdict'), null);
  assert.equal(salvageObject(null, 'verdict'), null);
  assert.equal(salvageObject('{"verdict":1}', ''), null);
});

test('keyFromAnchor accepts the legacy anchor form and a plain key alike', () => {
  assert.equal(keyFromAnchor('{"verdict"'), 'verdict');
  assert.equal(keyFromAnchor('{ "classification"'), 'classification');
  assert.equal(keyFromAnchor('verdict'), 'verdict');
});
