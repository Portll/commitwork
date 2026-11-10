// Reports catch blocks inside for-of loops that swallow per-item failures (bin/lib/pattern-core.mjs detectFanoutSwallowsItem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFanoutSwallowsItem } from '../lib/pattern-core.mjs';

const STRUCTURAL = 'a catch inside a fan-out loop neither rethrows, records, nor names the failure, so the aggregate completes and exits 0 with an unknown number of members having done nothing';
const NAMED = 'a catch inside a fan-out loop logs the failure and lets the loop continue, so the aggregate still exits 0 \u2014 UNDETERMINED';

const finding = (path, line, snippet, named) => ({
  identity: `${path}::loop-catch::K7`,
  detector: 'fanout-swallows-item@1',
  classId: 'K7',
  place: { path, scope: 'loop-catch', line, lineIsAdvisory: true },
  evidence: { predicate: named ? NAMED : STRUCTURAL, snippet, redacted: 0, redactor: null },
  confidence: named ? 'heuristic' : 'structural',
});

const run = (src, stripped = src, rel = 'a.mjs') => detectFanoutSwallowsItem({ rel, src, stripped });

test('an empty catch closing right before the loop brace at the start of the source is reported as structural', () => {
  const src = 'for (const x of xs) { try { f(x); } catch (e){}}';
  assert.deepEqual(run(src), [finding('a.mjs', 1, '{}', false)]);
});

test('the reported catch body stops at its closing brace and ignores the character after it', () => {
  const src = 'for (const x of xs) { try { f(x); } catch (e) {}e; }';
  assert.deepEqual(run(src), [finding('a.mjs', 1, '{}', false)]);
});

test('a catch that only logs the error is reported as heuristic on the line of the catch', () => {
  const src = 'for (const x of xs) {\n  try {\n    work(x);\n  } catch (e) {\n    console.error(e);\n  }\n}\n';
  assert.deepEqual(run(src, src, 'b.mjs'), [finding('b.mjs', 4, '{ console.error(e); }', true)]);
});

test('every swallowing catch in a for await loop is reported in source order', () => {
  const src = 'for await (let r of rows) { try { a(r); } catch (e) {} try { b(r); } catch (err) { console.warn(err); } }';
  assert.deepEqual(run(src, src, 'c.mjs'), [
    finding('c.mjs', 1, '{}', false),
    finding('c.mjs', 1, '{ console.warn(err); }', true),
  ]);
});

test('a catch that rethrows or records the failure is not reported', () => {
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { throw e; } }'), []);
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { bad.push(x); } }'), []);
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { process.exitCode = 1; } }'), []);
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { failed = true; } }'), []);
});

test('a catch that branches on the error or returns it is not reported', () => {
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { if (e.code) g(); } }'), []);
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) { return e; } }'), []);
});

test('a catch whose original text routes the error is not reported even when the stripped text does not', () => {
  const src = "for (const x of xs) { try { f(x); } catch (e) { note('e'); } }";
  const stripped = "for (const x of xs) { try { f(x); } catch (e) { note(' '); } }";
  assert.deepEqual(run(src, stripped), []);
});

test('an unclosed loop, a loop without a catch, or a catch outside any loop yields nothing', () => {
  assert.deepEqual(run('for (const x of xs) { try { f(x); } catch (e) {}'), []);
  assert.deepEqual(run('for (const x of xs) { f(x); }'), []);
  assert.deepEqual(run('const x = 1;\ntry { f(x); } catch (e) {}\n'), []);
});
