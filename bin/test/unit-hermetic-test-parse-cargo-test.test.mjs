// Summarises a cargo test log into totals, failed tests with panic text, binary count and compile error (bin/hermetic-test.mjs parseCargoTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCargoTest } from '../hermetic-test.mjs';

test('an empty log yields zero totals, no failures, no binaries and no compile error', () => {
  assert.deepEqual(parseCargoTest(''), {
    totals: { passed: 0, failed: 0, ignored: 0 },
    failures: [],
    binaries: 0,
    compileError: false,
  });
});

test('result lines are summed per column and each Running line counts as a binary', () => {
  const log = [
    '     Running unittests src/lib.rs (target/debug/deps/app-0123)',
    'test result: FAILED. 3 passed; 2 failed; 1 ignored; 0 measured; 0 filtered out',
    '     Running tests/it.rs (target/debug/deps/it-4567)',
    'test it_fails ... FAILED\r',
    'test result: ok. 4 passed; 0 failed; 5 ignored; 0 measured; 0 filtered out',
  ].join('\n');
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 7, failed: 2, ignored: 6 },
    failures: [{ binary: 'tests/it.rs', test: 'it_fails' }],
    binaries: 2,
    compileError: false,
  });
});

test('a failing doc test is attributed to the doc-tests binary of its crate', () => {
  const log = [
    '   Doc-tests mycrate',
    'test src/lib.rs - add (line 5) ... FAILED',
    'test src/lib.rs - sub (line 9) ... ok',
    'test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out',
  ].join('\n');
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 1, failed: 1, ignored: 0 },
    failures: [{ binary: 'doc-tests mycrate', test: 'src/lib.rs - add (line 5)' }],
    binaries: 1,
    compileError: false,
  });
});

test('an error line together with could not compile is a compile error', () => {
  const log = 'error[E0433]: failed to resolve\nerror: could not compile `mycrate` (lib) due to 1 previous error';
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 0, failed: 0, ignored: 0 },
    failures: [],
    binaries: 0,
    compileError: true,
  });
});

test('an error line without could not compile is not a compile error', () => {
  const log = 'error[E0433]: failed to resolve: use of undeclared crate';
  assert.equal(parseCargoTest(log).compileError, false);
});

test('could not compile without a line starting with error is not a compile error', () => {
  const log = 'warning: could not compile `mycrate` due to previous error';
  assert.equal(parseCargoTest(log).compileError, false);
});

test('panic text starts at the panicked line, keeps three lines and drops the backtrace note', () => {
  const log = [
    '     Running unittests src/lib.rs (target/debug/deps/app-0123)',
    '',
    'running 2 tests',
    'test a::one ... \x1b[31mFAILED\x1b[0m',
    'test a::two ... FAILED',
    '',
    'failures:',
    '',
    '---- a::one stdout ----',
    'setup line',
    "thread 'a::one' (777) panicked at src/lib.rs:3:5:",
    'first',
    'second',
    'third',
    '',
    '---- a::two stdout ----',
    "thread 'a::two' panicked at src/lib.rs:9:5:",
    'boom',
    'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
    '',
    'failures:',
    '    a::one',
    '    a::two',
    '',
    'test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s',
  ].join('\n');
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 0, failed: 2, ignored: 0 },
    failures: [
      { binary: 'src/lib.rs', test: 'a::one', panic: 'panicked at src/lib.rs:3:5: first second' },
      { binary: 'src/lib.rs', test: 'a::two', panic: 'panicked at src/lib.rs:9:5: boom' },
    ],
    binaries: 1,
    compileError: false,
  });
});

test('without a panicked line the first three stdout lines become the panic with whitespace collapsed', () => {
  const log = [
    'test b::quiet ... FAILED',
    '',
    'failures:',
    '',
    '---- b::quiet stdout ----',
    'line one',
    '  line   two  ',
    'line three',
    'line four',
    '',
    'failures:',
    '    b::quiet',
    '',
    'test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out',
  ].join('\n');
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 0, failed: 1, ignored: 0 },
    failures: [{ binary: '', test: 'b::quiet', panic: 'line one line two line three' }],
    binaries: 0,
    compileError: false,
  });
});

test('a stdout section running to the end of the log is cut to 300 characters', () => {
  const log = [
    'test c::long ... FAILED',
    '',
    '---- c::long stdout ----',
    "thread 'c::long' (42) panicked at src/a.rs:1:1:",
    'x'.repeat(400),
  ].join('\n');
  assert.deepEqual(parseCargoTest(log), {
    totals: { passed: 0, failed: 0, ignored: 0 },
    failures: [{ binary: '', test: 'c::long', panic: 'panicked at src/a.rs:1:1: ' + 'x'.repeat(274) }],
    binaries: 0,
    compileError: false,
  });
});
