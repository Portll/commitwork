// admin/lib/renovate-paste.mjs — the paste parser, tested directly.
//
// It lived inline in admin/serve.mjs until 2026-09-04, where reaching it meant booting an HTTP
// server and POSTing a body. These are the same three input shapes its own comment documents,
// asserted against the function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRenovatePaste, renovateState } from '../lib/renovate-paste.mjs';

test('a dashboard checkbox row becomes an entry, carrying its section as state', () => {
  const out = parseRenovatePaste([
    '## Rate-Limited',
    '- [ ] chore(deps): update dependency lodash to 4.17.21',
  ].join('\n'));
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'rate-limited');
  assert.deepEqual(out[0].packages, ['lodash']);
  assert.equal(out[0].targetVersion, '4.17.21');
});

test('the Open section link form yields the title and its PR number', () => {
  const out = parseRenovatePaste([
    '## Open',
    '- [ ] [chore(deps): update dependency axios to 1.7.2](../pull/412)',
  ].join('\n'));
  assert.equal(out.length, 1);
  assert.equal(out[0].prNumber, 412);
  assert.equal(out[0].state, 'open');
  assert.ok(!out[0].title.includes('](' ), `title kept its markdown link: ${out[0].title}`);
});

test('a bare conventional-commit title parses with no dashboard around it', () => {
  const out = parseRenovatePaste('chore(deps): update dependency express to 4.19.2');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].packages, ['express']);
  // No section heading was seen, so the state falls back rather than being invented.
  assert.equal(out[0].state, 'pending');
});

test('a quoted title inside a log excerpt is found', () => {
  const out = parseRenovatePaste('DEBUG: {"prTitle": "chore(deps): update dependency vite to 5.4.0"}');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].packages, ['vite']);
});

test('a grouped update records the package but claims NO target version', () => {
  const out = parseRenovatePaste('- [ ] chore(deps): update spring (major)');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].packages, ['spring']);
  // The whole point: a grouped row has no single version, so inventing one would be a fabricated
  // fact about what the update does.
  assert.equal(out[0].targetVersion, undefined);
});

test('dashboard CONTROL rows are not updates', () => {
  const out = parseRenovatePaste([
    '## Rate-Limited',
    '- [ ] Create all rate-limited PRs at once 🚀',
    '- [ ] Click on this checkbox to rebase all open PRs at once',
  ].join('\n'));
  assert.deepEqual(out, [], 'a control checkbox is an instruction to Renovate, never a pending update');
});

test('the same update pasted twice is one entry — dedupe is on the normalized title', () => {
  const out = parseRenovatePaste([
    '- [ ] chore(deps): update dependency lodash to 4.17.21',
    '- [x] chore(deps):  Update   Dependency  Lodash  to 4.17.21',
  ].join('\n'));
  assert.equal(out.length, 1);
});

test('renovateState maps the known headings and slugs an unknown one rather than dropping it', () => {
  assert.equal(renovateState('Rate-Limited'), 'rate-limited');
  assert.equal(renovateState('Awaiting Schedule'), 'awaiting-schedule');
  assert.equal(renovateState('Pending Approval'), 'pending-approval');
  assert.equal(renovateState('Open'), 'open');
  assert.equal(renovateState('Errored'), 'errored');
  assert.equal(renovateState(''), '');
  // An unrecognised heading is still carried, slugged — losing it would silently discard the only
  // record of which section a row came from.
  assert.equal(renovateState('Some Future Section!'), 'some-future-section');
});

test('empty and junk input produce no entries, never a thrown parse', () => {
  assert.deepEqual(parseRenovatePaste(''), []);
  assert.deepEqual(parseRenovatePaste('just some prose with no updates in it'), []);
});
