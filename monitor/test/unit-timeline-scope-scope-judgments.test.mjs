// Rows and programs a scope keeps, plus how many it hides (monitor/timeline-scope.mjs scopeJudgments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeJudgments } from '../timeline-scope.mjs';

const projectOf = (repo) => (repo === 'a' ? 'in' : 'out');
const scopeOf = (isPrimary) => ({ inScope: (p) => p === 'in', isPrimary });

test('A wildcard repo row is kept even when its project is out of scope', () => {
  const rows = [{ repo: '*', store: 'other', project: 'out' }];
  const programs = [];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [rows[0]], programs: [], hidden: { triage: 0, programs: 0 } });
});

test('A repo row is dropped when its repo maps to an out of scope project', () => {
  const rows = [{ repo: 'b', store: 'other', project: 'in' }];
  const programs = [];
  const scope = scopeOf(true);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [], programs: [], hidden: { triage: 1, programs: 0 } });
});

test('A repo row is kept when its repo maps to an in scope project regardless of its own project', () => {
  const rows = [{ repo: 'a', store: 'other', project: 'out' }];
  const programs = [];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [rows[0]], programs: [], hidden: { triage: 0, programs: 0 } });
});

test('An image acceptance row is judged by its own project rather than its repo', () => {
  const rows = [{ repo: 'b', store: 'image-acceptance', project: 'in' }];
  const programs = [];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [rows[0]], programs: [], hidden: { triage: 0, programs: 0 } });
});

test('An image acceptance row without a project is kept when the scope is primary', () => {
  const rows = [{ repo: 'b', store: 'image-acceptance' }];
  const programs = [];
  const scope = scopeOf(true);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [rows[0]], programs: [], hidden: { triage: 0, programs: 0 } });
});

test('A row with an empty repo is judged by its own project', () => {
  const rows = [{ repo: '', store: 'other', project: 'in' }];
  const programs = [];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [rows[0]], programs: [], hidden: { triage: 0, programs: 0 } });
});

test('A row with no repo and no project is dropped when the scope is not primary', () => {
  const rows = [{ store: 'other' }];
  const programs = [];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, { rows: [], programs: [], hidden: { triage: 1, programs: 0 } });
});

test('Programs are kept by project scope and projectless programs follow the primary flag', () => {
  const rows = [];
  const programs = [{ project: 'in' }, { project: 'out' }, {}];
  const scope = scopeOf(true);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, {
    rows: [],
    programs: [programs[0], programs[2]],
    hidden: { triage: 0, programs: 1 },
  });
});

test('Hidden counts are the number of rows and programs filtered out', () => {
  const rows = [
    { repo: '*', store: 'other' },
    { repo: 'a', store: 'other' },
    { repo: 'b', store: 'other' },
    { repo: '', store: 'other', project: 'out' },
  ];
  const programs = [{ project: 'in' }, { project: 'out' }];
  const scope = scopeOf(false);
  const result = scopeJudgments({ rows, programs }, scope, projectOf);
  assert.deepEqual(result, {
    rows: [rows[0], rows[1]],
    programs: [programs[0]],
    hidden: { triage: 2, programs: 1 },
  });
});
