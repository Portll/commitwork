// checks that a commit description opens with an imperative verb (bin/lib/conventional-commit.mjs moodError).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodError } from '../lib/conventional-commit.mjs';

test('returns null when the description starts with a lowercase imperative verb', () => {
  assert.deepEqual(moodError('fix the bug'), null);
});

test('returns a house error when the description starts with a capitalized imperative verb', () => {
  assert.deepEqual(moodError('Fix the bug'), { clause: "house", message: "the description starts with 'Fix', and descriptions start lower case", fix: "write 'fix'" });
});

test('returns a house error when the description starts with a possessive', () => {
  assert.deepEqual(moodError("it's broken"), { clause: "house", message: "the description starts with 'it's', a possessive that opens a noun phrase", fix: "start with the verb, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`" });
});

test('returns a house error when the description starts with a non-imperative verb form', () => {
  assert.deepEqual(moodError('fixing the bug'), { clause: "house", message: "the description starts with 'fixing', which is not the imperative", fix: "write 'fix': the subject says what the commit does, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`" });
});

test('returns a house error when the description starts with a noun opener', () => {
  assert.deepEqual(moodError('the bug is fixed'), { clause: "house", message: "the description starts with 'the', which opens a noun phrase", fix: "start with the verb, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`" });
});

test('returns a house error when the description starts with an unknown word', () => {
  assert.deepEqual(moodError('xyzzy the bug'), { clause: "house", message: "the description starts with 'xyzzy', which is not a verb in bin/lib/imperative-verbs.mjs", fix: "start with an imperative verb, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`. If 'xyzzy' is a verb, add it to commitwork's bin/lib/imperative-verbs.mjs" });
});

test('returns a house error when the description is empty', () => {
  assert.deepEqual(moodError(''), { clause: "house", message: "the description starts with '', which is not a verb in bin/lib/imperative-verbs.mjs", fix: "start with an imperative verb, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`. If '' is a verb, add it to commitwork's bin/lib/imperative-verbs.mjs" });
});

test('returns a house error when the description is null', () => {
  assert.deepEqual(moodError(null), { clause: "house", message: "the description starts with '', which is not a verb in bin/lib/imperative-verbs.mjs", fix: "start with an imperative verb, e.g. `feat(gate): fail patches that delete the flagged line`, not `feat: the gate fails a patch that \u2026`. If '' is a verb, add it to commitwork's bin/lib/imperative-verbs.mjs" });
});
