// Computes the project roots to scan, from the CW_PROJECTS_ROOT override or else the registry's declared roots (admin/routes/projects-view.mjs designatedRoots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designatedRoots } from '../routes/projects-view.mjs';

test('returns a single env-derived root when CW_PROJECTS_ROOT is set', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  process.env.CW_PROJECTS_ROOT = '/tmp/projects';
  try {
    const result = designatedRoots({ roots: [{ path: '/ignored' }] });
    assert.deepEqual(result, [
      { path: '/tmp/projects', declared: '/tmp/projects', source: 'env:CW_PROJECTS_ROOT', maxDepth: 2, exclude: [] }
    ]);
  } finally {
    if (original === undefined) delete process.env.CW_PROJECTS_ROOT;
    else process.env.CW_PROJECTS_ROOT = original;
  }
});

test('ignores registry roots when CW_PROJECTS_ROOT is set', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  process.env.CW_PROJECTS_ROOT = '~/code';
  try {
    const result = designatedRoots({ roots: [{ path: '/a' }, { path: '/b' }] });
    assert.equal(result.length, 1);
    assert.equal(result[0].source, 'env:CW_PROJECTS_ROOT');
    assert.equal(result[0].declared, '~/code');
  } finally {
    if (original === undefined) delete process.env.CW_PROJECTS_ROOT;
    else process.env.CW_PROJECTS_ROOT = original;
  }
});

test('maps each registry root with default maxDepth 1 and empty exclude when fields are missing', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({ roots: [{ path: '/repo1' }, { path: '/repo2' }] });
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { path: '/repo1', declared: '/repo1', source: 'registry:roots[]', maxDepth: 1, exclude: [] });
    assert.deepEqual(result[1], { path: '/repo2', declared: '/repo2', source: 'registry:roots[]', maxDepth: 1, exclude: [] });
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});

test('preserves explicit maxDepth and exclude values from registry roots', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({ roots: [{ path: '/deep', maxDepth: 5, exclude: ['node_modules', '.git'] }] });
    assert.deepEqual(result, [
      { path: '/deep', declared: '/deep', source: 'registry:roots[]', maxDepth: 5, exclude: ['node_modules', '.git'] }
    ]);
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});

test('returns an empty array when registry has no roots and no env override', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({});
    assert.deepEqual(result, []);
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});

test('returns an empty array when registry roots is explicitly empty and no env override', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({ roots: [] });
    assert.deepEqual(result, []);
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});

test('uses maxDepth 1 when registry root maxDepth is 0', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({ roots: [{ path: '/zero', maxDepth: 0 }] });
    assert.equal(result[0].maxDepth, 1);
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});

test('uses empty exclude array when registry root exclude is null', () => {
  const original = process.env.CW_PROJECTS_ROOT;
  delete process.env.CW_PROJECTS_ROOT;
  try {
    const result = designatedRoots({ roots: [{ path: '/null-excl', exclude: null }] });
    assert.deepEqual(result[0].exclude, []);
  } finally {
    if (original !== undefined) process.env.CW_PROJECTS_ROOT = original;
  }
});
