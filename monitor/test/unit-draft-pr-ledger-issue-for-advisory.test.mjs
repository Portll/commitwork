// Issue id tracking an advisory, by direct key or group membership (monitor/draft-pr-ledger.mjs issueForAdvisory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueForAdvisory } from '../draft-pr-ledger.mjs';

const ADV = { repo: 'acme/api', id: 'GO-2024-0001', package: 'golang.org/x/net' };

function keyFor(adv) {
  let seen;
  const byKey = new Proxy({}, {
    get(_, k) {
      seen = k;
      return undefined;
    },
  });
  issueForAdvisory({ byKey, issues: {} }, adv);
  return seen;
}

function matchEverythingDoc() {
  const groupMembers = [];
  groupMembers.includes = () => true;
  return {
    byKey: new Proxy({}, { get: () => 'I-1' }),
    issues: { 'I-1': { id: 'I-1', groupMembers } },
  };
}

test('an advisory without a repo finds no issue even when every lookup would match', () => {
  assert.equal(issueForAdvisory(matchEverythingDoc(), { id: ADV.id, package: ADV.package }), null);
  assert.equal(issueForAdvisory(matchEverythingDoc(), { ...ADV, repo: '' }), null);
});

test('an advisory without an id finds no issue even when every lookup would match', () => {
  assert.equal(issueForAdvisory(matchEverythingDoc(), { repo: ADV.repo, package: ADV.package }), null);
  assert.equal(issueForAdvisory(matchEverythingDoc(), { ...ADV, id: '' }), null);
});

test('an advisory without a package finds no issue even when every lookup would match', () => {
  assert.equal(issueForAdvisory(matchEverythingDoc(), { repo: ADV.repo, id: ADV.id }), null);
  assert.equal(issueForAdvisory(matchEverythingDoc(), { ...ADV, package: '' }), null);
});

test('a null or undefined advisory finds no issue', () => {
  assert.equal(issueForAdvisory(matchEverythingDoc(), null), null);
  assert.equal(issueForAdvisory(matchEverythingDoc(), undefined), null);
});

test('a key mapped to an existing issue returns the mapped issue id', () => {
  const key = keyFor(ADV);
  const doc = { byKey: { [key]: 'I-7' }, issues: { 'I-7': { id: 'I-7' } } };
  assert.equal(issueForAdvisory(doc, ADV), 'I-7');
});

test('a key mapped to a missing issue returns null when no group holds the key', () => {
  const key = keyFor(ADV);
  const doc = { byKey: { [key]: 'GONE' }, issues: {} };
  assert.equal(issueForAdvisory(doc, ADV), null);
});

test('a key mapped to a missing issue falls through to the group holding the key', () => {
  const key = keyFor(ADV);
  const doc = {
    byKey: { [key]: 'GONE' },
    issues: { G: { id: 'G', groupMembers: [key] } },
  };
  assert.equal(issueForAdvisory(doc, ADV), 'G');
});

test('group search skips issues without a matching member array and returns the id field', () => {
  const key = keyFor(ADV);
  const skipped = {
    none: { id: 'I-2' },
    text: { id: 'I-3', groupMembers: key },
    other: { id: 'I-4', groupMembers: ['other-key'] },
  };
  assert.equal(issueForAdvisory({ issues: skipped }, ADV), null);
  const doc = { issues: { ...skipped, slot: { id: 'I-9', groupMembers: ['other-key', key] } } };
  assert.equal(issueForAdvisory(doc, ADV), 'I-9');
});

test('a direct match wins over a group listed earlier', () => {
  const key = keyFor(ADV);
  const doc = {
    byKey: { [key]: 'I-1' },
    issues: {
      'I-2': { id: 'I-2', groupMembers: [key] },
      'I-1': { id: 'I-1' },
    },
  };
  assert.equal(issueForAdvisory(doc, ADV), 'I-1');
});

test('a document without issues throws when the group search starts', () => {
  assert.throws(() => issueForAdvisory({}, ADV), {
    name: 'TypeError',
    message: 'Cannot convert undefined or null to object',
  });
});
