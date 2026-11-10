// Human-readable one-line summary of a batch of memory-layer receipts (lib/memory-layer-client.mjs summarise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise } from '../memory-layer-client.mjs';

test('reports a single verified receipt with no insert or update', () => {
  assert.equal(summarise([{ state: 'verified' }]), "1 verified, 0 new, 0 updated");
});

test('reports a single accepted-unverified receipt with no insert or update', () => {
  assert.equal(summarise([{ state: 'accepted-unverified' }]), "0 verified, 1 accepted-unverified, 0 new, 0 updated");
});

test('reports a single failed receipt with no insert or update', () => {
  assert.equal(summarise([{ state: 'failed' }]), "0 verified, 1 failed, 0 new, 0 updated");
});

test('reports a single dry-run receipt as not attempted', () => {
  assert.equal(summarise([{ state: 'dry-run' }]), "0 verified, 1 not attempted (dry run), 0 new, 0 updated");
});

test('reports a receipt with an undeclared state as unknown state', () => {
  assert.equal(summarise([{ state: 'weird' }]), "0 verified, 1 carrying a state this client does not declare, 0 new, 0 updated");
});

test('reports a receipt with was_update false as one new record', () => {
  assert.equal(summarise([{ state: 'verified', was_update: false }]), "1 verified, 1 new, 0 updated");
});

test('reports a receipt with was_update true as one updated record', () => {
  assert.equal(summarise([{ state: 'verified', was_update: true }]), "1 verified, 0 new, 1 updated");
});

test('reports a receipt with was_update null as neither new nor updated', () => {
  assert.equal(summarise([{ state: 'verified', was_update: null }]), "1 verified, 0 new, 0 updated");
});

test('reports a truncated receipt with stored form full', () => {
  assert.equal(summarise([{ state: 'verified', truncated: true, storedForm: 'full' }]), "1 verified, 0 new, 0 updated, 1 truncated at source");
});

test('reports a receipt stored as preview only', () => {
  assert.equal(summarise([{ state: 'accepted-unverified', storedForm: 'preview' }]), "0 verified, 1 accepted-unverified, 0 new, 0 updated, 1 STORED AS PREVIEW ONLY (not a durable copy)");
});

test('reports a receipt stored divergent as corruption', () => {
  assert.equal(summarise([{ state: 'accepted-unverified', storedForm: 'divergent' }]), "0 verified, 1 accepted-unverified, 0 new, 0 updated, 1 STORED DIVERGENT (corruption, not truncation)");
});

test('reports a receipt with stored form unknown', () => {
  assert.equal(summarise([{ state: 'verified', storedForm: 'unknown' }]), "1 verified, 0 new, 0 updated, 1 stored form unknown");
});

test('reports a receipt with no stored form as zero stored forms', () => {
  assert.equal(summarise([{ state: 'verified' }]), "1 verified, 0 new, 0 updated");
});

test('reports an empty receipts array as zero verified and zero new updated', () => {
  assert.equal(summarise([]), "0 verified, 0 new, 0 updated");
});

test('reports a mixed batch with all states and stored forms', () => {
  const receipts = [
    { state: 'verified', was_update: false, storedForm: 'full' },
    { state: 'accepted-unverified', was_update: true, storedForm: 'preview' },
    { state: 'failed', truncated: true, storedForm: 'divergent' },
    { state: 'dry-run', storedForm: 'unknown' },
    { state: 'mystery', was_update: null }
  ];
  assert.equal(summarise(receipts), "1 verified, 1 accepted-unverified, 1 failed, 1 not attempted (dry run), 1 carrying a state this client does not declare, 1 new, 1 updated, 1 truncated at source, 1 STORED AS PREVIEW ONLY (not a durable copy), 1 STORED DIVERGENT (corruption, not truncation), 1 stored form unknown");
});

test('reports two verified receipts with one insert and one update', () => {
  const receipts = [
    { state: 'verified', was_update: false },
    { state: 'verified', was_update: true }
  ];
  assert.equal(summarise(receipts), "2 verified, 1 new, 1 updated");
});

test('reports three failed receipts with no other activity', () => {
  const receipts = Array.from({ length: 3 }, () => ({ state: 'failed' }));
  assert.equal(summarise(receipts), "0 verified, 3 failed, 0 new, 0 updated");
});

test('reports two dry-run receipts as not attempted', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'dry-run' }));
  assert.equal(summarise(receipts), "0 verified, 2 not attempted (dry run), 0 new, 0 updated");
});

test('reports two receipts with undeclared states', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'unknown-state' }));
  assert.equal(summarise(receipts), "0 verified, 2 carrying a state this client does not declare, 0 new, 0 updated");
});

test('reports two truncated receipts with stored form full', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'verified', truncated: true, storedForm: 'full' }));
  assert.equal(summarise(receipts), "2 verified, 0 new, 0 updated, 2 truncated at source");
});

test('reports two receipts stored as preview only', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'accepted-unverified', storedForm: 'preview' }));
  assert.equal(summarise(receipts), "0 verified, 2 accepted-unverified, 0 new, 0 updated, 2 STORED AS PREVIEW ONLY (not a durable copy)");
});

test('reports two receipts stored divergent', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'accepted-unverified', storedForm: 'divergent' }));
  assert.equal(summarise(receipts), "0 verified, 2 accepted-unverified, 0 new, 0 updated, 2 STORED DIVERGENT (corruption, not truncation)");
});

test('reports two receipts with stored form unknown', () => {
  const receipts = Array.from({ length: 2 }, () => ({ state: 'verified', storedForm: 'unknown' }));
  assert.equal(summarise(receipts), "2 verified, 0 new, 0 updated, 2 stored form unknown");
});
