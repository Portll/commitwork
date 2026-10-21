// Resolves the OpenAPI spec file path for a project (bin/audit.mjs resolveOpenapi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenapi } from '../audit.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the provided openapiArg when it is truthy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'proj');
    mkdirSync(project, { recursive: true });
    const arg = join(dir, 'custom-spec.yaml');
    const result = resolveOpenapi(project, arg);
    assert.equal(result, arg);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when openapiArg is empty string and no candidate files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'empty-proj');
    mkdirSync(project, { recursive: true });
    const result = resolveOpenapi(project, '');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns openapi.yaml when it exists and openapiArg is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'proj-yaml');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'openapi.yaml'), 'openapi: 3.0.0');
    const result = resolveOpenapi(project, null);
    assert.equal(result, 'openapi.yaml');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns openapi.json when openapi.yaml is missing but openapi.json exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'proj-json');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'openapi.json'), '{"openapi":"3.0.0"}');
    const result = resolveOpenapi(project, null);
    assert.equal(result, 'openapi.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns openapi.yml when openapi.yaml and openapi.json are missing but openapi.yml exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'proj-yml');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'openapi.yml'), 'openapi: 3.0.0');
    const result = resolveOpenapi(project, null);
    assert.equal(result, 'openapi.yml');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when no candidate files exist and openapiArg is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'no-spec');
    mkdirSync(project, { recursive: true });
    const result = resolveOpenapi(project, undefined);
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers openapi.yaml over openapi.json and openapi.yml when all exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'all-exist');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'openapi.yaml'), 'yaml');
    writeFileSync(join(project, 'openapi.json'), 'json');
    writeFileSync(join(project, 'openapi.yml'), 'yml');
    const result = resolveOpenapi(project, null);
    assert.equal(result, 'openapi.yaml');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers openapi.json over openapi.yml when openapi.yaml is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolveOpenapi-'));
  try {
    const project = join(dir, 'json-over-yml');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'openapi.json'), 'json');
    writeFileSync(join(project, 'openapi.yml'), 'yml');
    const result = resolveOpenapi(project, null);
    assert.equal(result, 'openapi.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
