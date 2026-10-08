import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rebuildLearning, loadLearning, saveLearning } from '../learning.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const issuesDoc = { events: [{
  type: 'fix-verified',
  issueId: 'ISS-TEST-S-000001',
  at: '2026-01-01T00:00:00.000Z',
  data: { rule: 'deps/vuln', pathPrefix: 'services/api/', package: 'example' },
  prevHash: null,
  hash: 'fixture-hash',
}] };

test('matching events and clock produce byte-identical learning views', () => {
  const options = { issuesDoc, now: '2026-04-01T00:00:00.000Z' };
  assert.equal(JSON.stringify(rebuildLearning(options)), JSON.stringify(rebuildLearning(options)));
});

test('the learning store validates on both write and read', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cw-learning-')), 'learning.json');
  const doc = rebuildLearning({ issuesDoc, now: '2026-04-01T00:00:00.000Z' });
  saveLearning(doc, { path });
  assert.deepEqual(loadLearning({ path }), doc);
  assert.throws(() => saveLearning({ ...doc, version: 2 }, { path }), /learning view is invalid/);
});

test('the tracked sample is a valid empty learning view', () => {
  const sample = JSON.parse(readFileSync(join(HERE, '..', 'data', 'learning.json.sample'), 'utf8'));
  const schema = join(HERE, '..', '..', 'schema', 'learning.schema.json');
  assert.deepEqual(validateAgainstSchema(sample, { path: schema }).errors, []);
  assert.deepEqual(sample.patterns, {});
});
