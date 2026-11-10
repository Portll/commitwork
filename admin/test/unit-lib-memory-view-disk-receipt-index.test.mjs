// Maps each receipt external_id to the list of (receipt, site) pairs that carry it (admin/lib/memory-view.mjs diskReceiptIndex).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diskReceiptIndex } from '../lib/memory-view.mjs';

test('returns an empty Map when survey has no sites', () => {
  const idx = diskReceiptIndex({});
  assert.ok(idx instanceof Map);
  assert.equal(idx.size, 0);
});

test('returns an empty Map when sites is an empty array', () => {
  const idx = diskReceiptIndex({ sites: [] });
  assert.equal(idx.size, 0);
});

test('ignores sites whose payload is missing', () => {
  const idx = diskReceiptIndex({ sites: [{ id: 's1' }] });
  assert.equal(idx.size, 0);
});

test('ignores sites whose payload has no receipts array', () => {
  const idx = diskReceiptIndex({ sites: [{ id: 's1', payload: {} }] });
  assert.equal(idx.size, 0);
});

test('ignores sites whose payload.receipts is not an array', () => {
  const idx = diskReceiptIndex({ sites: [{ id: 's1', payload: { receipts: 'nope' } }] });
  assert.equal(idx.size, 0);
});

test('skips null receipts and receipts without external_id', () => {
  const idx = diskReceiptIndex({
    sites: [{ id: 's1', payload: { receipts: [null, { id: 'x' }, { external_id: '' }] } }]
  });
  assert.equal(idx.size, 0);
});

test('indexes a single receipt under its external_id', () => {
  const r = { external_id: 'abc', value: 1 };
  const s = { id: 'site1', payload: { receipts: [r] } };
  const idx = diskReceiptIndex({ sites: [s] });
  assert.equal(idx.size, 1);
  const list = idx.get('abc');
  assert.equal(list.length, 1);
  assert.equal(list[0].receipt, r);
  assert.equal(list[0].site, s);
});

test('groups multiple receipts sharing the same external_id across sites', () => {
  const r1 = { external_id: 'dup', n: 1 };
  const r2 = { external_id: 'dup', n: 2 };
  const s1 = { id: 'a', payload: { receipts: [r1] } };
  const s2 = { id: 'b', payload: { receipts: [r2] } };
  const idx = diskReceiptIndex({ sites: [s1, s2] });
  assert.equal(idx.size, 1);
  const list = idx.get('dup');
  assert.equal(list.length, 2);
  assert.equal(list[0].receipt, r1);
  assert.equal(list[0].site, s1);
  assert.equal(list[1].receipt, r2);
  assert.equal(list[1].site, s2);
});

test('keeps distinct external_ids in separate map entries', () => {
  const r1 = { external_id: 'one' };
  const r2 = { external_id: 'two' };
  const s = { id: 's', payload: { receipts: [r1, r2] } };
  const idx = diskReceiptIndex({ sites: [s] });
  assert.equal(idx.size, 2);
  assert.equal(idx.get('one').length, 1);
  assert.equal(idx.get('two').length, 1);
  assert.equal(idx.get('one')[0].receipt, r1);
  assert.equal(idx.get('two')[0].receipt, r2);
});
