// Builds a registry object with deduplicated project names, areas, and roots (bin/init.mjs buildRegistry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../init.mjs';

test('deduplicates project names by appending incrementing suffixes', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: [],
    repos: ['/a/proj', '/b/proj', '/c/proj'],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: [
      { name: 'proj', area: 'local', path: '/a/proj', manifest: 'security-baseline' },
      { name: 'proj-2', area: 'local', path: '/b/proj', manifest: 'security-baseline' },
      { name: 'proj-3', area: 'local', path: '/c/proj', manifest: 'security-baseline' }
    ]
  });
});

test('sets area primary flag to true', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: [],
    repos: [],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: []
  });
});

test('maps roots with maxDepth 2', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: ['/root1', '/root2'],
    repos: [],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [
      { path: '/root1', maxDepth: 2 },
      { path: '/root2', maxDepth: 2 }
    ],
    projects: []
  });
});

test('computes relative schema path from registry directory', () => {
  const input = {
    registryPath: '/home/user/projects/registry.json',
    roots: [],
    repos: [],
    schemaPath: '/home/user/projects/schema/projects.schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema/projects.schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: []
  });
});

test('handles single repository with unique name', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: [],
    repos: ['/path/to/alpha'],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: [
      { name: 'alpha', area: 'local', path: '/path/to/alpha', manifest: 'security-baseline' }
    ]
  });
});

test('handles empty repos and roots arrays', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: [],
    repos: [],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: []
  });
});

test('deduplicates when basename collision occurs at index 2', () => {
  const input = {
    registryPath: '/reg/registry.json',
    roots: [],
    repos: ['/x/app', '/y/app', '/z/app', '/w/app'],
    schemaPath: '/reg/schema.json'
  };
  const result = buildRegistry(input);
  assert.deepEqual(result, {
    $schema: 'schema.json',
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    areas: [{
      slug: 'local',
      label: 'Local',
      out: 'local',
      primary: true,
      prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.'
    }],
    roots: [],
    projects: [
      { name: 'app', area: 'local', path: '/x/app', manifest: 'security-baseline' },
      { name: 'app-2', area: 'local', path: '/y/app', manifest: 'security-baseline' },
      { name: 'app-3', area: 'local', path: '/z/app', manifest: 'security-baseline' },
      { name: 'app-4', area: 'local', path: '/w/app', manifest: 'security-baseline' }
    ]
  });
});
