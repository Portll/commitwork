// Maps a template record to its parsed rule, or a not-found/unreadable error (monitor/nuclei-solve.mjs ruleLoader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleLoader } from '../nuclei-solve.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns ok false with reason when the template file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const loader = ruleLoader({ root: dir });
    const rec = { 'template-id': 'missing', template: 'nope.yaml' };
    const out = loader(rec);
    assert.deepEqual(out, { ok: false, id: 'missing', reason: 'template not found in the local store' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok false with reason when the template file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'bad.yaml');
    writeFileSync(file, 'id: x\n');
    const loader = ruleLoader({ root: dir, read: () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); } });
    const rec = { 'template-id': 'x', template: 'bad.yaml' };
    const out = loader(rec);
    assert.equal(out.ok, false);
    assert.equal(out.id, 'x');
    assert.equal(out.reason, 'template unreadable: EACCES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses a minimal template with an id and a contentless dsl matcher', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 't.yaml');
    writeFileSync(file, 'id: my-rule\nmatchers:\n  - type: dsl\n    dsl:\n      - success == true\n');
    const loader = ruleLoader({ root: dir });
    const rec = { 'template-id': 'fallback', template: 't.yaml' };
    const out = loader(rec);
    assert.equal(out.ok, true);
    assert.equal(out.file, file);
    assert.equal(out.id, 'my-rule');
    assert.equal(out.digest, null);
    assert.deepEqual(out.declaredPorts, []);
    assert.equal(out.gate, null);
    assert.deepEqual(out.transports, []);
    assert.deepEqual(out.tags, []);
    assert.equal(out.matcherHasContentPredicate, false);
    assert.equal(out.extractorDiscriminating, false);
    assert.equal(out.hasMatchers, true);
    assert.equal(out.hasExtractors, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a word matcher as having a content predicate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'w.yaml');
    writeFileSync(file, 'id: w\nmatchers:\n  - type: word\n    words:\n      - secret\n');
    const loader = ruleLoader({ root: dir });
    const out = loader({ 'template-id': 'w', template: 'w.yaml' });
    assert.equal(out.ok, true);
    assert.equal(out.matcherHasContentPredicate, true);
    assert.equal(out.hasMatchers, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a discriminating extractor regex as discriminating', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'e.yaml');
    writeFileSync(file, 'id: e\nextractors:\n  - type: regex\n    regex:\n      - "abc"\n');
    const loader = ruleLoader({ root: dir });
    const out = loader({ 'template-id': 'e', template: 'e.yaml' });
    assert.equal(out.ok, true);
    assert.equal(out.extractorDiscriminating, true);
    assert.equal(out.hasExtractors, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats a non-discriminating extractor regex as not discriminating', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'nd.yaml');
    writeFileSync(file, 'id: nd\nextractors:\n  - type: regex\n    regex:\n      - "(.*)" \n');
    const loader = ruleLoader({ root: dir });
    const out = loader({ 'template-id': 'nd', template: 'nd.yaml' });
    assert.equal(out.ok, true);
    assert.equal(out.extractorDiscriminating, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records a declared port and a tcp transport from the template body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'p.yaml');
    writeFileSync(file, 'id: p\n  Port: 8080\nc.Open("tcp")\n');
    const loader = ruleLoader({ root: dir });
    const out = loader({ 'template-id': 'p', template: 'p.yaml' });
    assert.equal(out.ok, true);
    assert.deepEqual(out.declaredPorts, [8080]);
    assert.deepEqual(out.transports, ['tcp']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memoizes the result so the same file is read only once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruleLoader-'));
  try {
    const file = join(dir, 'm.yaml');
    writeFileSync(file, 'id: m\n');
    let calls = 0;
    const loader = ruleLoader({ root: dir, read: (f) => { calls++; return readFileSync(f, 'utf8'); } });
    const rec = { 'template-id': 'm', template: 'm.yaml' };
    const a = loader(rec);
    const b = loader(rec);
    assert.equal(a, b);
    assert.equal(calls, 1);
    assert.equal(a.ok, true);
    assert.equal(a.id, 'm');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
