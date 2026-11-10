// Counts test results from build output (bin/lib/build-health-parse.mjs countTests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countTests } from '../lib/build-health-parse.mjs';

test('rust sums multiple passed lines', () => {
  const out = 'test result: ok. 3 passed\n\ntest result: ok. 5 passed';
  assert.equal(countTests('rust', out), 8);
});

test('rust returns null when no result lines exist', () => {
  const out = 'test result: ok. 3 passed';
  assert.equal(countTests('rust', 'no results here'), null);
});

test('go returns verdict count when present', () => {
  const out = '--- PASS: TestA\n--- FAIL: TestB';
  assert.equal(countTests('go', out), 2);
});

test('go returns zero when no verdicts but package line exists', () => {
  const out = 'ok      github.com/foo/bar  0.1s';
  assert.equal(countTests('go', out), 0);
});

test('go returns null when no verdicts and no package line', () => {
  const out = 'some random output';
  assert.equal(countTests('go', out), null);
});

test('javascript returns node test pass count', () => {
  const out = '# pass 42\n# fail 0';
  assert.equal(countTests('javascript', out), 42);
});

test('javascript returns jest passed count when no node summary', () => {
  const out = 'Tests: 10 passed, 2 failed';
  assert.equal(countTests('javascript', out), 10);
});

test('python returns passed count from summary line', () => {
  const out = '============================= 7 passed in 1.2s =============================';
  assert.equal(countTests('python', out), 7);
});

test('ruby returns examples count', () => {
  const out = '5 examples, 0 failures';
  assert.equal(countTests('ruby', out), 5);
});

test('unknown language returns null', () => {
  const out = 'test result: ok. 3 passed';
  assert.equal(countTests('c', out), null);
});
