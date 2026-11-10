// Computes the agent launch options: presets, skills, repo-filtered skills, and skills state (admin/lib/agent-launch.mjs launchOptions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchOptions } from '../lib/agent-launch.mjs';

test('returns preset metadata with id, label, blurb, needs, writes for all four presets', () => {
  const out = launchOptions({ dir: '/nonexistent', readDir: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); } });
  assert.equal(out.presets.length, 4);
  assert.deepEqual(out.presets[0], { id: 'remediate', label: 'Remediate a finding', blurb: 'Takes a plan task or a finding and produces a fix plan, with the blast radius named.', needs: 'task', writes: false });
  assert.deepEqual(out.presets[1], { id: 'status', label: 'Session and fleet status report', blurb: 'What ran, what landed, what is red, and what was never measured.', needs: null, writes: false });
  assert.deepEqual(out.presets[2], { id: 'audit', label: 'Audit a repo, surfacing decisions', blurb: 'Points an agent at one project and returns findings plus the choices they force.', needs: 'project', writes: false });
  assert.deepEqual(out.presets[3], { id: 'explain', label: 'Explain this view', blurb: 'Reads the current Overwatch state back in plain language, and names what needs deciding.', needs: null, writes: false });
});

test('marks skillsState absent when the skills directory does not exist', () => {
  const out = launchOptions({ dir: '/nope', readDir: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); } });
  assert.equal(out.skillsState, 'absent');
  assert.equal(out.skillsWhy, null);
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, []);
});

test('marks skillsState unreadable and surfaces why when readDir throws a non-ENOENT error', () => {
  const out = launchOptions({ dir: '/locked', readDir: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  assert.equal(out.skillsState, 'unreadable');
  assert.equal(out.skillsWhy, '/locked: EACCES');
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, []);
});

test('returns live skillsState with parsed skills and empty unreadable when directory is empty', () => {
  const out = launchOptions({ dir: '/empty', readDir: () => [] });
  assert.equal(out.skillsState, 'live');
  assert.equal(out.skillsWhy, null);
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, []);
});

test('lists a skill whose SKILL.md has parseable frontmatter in skills and repoSkills when description matches a term', () => {
  const out = launchOptions({
    dir: '/s',
    readDir: () => [{ name: 'code-audit', isDirectory: () => true, isSymbolicLink: () => false }],
    readFile: () => '---\nname: code-audit\ndescription: a security scanner for repos\n---\nbody',
  });
  assert.equal(out.skillsState, 'live');
  assert.deepEqual(out.skills, [{ name: 'code-audit', description: 'a security scanner for repos' }]);
  assert.deepEqual(out.repoSkills, ['code-audit']);
  assert.deepEqual(out.unreadableSkills, []);
});

test('lists a skill in unreadableSkills when its SKILL.md lacks parseable frontmatter', () => {
  const out = launchOptions({
    dir: '/s',
    readDir: () => [{ name: 'broken', isDirectory: () => true, isSymbolicLink: () => false }],
    readFile: () => 'no frontmatter here',
  });
  assert.equal(out.skillsState, 'live');
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, [{ name: 'broken', why: 'no parseable frontmatter' }]);
});

test('lists a skill in unreadableSkills with ENOENT reason when SKILL.md is missing', () => {
  const out = launchOptions({
    dir: '/s',
    readDir: () => [{ name: 'ghost', isDirectory: () => true, isSymbolicLink: () => false }],
    readFile: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); },
  });
  assert.equal(out.skillsState, 'live');
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, [{ name: 'ghost', why: 'no SKILL.md' }]);
});

test('lists a skill in unreadableSkills with the error code when readFile throws a non-ENOENT error', () => {
  const out = launchOptions({
    dir: '/s',
    readDir: () => [{ name: 'locked', isDirectory: () => true, isSymbolicLink: () => false }],
    readFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
  });
  assert.equal(out.skillsState, 'live');
  assert.deepEqual(out.skills, []);
  assert.deepEqual(out.repoSkills, []);
  assert.deepEqual(out.unreadableSkills, [{ name: 'locked', why: 'EACCES' }]);
});

test('includes a symlinked skill directory in the scan and parses its SKILL.md', () => {
  const out = launchOptions({
    dir: '/s',
    readDir: () => [{ name: 'linked', isDirectory: () => false, isSymbolicLink: () => true }],
    readFile: () => '---\nname: linked\ndescription: a diff review tool\n---\nbody',
  });
  assert.equal(out.skillsState, 'live');
  assert.deepEqual(out.skills, [{ name: 'linked', description: 'a diff review tool' }]);
  assert.deepEqual(out.repoSkills, ['linked']);
  assert.deepEqual(out.unreadableSkills, []);
});

test('exposes repoFilter with kind keyword, the frozen terms, and the caveat string', () => {
  const out = launchOptions({ dir: '/nope', readDir: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); } });
  assert.equal(out.repoFilter.kind, 'keyword');
  assert.deepEqual(out.repoFilter.terms, ['repo', 'repositor', 'codebase', 'code review', 'diff', 'commit', 'audit', 'scanner', 'security', 'test']);
  assert.equal(out.repoFilter.caveat, 'matched against each skill\u2019s own description, not a measured fitness');
});
