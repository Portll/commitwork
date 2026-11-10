// Maps a scan result to a process exit code (monitor/transcript-secrets.mjs exitCodeFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitCodeFor } from '../transcript-secrets.mjs';

test('returns failed when failures is positive', () => {
  const r = { summary: { failures: 1, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 2);
});

test('returns failed when scanned is zero', () => {
  const r = { summary: { failures: 0, scanned: 0, secrets: 0 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 2);
});

test('returns failed when secondWitness state is failed', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 0 }, secondWitness: { state: 'failed', findings: 0 } };
  assert.equal(exitCodeFor(r), 2);
});

test('returns failed when failures is zero and scanned is positive and state is ok', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 0);
});

test('returns failed when failures is one and scanned is positive and state is ok', () => {
  const r = { summary: { failures: 1, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 2);
});

test('returns secrets when secrets is positive and failures is zero', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 1 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 21);
});

test('returns secrets when secondWitness findings is positive and secrets is zero', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok', findings: 1 } };
  assert.equal(exitCodeFor(r), 21);
});

test('returns clean when all counts are zero and state is ok', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 0);
});

test('returns clean when secondWitness findings is undefined and secrets is zero', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 0 }, secondWitness: { state: 'ok' } };
  assert.equal(exitCodeFor(r), 0);
});

test('returns secrets when secrets is one and failures is zero and scanned is positive', () => {
  const r = { summary: { failures: 0, scanned: 1, secrets: 1 }, secondWitness: { state: 'ok', findings: 0 } };
  assert.equal(exitCodeFor(r), 21);
});
