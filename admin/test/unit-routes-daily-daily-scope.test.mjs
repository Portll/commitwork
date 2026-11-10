// Maps a project to its area and repo scope (admin/routes/daily.mjs dailyScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyScope } from '../routes/daily.mjs';

test('returns area slug and null repo when area matches by slug', () => {
  const reg = { areas: [{ slug: 'backend', label: 'Backend' }] };
  const result = dailyScope('backend', reg);
  assert.deepEqual(result, { area: 'backend', repo: null });
});

test('returns area slug and null repo when area matches by label', () => {
  const reg = { areas: [{ slug: 'backend', label: 'Backend' }] };
  const result = dailyScope('Backend', reg);
  assert.deepEqual(result, { area: 'backend', repo: null });
});

test('returns areaOf result and project as repo when no area matches', () => {
  const reg = { areas: [{ slug: 'backend', label: 'Backend' }] };
  const result = dailyScope('frontend', reg);
  assert.deepEqual(result, { area: 'frontend', repo: 'frontend' });
});

test('returns slug and project as repo when reg has no areas array', () => {
  const reg = {};
  const result = dailyScope('myproject', reg);
  assert.deepEqual(result, { area: 'myproject', repo: 'myproject' });
});

test('returns slug and project as repo when areas is empty array', () => {
  const reg = { areas: [] };
  const result = dailyScope('myproject', reg);
  assert.deepEqual(result, { area: 'myproject', repo: 'myproject' });
});

test('returns first matching area when multiple areas exist', () => {
  const reg = { areas: [
    { slug: 'alpha', label: 'Alpha' },
    { slug: 'beta', label: 'Beta' }
  ]};
  const result = dailyScope('Beta', reg);
  assert.deepEqual(result, { area: 'beta', repo: null });
});

test('handles project with special characters in slug', () => {
  const reg = { areas: [{ slug: 'my-project', label: 'My Project' }] };
  const result = dailyScope('my-project', reg);
  assert.deepEqual(result, { area: 'my-project', repo: null });
});

test('returns area slug when area matches by slug even if label differs', () => {
  const reg = { areas: [{ slug: 'core', label: 'Core Services' }] };
  const result = dailyScope('core', reg);
  assert.deepEqual(result, { area: 'core', repo: null });
});
