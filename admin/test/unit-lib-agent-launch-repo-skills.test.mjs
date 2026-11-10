// Filters skills whose name or description contains any repo term (admin/lib/agent-launch.mjs repoSkills).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoSkills } from '../lib/agent-launch.mjs';

test('returns empty array when skills is null', () => {
  assert.deepEqual(repoSkills(null), []);
});

test('returns empty array when skills is undefined', () => {
  assert.deepEqual(repoSkills(undefined), []);
});

test('returns empty array when skills is empty array', () => {
  assert.deepEqual(repoSkills([]), []);
});

test('matches skill with repo in name', () => {
  const skills = [{ name: 'repo-scan', description: 'scans repos' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'repo-scan');
});

test('matches skill with commit in description', () => {
  const skills = [{ name: 'mytool', description: 'handles commit messages' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'mytool');
});

test('does not match skill with no repo terms', () => {
  const skills = [{ name: 'weather', description: 'forecasts rain' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 0);
});

test('matches skill with diff in name case-insensitively', () => {
  const skills = [{ name: 'Diff Checker', description: '' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Diff Checker');
});

test('matches skill with test in description', () => {
  const skills = [{ name: 'runner', description: 'runs unit test suites' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'runner');
});

test('does not match skill with partial term that is not a full word', () => {
  const skills = [{ name: 'repository', description: 'stores data' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'repository');
});

test('handles skill with no description field', () => {
  const skills = [{ name: 'audit tool' }];
  const result = repoSkills(skills);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'audit tool');
});
