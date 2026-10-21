// Maps a solved finding and its owner to a single disposition verdict (monitor/nuclei-solve.mjs disposition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disposition } from '../nuclei-solve.mjs';

test('returns in-scope-refuted when confirmation is refuted regardless of owner', () => {
  const solved = { confirmation: 'refuted' };
  const owner = { owner: 'host' };
  assert.equal(disposition(solved, owner), 'in-scope-refuted');
});

test('returns host-attributed when owner is host and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = { owner: 'host' };
  assert.equal(disposition(solved, owner), 'host-attributed');
});

test('returns host-attributed when owner is host and confirmation is undetermined', () => {
  const solved = { confirmation: 'undetermined' };
  const owner = { owner: 'host' };
  assert.equal(disposition(solved, owner), 'host-attributed');
});

test('returns in-scope-refuted when owner is unbound-observed and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = { owner: 'unbound-observed' };
  assert.equal(disposition(solved, owner), 'in-scope-refuted');
});

test('returns in-scope-refuted when owner is unbound-observed and confirmation is undetermined', () => {
  const solved = { confirmation: 'undetermined' };
  const owner = { owner: 'unbound-observed' };
  assert.equal(disposition(solved, owner), 'in-scope-refuted');
});

test('returns in-scope-confirmed when owner is project and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = { owner: 'project' };
  assert.equal(disposition(solved, owner), 'in-scope-confirmed');
});

test('returns undetermined when owner is project and confirmation is undetermined', () => {
  const solved = { confirmation: 'undetermined' };
  const owner = { owner: 'project' };
  assert.equal(disposition(solved, owner), 'undetermined');
});

test('returns in-scope-confirmed when owner is unknown and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = { owner: 'unknown' };
  assert.equal(disposition(solved, owner), 'in-scope-confirmed');
});

test('returns in-scope-confirmed when owner is unbound-unverifiable and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = { owner: 'unbound-unverifiable' };
  assert.equal(disposition(solved, owner), 'in-scope-confirmed');
});

test('returns in-scope-confirmed when owner is null and confirmation is confirmed', () => {
  const solved = { confirmation: 'confirmed' };
  const owner = null;
  assert.equal(disposition(solved, owner), 'in-scope-confirmed');
});
