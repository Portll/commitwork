// Parses a remediation markdown document into ranked actions and attribution surfaces (lib/remediation-md.mjs fromMarkdown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMarkdown } from '../remediation-md.mjs';

test('parses a minimal valid document with one action and one surface', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '- **Status:** done',
    '',
    '## Attribution surfaces',
    '### Surface: core',
    '- **Status:** open',
  ].join('\n');
  assert.deepEqual(fromMarkdown(md), { remediations: [{ rank: 1, title: "Fix bug", status: "done" }], attributionPlan: [{ area: "core", status: "open" }] });
});

test('rejects an unknown section heading', () => {
  const md = [
    '## Unknown section',
    '## Ranked actions',
    '### Action 1: Fix bug',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 1: unknown section \"Unknown section\"; only \"Ranked actions\" and \"Attribution surfaces\" are editable" });
});

test('rejects a duplicate section heading', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '## Ranked actions',
    '### Action 2: Fix other',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 3: \"Ranked actions\" appears twice" });
});

test('rejects an action heading with wrong format', () => {
  const md = [
    '## Ranked actions',
    '### Action 1= Fix bug',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 2: an action heading reads \"### Action <number>: <title>\"" });
});

test('rejects a surface heading with empty area', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '## Attribution surfaces',
    '### Surface: ',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 4: a surface heading reads \"### Surface: <area>\"" });
});

test('rejects a field line that is not a recognized field', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '- **Bogus:** value',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 3: unknown field \"Bogus\"; this entry takes Status, Layer, Closes, Raises, Effort, Gain, Action, Note, Risk, Evidence from" });
});

test('rejects a duplicate field within one entry', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '- **Status:** done',
    '- **Status:** open',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 4: Status appears twice in one entry" });
});

test('rejects a non-field text line before any field', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    'some random text',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 3: text that is not a \"- **Field:** value\" line" });
});

test('rejects a non-string field that wraps to a second line', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
    '- **Gain:** 5',
    'extra text',
    '## Attribution surfaces',
    '### Surface: core',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "line 4: Gain must stay on one line" });
});

test('rejects a missing required section', () => {
  const md = [
    '## Ranked actions',
    '### Action 1: Fix bug',
  ].join('\n');
  assert.throws(() => fromMarkdown(md), { name: "Error", message: "no \"## Attribution surfaces\" section found" });
});
