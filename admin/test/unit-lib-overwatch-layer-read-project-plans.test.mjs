// Redacts plan names and task details unless full is true (admin/lib/overwatch-layer-read.mjs projectPlans).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPlans } from '../lib/overwatch-layer-read.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function withRedactionMap(doc, fn) {
  const saved = process.env.CW_PUBLISH_REDACTIONS;
  const dir = mkdtempSync(join(tmpdir(), 'cw-redactions-'));
  const path = join(dir, 'publish-redactions.json');
  if (doc !== null) writeFileSync(path, JSON.stringify(doc));
  process.env.CW_PUBLISH_REDACTIONS = path;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CW_PUBLISH_REDACTIONS;
    else process.env.CW_PUBLISH_REDACTIONS = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('full false with string name throws when the redaction map is absent', () => {
  withRedactionMap(null, () => assert.throws(
    () => projectPlans([{ name: 'secret', tasks: [] }], { full: false }),
    (err) => err instanceof Error && err.message.includes('publish-redactions: map is ABSENT') && err.message.includes('refusing to publish')
  ));
});

test('full false with string name redacts it through the map, case-insensitively', () => {
  const map = { note: 'synthetic fixture', map: { secret: 'redacted-name' } };
  const result = withRedactionMap(map, () => projectPlans(
    [{ name: 'Secret plan', tasks: [{ id: 3, goal: 'g', result: 'r', notes: 'n', abandon_reason: 'ar', state: 's' }] }],
    { full: false },
  ));
  assert.deepEqual(result, [{ name: 'redacted-name plan', tasks: [{ id: 3, redacted: true }] }]);
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
