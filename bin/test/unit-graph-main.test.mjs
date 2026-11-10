// The exit code and stderr line a graph command line produces (bin/graph.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../graph.mjs';

const USAGE = 'usage: graph.mjs build | status | query neighbours <id> [--rel r] [--depth n] | query path <a> <b> [--depth n]';
const REACHED = { code: 21, errors: ['graph: stubbed'] };
const REFUSED = { code: 22, errors: [USAGE] };

function run(argv) {
  const errors = [];
  const stringify = JSON.stringify;
  const error = console.error;
  JSON.stringify = () => { throw new Error('stubbed'); };
  console.error = (m) => { errors.push(m); };
  try {
    const code = main(argv);
    return { code, errors };
  } finally {
    JSON.stringify = stringify;
    console.error = error;
  }
}

test('an empty argument list prints the usage line and returns 22', () => {
  assert.deepEqual(run([]), REFUSED);
});

test('an unknown command prints the usage line and returns 22', () => {
  assert.deepEqual(run(['frobnicate']), REFUSED);
});

test('a third positional after an unknown pair does not reach the neighbours query', () => {
  assert.deepEqual(run(['build', 'x', 'y']), REFUSED);
});

test('build and status alone reach the graph store and report its error as 21', () => {
  assert.deepEqual(run(['build']), REACHED);
  assert.deepEqual(run(['status']), REACHED);
  assert.deepEqual(run(['status', 'extra']), REFUSED);
});

test('query neighbours with one id reaches the graph store and reports its error as 21', () => {
  assert.deepEqual(run(['query', 'neighbours', 'n']), REACHED);
  assert.deepEqual(run(['query', 'neighbours', 'n', 'm']), REFUSED);
});

test('a depth of exactly 1 is accepted and the query runs', () => {
  assert.deepEqual(run(['query', 'neighbours', 'n', '--depth', '1']), REACHED);
  assert.deepEqual(run(['query', 'neighbours', 'n', '--depth']), REACHED);
});

test('a depth of 0 or a fractional depth is refused before any query runs', () => {
  assert.deepEqual(run(['query', 'neighbours', 'n', '--depth', '0']), REFUSED);
  assert.deepEqual(run(['query', 'path', 'a', 'b', '--depth', '1.5']), REFUSED);
});

test('query path needs two ids and query alone falls through to usage', () => {
  assert.deepEqual(run(['query', 'path', 'a', 'b', '--depth', '8']), REACHED);
  assert.deepEqual(run(['query', 'path', 'a']), REFUSED);
  assert.deepEqual(run(['query']), REFUSED);
});

test('a value following a flag is not taken as a positional', () => {
  assert.deepEqual(run(['query', 'path', 'a', '--rel', 'b']), REFUSED);
  assert.deepEqual(run(['--depth', '2', 'query', 'neighbours', 'n']), REACHED);
});

test('without an argument list it reads the command from process.argv after the script path', () => {
  const saved = process.argv;
  process.argv = [process.execPath, 'graph.mjs', 'query', 'neighbours', 'n'];
  try {
    assert.deepEqual(run(), REACHED);
  } finally {
    process.argv = saved;
  }
});
