// classification of stored vs source text (lib/memory-layer-client.mjs classifyStored)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStored } from '../memory-layer-client.mjs';

test('returns unknown when no stored text and no blob', () => {
  const r = classifyStored('source', {}, {});
  assert.deepEqual(r, { form: "unknown", coverage: null, reason: "no content and no decodable blob", text: null, source: "none", contentBytes: null, recoveredBytes: null, attempts: [] });
});

test('returns unknown when source text is empty', () => {
  const exp = { experience: { content: 'stored' } };
  const r = classifyStored('', exp, {});
  assert.deepEqual(r, { form: "unknown", coverage: null, reason: "no source text to compare against", text: "stored", source: "content", contentBytes: 6, recoveredBytes: null, attempts: [] });
});

test('returns full when stored text exactly matches source (hash equal)', () => {
  const txt = 'exact match';
  const exp = { experience: { content: txt } };
  const r = classifyStored(txt, exp, {});
  assert.deepEqual(r, { form: "full", coverage: 1, containment: 1, lengthRatio: 1, reason: null, text: "exact match", source: "content", contentBytes: 11, recoveredBytes: null, attempts: [] });
});

test('returns full via tolerance when normalized texts match but hashes differ', () => {
  const src = 'text with   extra spaces';
  const stored = 'text with extra spaces';
  const exp = { experience: { content: stored } };
  const r = classifyStored(src, exp, {});
  assert.deepEqual(r, { form: "full", coverage: 1, containment: 1, lengthRatio: 1, reason: "normalised match above tolerance", text: "text with extra spaces", source: "content", contentBytes: 22, recoveredBytes: null, attempts: [] });
});

test('returns divergent when containment is below floor', () => {
  const src = 'a b c d e f g h i j k l m n o p';
  const stored = 'x y z u v w q r s t u v w x y z';
  const exp = { experience: { content: stored } };
  const r = classifyStored(src, exp, {});
  assert.deepEqual(r, { form: "divergent", coverage: 0, containment: 0, lengthRatio: 1, reason: "stored text is not derived from the source (0.0% of it appears in the source)", text: "x y z u v w q r s t u v w x y z", source: "content", contentBytes: 31, recoveredBytes: null, attempts: [] });
});

test('returns preview when coverage below tolerance but above floor', () => {
  const src = 'a b c d e f g h i j k l m n o p';
  const stored = 'a b c d e f g h q r s t u v w x';
  const exp = { experience: { content: stored } };
  const r = classifyStored(src, exp, {});
  assert.deepEqual(r, { form: "preview", coverage: 0.5, containment: 0.5, lengthRatio: 1, reason: "server holds 50.0% of the source \u2014 the rest was discarded on store", text: "a b c d e f g h q r s t u v w x", source: "content", contentBytes: 31, recoveredBytes: null, attempts: [] });
});

test('tolerance equality leads to full (coverage == tolerance, lengthRatio == tolerance)', () => {
  const src = 'word '.repeat(20).trim();
  const stored = src;
  const exp = { experience: { content: stored } };
  const r = classifyStored(src, exp, { tolerance: 1 });
  assert.deepEqual(r, { form: "full", coverage: 1, containment: 1, lengthRatio: 1, reason: null, text: "word word word word word word word word word word word word word word word word word word word word", source: "content", contentBytes: 99, recoveredBytes: null, attempts: [] });
});

test('coverage >= tolerance but lengthRatio < tolerance yields preview', () => {
  const src = 'a b c d e f g h i j k l m n o p';
  const stored = 'a b c d e f g h';
  const exp = { experience: { content: stored } };
  const r = classifyStored(src, exp, { tolerance: 0.5 });
  assert.deepEqual(r, { form: "preview", coverage: 0.5, containment: 1, lengthRatio: 0.4838709677419355, reason: "server holds 48.4% of the source \u2014 the rest was discarded on store", text: "a b c d e f g h", source: "content", contentBytes: 15, recoveredBytes: null, attempts: [] });
});
