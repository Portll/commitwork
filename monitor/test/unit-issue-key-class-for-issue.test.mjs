// determines the issue class based on explicit class, source kind, or scanner category (monitor/issue-key.mjs classForIssue)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classForIssue } from '../issue-key.mjs';

test('throws when issue is null or undefined', () => {
  assert.throws(() => classForIssue(null), {
    name: 'Error',
    message: 'issue-key: classForIssue needs an issue',
  });
  assert.throws(() => classForIssue(undefined), {
    name: 'Error',
    message: 'issue-key: classForIssue needs an issue',
  });
});

test('throws when issue is not an object', () => {
  assert.throws(() => classForIssue(42), {
    name: 'Error',
    message: 'issue-key: classForIssue needs an issue',
  });
  assert.throws(() => classForIssue('string'), {
    name: 'Error',
    message: 'issue-key: classForIssue needs an issue',
  });
});

test('returns explicit class when issue.class is a declared class', () => {
  const r = classForIssue({ class: 'S' });
  assert.equal(r, "S");
});

test('falls through when issue.class is present but not declared', () => {
  const r = classForIssue({ class: 'X', source: { kind: 'other', tool: 'osv' } });
  assert.equal(r, "S");
});

test('throws for manual\u2011sourced issue without class', () => {
  assert.throws(() => classForIssue({ id: '123', source: { kind: 'manual' } }), {
    name: 'Error',
    message:
      'issue-key: issue 123 is manual-sourced and carries no `class` \u2014 a non-scanner issue must declare its own class.',
  });
});

test('throws for queue\u2011sourced issue without class', () => {
  assert.throws(() => classForIssue({ source: { kind: 'queue' } }), {
    name: 'Error',
    message:
      'issue-key: issue (unminted) is queue-sourced and carries no `class` \u2014 a non-scanner issue must declare its own class.',
  });
});

test('returns class derived from known scanner category', () => {
  const r = classForIssue({ source: { kind: 'scanner-row', tool: 'osv' } });
  assert.equal(r, "S");
});

test('throws when scanner category is unknown', () => {
  assert.throws(() => classForIssue({ source: { kind: 'scanner-row', tool: 'unknownCat' } }), {
    name: 'Error',
    message:
      "issue-key: no class declared for scanner category 'unknownCat'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
  });
});

test('throws when source is missing and category cannot be resolved', () => {
  assert.throws(() => classForIssue({}), { name: "Error", message: "issue-key: no class declared for scanner category 'undefined'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on." });
});
