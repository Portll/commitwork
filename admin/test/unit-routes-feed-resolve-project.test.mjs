// Resolves a project query parameter to a canonical slug or null (admin/routes/feed.mjs resolveProject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProject } from '../routes/feed.mjs';

test('returns null when query parameter is missing', () => {
  const ctx = { query: new URLSearchParams(), knownProjects: () => new Set(['alpha']) };
  assert.equal(resolveProject(ctx), null);
});

test('returns null when query parameter is empty string', () => {
  const ctx = { query: new URLSearchParams('project='), knownProjects: () => new Set(['alpha']) };
  assert.equal(resolveProject(ctx), null);
});

test('returns null when query parameter is whitespace only', () => {
  const ctx = { query: new URLSearchParams('project=%20'), knownProjects: () => new Set(['alpha']) };
  assert.equal(resolveProject(ctx), null);
});

test('returns null when project is not in known projects', () => {
  const ctx = { query: new URLSearchParams('project=unknown'), knownProjects: () => new Set(['alpha', 'beta']) };
  assert.equal(resolveProject(ctx), null);
});

test('returns canonical slug when project matches known project directly', () => {
  const ctx = { query: new URLSearchParams('project=alpha'), knownProjects: () => new Set(['alpha', 'beta']) };
  assert.equal(resolveProject(ctx), 'alpha');
});

test('returns canonical slug when project slug matches known project', () => {
  const ctx = { query: new URLSearchParams('project=Alpha'), knownProjects: () => new Set(['alpha', 'beta']) };
  assert.equal(resolveProject(ctx), 'alpha');
});

test('returns null when project slug is not in known projects', () => {
  const ctx = { query: new URLSearchParams('project=Gamma'), knownProjects: () => new Set(['alpha', 'beta']) };
  assert.equal(resolveProject(ctx), null);
});

test('uses ctx.knownProjects when provided instead of module default', () => {
  const ctx = { query: new URLSearchParams('project=custom'), knownProjects: () => new Set(['custom', 'other']) };
  assert.equal(resolveProject(ctx), 'custom');
});

test('returns null when knownProjects is empty set', () => {
  const ctx = { query: new URLSearchParams('project=alpha'), knownProjects: () => new Set() };
  assert.equal(resolveProject(ctx), null);
});

test('handles project with special characters that slugify to known value', () => {
  const ctx = { query: new URLSearchParams('project=My%20Project'), knownProjects: () => new Set(['my-project']) };
  assert.equal(resolveProject(ctx), 'my-project');
});
