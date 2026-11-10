// renders a multi-line status string from an upsert result (bin/memory-upsert.mjs render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../memory-upsert.mjs';

test('renders minimal result without id or reason', () => {
  const r = render({ state: 'ok', external_id: 'ext1', contentSha256: 'a', storedSha256: 'b', storedForm: 'json' });
  assert.equal(r, "state ok\nexternal_id ext1\nsha256 sent a  stored b  form json\n");
});

test('renders result with id, version, was_update, and reason', () => {
  const r = render({ state: 'ok', external_id: 'ext2', id: 42, version: 3, was_update: true, contentSha256: 'c', storedSha256: 'd', storedForm: 'text', reason: 'conflict' });
  assert.equal(r, "state ok\nexternal_id ext2\nid 42  version 3  was_update true\nsha256 sent c  stored d  form text\nreason: conflict\n");
});

test('renders result with falsy id and no reason', () => {
  const r = render({ state: 'err', external_id: 'ext3', id: 0, version: 1, was_update: false, contentSha256: 'e', storedSha256: 'f', storedForm: 'raw' });
  assert.equal(r, "state err\nexternal_id ext3\nsha256 sent e  stored f  form raw\n");
});

test('renders result with null sha256 fields and reason', () => {
  const r = render({ state: 'ok', external_id: 'ext4', id: 7, version: 2, was_update: true, contentSha256: null, storedSha256: null, storedForm: 'bin', reason: 'timeout' });
  assert.equal(r, "state ok\nexternal_id ext4\nid 7  version 2  was_update true\nsha256 sent -  stored -  form bin\nreason: timeout\n");
});

test('renders result with undefined sha256 fields and no reason', () => {
  const r = render({ state: 'ok', external_id: 'ext5', id: 9, version: 5, was_update: false, storedForm: 'json' });
  assert.equal(r, "state ok\nexternal_id ext5\nid 9  version 5  was_update false\nsha256 sent -  stored -  form json\n");
});

test('renders result with empty string reason', () => {
  const r = render({ state: 'ok', external_id: 'ext6', id: 1, version: 1, was_update: true, contentSha256: 'x', storedSha256: 'y', storedForm: 'txt', reason: '' });
  assert.equal(r, "state ok\nexternal_id ext6\nid 1  version 1  was_update true\nsha256 sent x  stored y  form txt\n");
});

test('renders result with was_update false and id present', () => {
  const r = render({ state: 'ok', external_id: 'ext7', id: 100, version: 1, was_update: false, contentSha256: 'z', storedSha256: 'w', storedForm: 'json' });
  assert.equal(r, "state ok\nexternal_id ext7\nid 100  version 1  was_update false\nsha256 sent z  stored w  form json\n");
});

test('renders result with long repeated external_id', () => {
  const r = render({ state: 'ok', external_id: 'x'.repeat(50), id: 1, version: 1, was_update: true, contentSha256: 'a', storedSha256: 'b', storedForm: 'json' });
  assert.equal(r, "state ok\nexternal_id xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\nid 1  version 1  was_update true\nsha256 sent a  stored b  form json\n");
});
