// Parses pasted renovate dashboard or log text into update entries (admin/lib/renovate-paste.mjs parseRenovatePaste).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRenovatePaste } from '../lib/renovate-paste.mjs';

test('parses a dashboard checkbox line with a link into an entry with prNumber', () => {
  const input = [
    '## Open',
    '- [ ] [chore(deps): update spring (major)](../pull/123)'
  ].join('\n');
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'chore(deps): update spring (major)');
  assert.equal(out[0].state, 'open');
  assert.equal(out[0].prNumber, 123);
  assert.deepEqual(out[0].packages, ['spring']);
  assert.equal(out[0].targetVersion, undefined);
});

test('parses a checkbox line with a target version into packages and targetVersion', () => {
  const input = [
    '## Pending Approval',
    '- [ ] chore(deps): update dependency lodash to 4.17.21'
  ].join('\n');
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'chore(deps): update dependency lodash to 4.17.21');
  assert.equal(out[0].state, 'pending-approval');
  assert.deepEqual(out[0].packages, ['lodash']);
  assert.equal(out[0].targetVersion, '4.17.21');
  assert.equal(out[0].prNumber, undefined);
});

test('parses a bare conventional deps PR title line', () => {
  const input = 'chore(deps): update express to 4.18.2';
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'chore(deps): update express to 4.18.2');
  assert.equal(out[0].state, 'pending');
  assert.deepEqual(out[0].packages, ['express']);
  assert.equal(out[0].targetVersion, '4.18.2');
});

test('parses a quoted log excerpt title', () => {
  const input = 'some log line "prTitle": "chore(deps): update react to 18.2.0" end';
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'chore(deps): update react to 18.2.0');
  assert.equal(out[0].state, 'pending');
  assert.deepEqual(out[0].packages, ['react']);
  assert.equal(out[0].targetVersion, '18.2.0');
});

test('deduplicates entries with the same normalized title', () => {
  const input = [
    'chore(deps): update lodash to 4.17.21',
    'chore(deps): update lodash to 4.17.21'
  ].join('\n');
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
});

test('skips dashboard control rows that are not updates', () => {
  const input = [
    '## Open',
    '- [ ] Create all rate-limited PRs at once'
  ].join('\n');
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 0);
});

test('maps a rate limited section heading to the rate-limited state', () => {
  const input = [
    '## Rate Limited',
    '- [ ] chore(deps): update vue to 3.3.0'
  ].join('\n');
  const out = parseRenovatePaste(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'rate-limited');
});

test('returns an empty array for empty input', () => {
  const out = parseRenovatePaste('');
  assert.deepEqual(out, []);
});
