// Extracts trigger job kinds and classifies their argv sources (monitor/stpa-sweep.mjs extractTriggerKinds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTriggerKinds } from '../stpa-sweep.mjs';

test('returns an empty array when no kind comparisons or health map are present', () => {
  const source = "const x = 1;";
  assert.deepEqual(extractTriggerKinds(source), []);
});

test('returns a health map row with closed-map source when HEALTH[kind] is present', () => {
  const source = "if (HEALTH[kind]) { run(); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'health-*');
  assert.equal(result[0].argvSource, 'closed-map');
  assert.equal(result[0].detail, 'HEALTH[kind] is a closed object literal \u2014 every value is a fleet-declared constant, never a request field');
});

test('returns allowlist source for a kind when resolver exists and no raw opts reference is found', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(proj); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'allowlist');
  assert.equal(result[0].detail, 'argv resolved via triggerProject() / closed selectors only');
});

test('returns unclassified source for a kind when resolver exists but raw opts reference is found', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.custom); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'unclassified');
  assert.equal(result[0].detail, 'could not confirm every argv element traces to a closed source \u2014 review by hand');
});

test('returns unclassified source for a kind when no resolver exists even without raw opts reference', () => {
  const source = "if (kind === 'sweep') { run(project); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'unclassified');
  assert.equal(result[0].detail, 'could not confirm every argv element traces to a closed source \u2014 review by hand');
});

test('returns allowlist source when opts.check is referenced with the known safe pattern', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.check || 'default'); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'allowlist');
  assert.equal(result[0].detail, 'argv resolved via triggerProject() / closed selectors only');
});

test('returns allowlist source when opts.repo is referenced with the known safe pattern', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.repo ? [opts.repo] : []); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'allowlist');
  assert.equal(result[0].detail, 'argv resolved via triggerProject() / closed selectors only');
});

test('returns allowlist source when opts.label is referenced with the known safe pattern', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.label); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'allowlist');
  assert.equal(result[0].detail, 'argv resolved via triggerProject() / closed selectors only');
});

test('returns unclassified source when an unrecognized opts field is referenced', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.secret); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'unclassified');
  assert.equal(result[0].detail, 'could not confirm every argv element traces to a closed source \u2014 review by hand');
});

test('extracts multiple kinds and classifies each independently', () => {
  const source = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(proj); } else if (kind === 'bola') { run(opts.custom); }";
  const result = extractTriggerKinds(source);
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'sweep');
  assert.equal(result[0].argvSource, 'allowlist');
  assert.equal(result[1].kind, 'bola');
  assert.equal(result[1].argvSource, 'unclassified');
});
