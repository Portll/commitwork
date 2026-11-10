// Reads and parses skill directories into a sorted list of skills and unreadable entries (admin/lib/agent-launch.mjs readSkills).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSkills } from '../lib/agent-launch.mjs';

test('returns absent true and empty lists when readDir throws ENOENT', () => {
  const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
  const result = readSkills({ dir: '/missing', readDir: () => { throw err; } });
  assert.deepEqual(result, { ok: true, absent: true, skills: [], unreadable: [] });
});

test('returns ok false with why when readDir throws non-ENOENT error', () => {
  const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const result = readSkills({ dir: '/locked', readDir: () => { throw err; } });
  assert.deepEqual(result, { ok: false, why: '/locked: EACCES', skills: [], unreadable: [] });
});

test('returns ok false with string reason when readDir throws error without code', () => {
  const err = new Error('boom');
  const result = readSkills({ dir: '/x', readDir: () => { throw err; } });
  assert.deepEqual(result, { ok: false, why: "/x: Error: boom", skills: [], unreadable: [] });
});

test('skips dot-prefixed entries and non-directory non-symlink entries', () => {
  const entries = [
    { name: '.hidden', isDirectory: () => true, isSymbolicLink: () => false },
    { name: 'file.txt', isDirectory: () => false, isSymbolicLink: () => false },
    { name: 'real', isDirectory: () => true, isSymbolicLink: () => false },
  ];
  const result = readSkills({
    dir: '/d',
    readDir: () => entries,
    readFile: () => { throw Object.assign(new Error('no file'), { code: 'ENOENT' }); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.absent, false);
  assert.equal(result.skills.length, 0);
  assert.equal(result.unreadable.length, 1);
  assert.equal(result.unreadable[0].name, 'real');
  assert.equal(result.unreadable[0].why, 'no SKILL.md');
});

test('parses valid frontmatter into skills and sorts by name', () => {
  const entries = [
    { name: 'zeta', isDirectory: () => true, isSymbolicLink: () => false },
    { name: 'alpha', isDirectory: () => true, isSymbolicLink: () => false },
  ];
  const files = {
    '/d/zeta/SKILL.md': '---\nname: zeta\ndescription: z desc\n---\nbody',
    '/d/alpha/SKILL.md': '---\nname: alpha\ndescription: a desc\n---\nbody',
  };
  const result = readSkills({
    dir: '/d',
    readDir: () => entries,
    readFile: (p) => files[p],
  });
  assert.equal(result.ok, true);
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[0].name, 'alpha');
  assert.equal(result.skills[0].description, 'a desc');
  assert.equal(result.skills[1].name, 'zeta');
  assert.equal(result.skills[1].description, 'z desc');
  assert.equal(result.unreadable.length, 0);
});

test('marks entry unreadable when SKILL.md has no parseable frontmatter', () => {
  const entries = [{ name: 'bad', isDirectory: () => true, isSymbolicLink: () => false }];
  const result = readSkills({
    dir: '/d',
    readDir: () => entries,
    readFile: () => 'no frontmatter here',
  });
  assert.equal(result.skills.length, 0);
  assert.equal(result.unreadable.length, 1);
  assert.equal(result.unreadable[0].name, 'bad');
  assert.equal(result.unreadable[0].why, 'no parseable frontmatter');
});

test('marks entry unreadable with error code when readFile throws non-ENOENT', () => {
  const entries = [{ name: 'locked', isDirectory: () => true, isSymbolicLink: () => false }];
  const err = Object.assign(new Error('denied'), { code: 'EACCES' });
  const result = readSkills({
    dir: '/d',
    readDir: () => entries,
    readFile: () => { throw err; },
  });
  assert.equal(result.skills.length, 0);
  assert.equal(result.unreadable.length, 1);
  assert.equal(result.unreadable[0].name, 'locked');
  assert.equal(result.unreadable[0].why, 'EACCES');
});

test('handles symlink entries and single-quoted YAML with escaped quotes', () => {
  const entries = [{ name: 'link', isDirectory: () => false, isSymbolicLink: () => true }];
  const text = "---\nname: 'it''s'\ndescription: \"d\"\n---\nbody";
  const result = readSkills({
    dir: '/d',
    readDir: () => entries,
    readFile: () => text,
  });
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "it's");
  assert.equal(result.skills[0].description, 'd');
  assert.equal(result.unreadable.length, 0);
});
