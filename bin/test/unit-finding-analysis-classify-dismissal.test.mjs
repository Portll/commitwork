// Classifies a dismissal verdict as proven, cited, or opinion (bin/finding-analysis.mjs classifyDismissal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDismissal } from '../finding-analysis.mjs';

test('returns null kind and empty lists when verdict is not a dismissal', () => {
  const out = classifyDismissal({ verdict: 'confirmed', answer: 'real bug', thinking: '' });
  assert.deepEqual(out, { kind: null, verdict: 'confirmed', callPath: null, entryPoints: [], symbolsChecked: [], citations: [] });
});

test('returns null kind and null verdict when reply is undefined', () => {
  const out = classifyDismissal(undefined);
  assert.deepEqual(out, { kind: null, verdict: null, callPath: null, entryPoints: [], symbolsChecked: [], citations: [] });
});

test('returns null kind and null verdict when reply has no verdict', () => {
  const out = classifyDismissal({ answer: 'some text' });
  assert.deepEqual(out, { kind: null, verdict: null, callPath: null, entryPoints: [], symbolsChecked: [], citations: [] });
});

test('classifies unreachable with entry points and symbols as path-shown', () => {
  const reply = {
    verdict: 'unreachable',
    answer: 'ENTRY_POINTS: main.js, index.js\nSYMBOLS_CHECKED: foo, bar',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'path-shown');
  assert.equal(out.verdict, 'unreachable');
  assert.equal(out.callPath, null);
  assert.deepEqual(out.entryPoints, ['main.js', 'index.js']);
  assert.deepEqual(out.symbolsChecked, ['foo', 'bar']);
  assert.deepEqual(out.citations, []);
  assert.equal(out.reason, null);
});

test('classifies unreachable with only entry points as opinion', () => {
  const reply = {
    verdict: 'unreachable',
    answer: 'ENTRY_POINTS: main.js',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'opinion');
  assert.equal(out.verdict, 'unreachable');
  assert.deepEqual(out.entryPoints, ['main.js']);
  assert.deepEqual(out.symbolsChecked, []);
  assert.equal(out.reason, 'unreachable claimed without a shown path (entry points: 1, symbols: 0) \u2014 recorded as opinion; the finding stands unchanged');
});

test('classifies unreachable with only symbols as opinion', () => {
  const reply = {
    verdict: 'unreachable',
    answer: 'SYMBOLS_CHECKED: foo',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'opinion');
  assert.equal(out.verdict, 'unreachable');
  assert.deepEqual(out.entryPoints, []);
  assert.deepEqual(out.symbolsChecked, ['foo']);
  assert.equal(out.reason, 'unreachable claimed without a shown path (entry points: 0, symbols: 1) \u2014 recorded as opinion; the finding stands unchanged');
});

test('classifies unreachable with neither entry points nor symbols as opinion', () => {
  const reply = {
    verdict: 'unreachable',
    answer: 'just some words',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'opinion');
  assert.equal(out.verdict, 'unreachable');
  assert.deepEqual(out.entryPoints, []);
  assert.deepEqual(out.symbolsChecked, []);
  assert.equal(out.reason, 'unreachable claimed without a shown path (entry points: 0, symbols: 0) \u2014 recorded as opinion; the finding stands unchanged');
});

test('classifies false-positive with file line citation as cited', () => {
  const reply = {
    verdict: 'false-positive',
    answer: 'see src/app.js:42 for the guard',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'cited');
  assert.equal(out.verdict, 'false-positive');
  assert.equal(out.callPath, null);
  assert.deepEqual(out.entryPoints, []);
  assert.deepEqual(out.symbolsChecked, []);
  assert.deepEqual(out.citations, ['src/app.js:42']);
  assert.equal(out.reason, null);
});

test('classifies false-positive with version pin as cited', () => {
  const reply = {
    verdict: 'false-positive',
    answer: 'fixed in lodash@4.17.21',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'cited');
  assert.equal(out.verdict, 'false-positive');
  assert.deepEqual(out.citations, ['lodash@4.17.21']);
  assert.equal(out.reason, null);
});

test('classifies false-positive with no citations as opinion', () => {
  const reply = {
    verdict: 'false-positive',
    answer: 'this is not a real issue',
    thinking: '',
  };
  const out = classifyDismissal(reply);
  assert.equal(out.kind, 'opinion');
  assert.equal(out.verdict, 'false-positive');
  assert.equal(out.callPath, null);
  assert.deepEqual(out.entryPoints, []);
  assert.deepEqual(out.symbolsChecked, []);
  assert.deepEqual(out.citations, []);
  assert.equal(out.reason, 'false-positive claimed with nothing a reader can check (no file:line, no version pin) \u2014 recorded as opinion; the finding stands unchanged');
});
