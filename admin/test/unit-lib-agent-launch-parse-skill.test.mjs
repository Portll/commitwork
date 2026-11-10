// Parses YAML front-matter name and description from a skill text (admin/lib/agent-launch.mjs parseSkill).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkill } from '../lib/agent-launch.mjs';

test('returns null when text does not start with ---', () => {
  assert.equal(parseSkill('hello'), null);
});

test('returns null when no closing --- is found', () => {
  assert.equal(parseSkill('---\nname: a'), null);
});

test('returns null when name field is missing', () => {
  assert.equal(parseSkill('---\ndescription: d\n---\nbody'), null);
});

test('returns object with name and description from plain scalars', () => {
  const text = '---\nname: my-skill\ndescription: does things\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: 'my-skill', description: 'does things' });
});

test('returns null description when description field is absent', () => {
  const text = '---\nname: solo\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: 'solo', description: null });
});

test('unescapes doubled single quotes in single-quoted scalar', () => {
  const text = "---\nname: 'it''s'\ndescription: 'a''b'\n---\nbody";
  assert.deepEqual(parseSkill(text), { name: "it's", description: "a'b" });
});

test('strips double quotes from double-quoted scalar', () => {
  const text = '---\nname: "quoted"\ndescription: "desc"\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: 'quoted', description: 'desc' });
});

test('returns null for empty string input', () => {
  assert.equal(parseSkill(''), null);
});

test('returns null for null input', () => {
  assert.equal(parseSkill(null), null);
});

test('returns null for undefined input', () => {
  assert.equal(parseSkill(undefined), null);
});

test('returns null when closing --- is at index 3', () => {
  const text = '---\n---\nname: a';
  assert.equal(parseSkill(text), null);
});

test('returns null when closing --- is at index 4', () => {
  const text = '---\n\n---\nname: a';
  assert.equal(parseSkill(text), null);
});

test('returns null for single-quoted scalar of length 2', () => {
  const text = "---\nname: ''\n---\nbody";
  assert.equal(parseSkill(text), null);
});

test('returns null for double-quoted scalar of length 2', () => {
  const text = '---\nname: ""\n---\nbody';
  assert.equal(parseSkill(text), null);
});

test('returns object with single quote for single-quoted scalar of length 3', () => {
  const text = "---\nname: '''\n---\nbody";
  assert.deepEqual(parseSkill(text), { name: "'", description: null });
});

test('returns object with double quote for double-quoted scalar of length 3', () => {
  const text = '---\nname: """\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: '"', description: null });
});

test('returns object for single-quoted scalar of length 4', () => {
  const text = "---\nname: 'a'\n---\nbody";
  assert.deepEqual(parseSkill(text), { name: 'a', description: null });
});

test('returns object for double-quoted scalar of length 4', () => {
  const text = '---\nname: "a"\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: 'a', description: null });
});

test('returns object with single quote prefix for unbalanced single quote', () => {
  const text = "---\nname: 'a\n---\nbody";
  assert.deepEqual(parseSkill(text), { name: "'a", description: null });
});

test('returns object with double quote prefix for unbalanced double quote', () => {
  const text = '---\nname: "a\n---\nbody';
  assert.deepEqual(parseSkill(text), { name: '"a', description: null });
});
