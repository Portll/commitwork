// The working-copy text to write back after a version stamp (bin/version-stamp.mjs workingCopyText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingCopyText } from '../version-stamp.mjs';

const pkg = (name, version) => `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`;

test('a null worktree gives null even when indexText is also null', () => {
  const r = workingCopyText({ worktree: null, indexText: null, stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});

test('an omitted worktree gives null', () => {
  const r = workingCopyText({ indexText: pkg('a', '1.0.0'), stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});

test('a worktree identical to the index text returns the stamped text unchanged', () => {
  const t = pkg('a', '1.0.0');
  const r = workingCopyText({ worktree: t, indexText: t, stamped: 'STAMPED', version: '2.0.0' });
  assert.equal(r, 'STAMPED');
});

test('identical empty worktree and index texts return the stamped text', () => {
  const r = workingCopyText({ worktree: '', indexText: '', stamped: 'STAMPED', version: '2.0.0' });
  assert.equal(r, 'STAMPED');
});

test('a differing worktree with the same version as the index gets the new version written in', () => {
  const r = workingCopyText({ worktree: pkg('local', '1.0.0'), indexText: pkg('a', '1.0.0'), stamped: 'S', version: '2.0.0' });
  assert.equal(r, pkg('local', '2.0.0'));
});

test('only the first version field of the worktree is replaced', () => {
  const worktree = '{"version": "1.0.0", "x": {"version": "9.9.9"}}';
  const r = workingCopyText({ worktree, indexText: '{"version" : "1.0.0"}', stamped: 'S', version: '3.1.4' });
  assert.equal(r, '{"version": "3.1.4", "x": {"version": "9.9.9"}}');
});

test('a worktree whose version differs from the index by one patch gives null', () => {
  const r = workingCopyText({ worktree: pkg('local', '1.0.1'), indexText: pkg('a', '1.0.0'), stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});

test('a worktree without a version field gives null', () => {
  const r = workingCopyText({ worktree: '{\n  "name": "local"\n}\n', indexText: pkg('a', '1.0.0'), stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});

test('a versioned worktree with a missing index text gives null', () => {
  const r = workingCopyText({ worktree: pkg('local', '1.0.0'), stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});

test('a versioned worktree with an index text lacking a version field gives null', () => {
  const r = workingCopyText({ worktree: pkg('local', '1.0.0'), indexText: '{"name": "a"}', stamped: 'S', version: '2.0.0' });
  assert.equal(r, null);
});
