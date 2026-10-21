// Replaces every real name in a text with its pseudonym using a private map (lib/publish-redactions.mjs redactForPublish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactForPublish } from '../publish-redactions.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('replaces a single name with its pseudonym', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Alice': 'P1' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('Hello Alice', env);
    assert.equal(result, 'Hello P1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replaces names case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Alice': 'P1' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('alice ALICE Alice', env);
    assert.equal(result, 'P1 P1 P1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replaces all occurrences of a name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Bob': 'P2' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('Bob and Bob and Bob', env);
    assert.equal(result, 'P2 and P2 and P2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws TypeError when input is not a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Alice': 'P1' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    assert.throws(() => redactForPublish(123, env), TypeError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty string unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Alice': 'P1' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('', env);
    assert.equal(result, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns text unchanged when no names match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'Alice': 'P1' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('No names here', env);
    assert.equal(result, 'No names here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prefers longer names over shorter ones during replacement', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ map: { 'teamA': 'P1', 'teamA-libs': 'P2' } }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    const result = redactForPublish('teamA-libs and teamA', env);
    assert.equal(result, 'P2 and P1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when redaction map file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'nonexistent.json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    assert.throws(() => redactForPublish('test', env), /map is ABSENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when redaction map is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, 'not valid json');
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    assert.throws(() => redactForPublish('test', env), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when redaction map fails schema validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redactForPublish-'));
  try {
    const mapPath = join(dir, 'map.json');
    writeFileSync(mapPath, JSON.stringify({ wrong: 'field' }));
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { map: { type: 'object' } }, required: ['map'] }));
    const env = { CW_PUBLISH_REDACTIONS: mapPath, CW_PUBLISH_REDACTIONS_SCHEMA: schemaPath };
    assert.throws(() => redactForPublish('test', env), /does not satisfy its schema/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
