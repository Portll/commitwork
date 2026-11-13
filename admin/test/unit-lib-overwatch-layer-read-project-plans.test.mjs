// Redacts plan names and task details unless full is true (admin/lib/overwatch-layer-read.mjs projectPlans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPlans } from '../lib/overwatch-layer-read.mjs';

test('full true returns plans unchanged', () => {
  const input = [{ name: 'secret', tasks: [{ goal: 'g', result: 'r', notes: 'n', abandon_reason: 'ar', state: 's', id: 1 }] }];
  const result = projectPlans(input, { full: true });
  assert.deepEqual(result, [{ name: 'secret', tasks: [{ goal: 'g', result: 'r', notes: 'n', abandon_reason: 'ar', state: 's', id: 1 }] }]);
});

test('full false with null plans returns empty array', () => {
  const result = projectPlans(null, { full: false });
  assert.deepEqual(result, []);
});

test('full false with empty plans returns empty array', () => {
  const result = projectPlans([], { full: false });
  assert.deepEqual(result, []);
});

test('full false with non-string name keeps name and maps tasks with redacted true', () => {
  const input = [{ name: 123, tasks: [{ goal: 'g', result: 'r', notes: 'n', abandon_reason: 'ar', state: 's', id: 1 }] }];
  const result = projectPlans(input, { full: false });
  assert.deepEqual(result, [{ name: 123, tasks: [{ id: 1, redacted: true }] }]);
});

test('full false with string name throws due to missing redaction map', () => {
  assert.throws(
    () => projectPlans([{ name: 'secret', tasks: [] }], { full: false }),
    (err) => err instanceof Error && err.message.includes('publish-redactions: map is ABSENT') && err.message.includes('refusing to publish')
  );
});

test('full false with non-string name and tasks present maps tasks and adds redacted true', () => {
  const input = [{ name: 456, tasks: [{ id: 2, goal: 'g' }] }];
  const result = projectPlans(input, { full: false });
  assert.deepEqual(result, [{ name: 456, tasks: [{ id: 2, redacted: true }] }]);
});

test('full false with tasks null becomes empty array', () => {
  const input = [{ name: 789, tasks: null }];
  const result = projectPlans(input, { full: false });
  assert.deepEqual(result, [{ name: 789, tasks: [] }]);
});

test('full false with non-empty plans array maps each plan', () => {
  const input = [{ name: 111, tasks: [] }];
  const result = projectPlans(input, { full: false });
  assert.deepEqual(result, [{ name: 111, tasks: [] }]);
});
