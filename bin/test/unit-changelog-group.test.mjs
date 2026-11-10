// Groups commits into changelog sections by type and breaking status (bin/changelog.mjs group).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { group } from '../changelog.mjs';

test('returns empty array for no commits', () => {
  assert.deepEqual(group([]), []);
});

test('groups breaking changes with type prefix', () => {
  const commits = [{ sha: 'a1b2c3d4e5f6', message: 'feat: add feature' }];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, "Features");
  assert.equal(result[0].lines.length, 1);
  assert.equal(result[0].lines[0], "- add feature (`a1b2c3d4`)");
});

test('groups non-breaking feat under Features without type prefix', () => {
  const commits = [{ sha: 'a1b2c3d4e5f6', message: 'feat: add feature' }];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Features');
  assert.equal(result[0].lines.length, 1);
  assert.equal(result[0].lines[0], '- add feature (`a1b2c3d4`)');
});

test('groups fix under Fixes', () => {
  const commits = [{ sha: 'a1b2c3d4e5f6', message: 'fix: correct bug' }];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Fixes');
  assert.equal(result[0].lines.length, 1);
  assert.equal(result[0].lines[0], '- correct bug (`a1b2c3d4`)');
});

test('groups unknown type under Other section', () => {
  const commits = [{ sha: 'a1b2c3d4e5f6', message: 'wip: work in progress' }];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Other: wip');
  assert.equal(result[0].lines.length, 1);
  assert.equal(result[0].lines[0], '- work in progress (`a1b2c3d4`)');
});

test('groups non-conventional message under Not conventional', () => {
  const commits = [{ sha: 'a1b2c3d4e5f6', message: 'random text' }];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Not conventional');
  assert.equal(result[0].lines.length, 1);
  assert.equal(result[0].lines[0], '- random text (`a1b2c3d4`)');
});

test('sorts entries by scope then description then sha', () => {
  const commits = [
    { sha: 'c3d4e5f6a7b8', message: 'feat(zeta): last' },
    { sha: 'a1b2c3d4e5f6', message: 'feat(alpha): first' },
    { sha: 'b2c3d4e5f6a7', message: 'feat(alpha): second' },
  ];
  const result = group(commits);
  assert.equal(result.length, 1);
  assert.equal(result[0].heading, 'Features');
  assert.equal(result[0].lines.length, 3);
  assert.equal(result[0].lines[0], '- **alpha:** first (`a1b2c3d4`)');
  assert.equal(result[0].lines[1], '- **alpha:** second (`b2c3d4e5`)');
  assert.equal(result[0].lines[2], '- **zeta:** last (`c3d4e5f6`)');
});

test('omits empty sections', () => {
  const commits = [
    { sha: 'a1b2c3d4e5f6', message: 'feat: add feature' },
    { sha: 'b2c3d4e5f6a7', message: 'fix: correct bug' },
  ];
  const result = group(commits);
  assert.equal(result.length, 2);
  assert.equal(result[0].heading, 'Features');
  assert.equal(result[1].heading, 'Fixes');
});
