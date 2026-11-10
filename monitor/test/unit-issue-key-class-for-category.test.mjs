// Returns the class letter for a scanner category (monitor/issue-key.mjs classForCategory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classForCategory } from '../issue-key.mjs';

test('returns the class for a known category', () => {
  const r = classForCategory('osv');
  assert.equal(r, "S");
});

test('throws for an unknown category', () => {
  assert.throws(
    () => classForCategory('foobar'),
    {
      name: 'Error',
      message:
        "issue-key: no class declared for scanner category 'foobar'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
    },
  );
});

test('throws for a null category', () => {
  assert.throws(
    () => classForCategory(null),
    {
      name: 'Error',
      message:
        "issue-key: no class declared for scanner category 'null'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
    },
  );
});

test('throws for an empty string category', () => {
  assert.throws(
    () => classForCategory(''),
    {
      name: 'Error',
      message:
        "issue-key: no class declared for scanner category ''. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
    },
  );
});

test('throws for numeric zero category', () => {
  assert.throws(
    () => classForCategory(0),
    {
      name: 'Error',
      message:
        "issue-key: no class declared for scanner category '0'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
    },
  );
});

test('throws for boolean false category', () => {
  assert.throws(
    () => classForCategory(false),
    {
      name: 'Error',
      message:
        "issue-key: no class declared for scanner category 'false'. Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.",
    },
  );
});
