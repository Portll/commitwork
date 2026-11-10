// Whether source with the given spans masked out still parses as a module (flow/verify.mjs maskConsistent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskConsistent } from '../verify.mjs';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

test('A span starting inside the previous span is reported as overlapping', async () => {
  const src = 'import a from "a"; import b from "b";';
  const spans = [
    { innerStart: 0, innerEnd: 10 },
    { innerStart: 5, innerEnd: 15 }
  ];
  const r = await maskConsistent(src, spans);
  assert.deepEqual(r, { ok: false, error: 'overlapping spans at 5' });
});

test('A span ending before it starts is reported as inverted', async () => {
  const src = 'import a from "a";';
  const spans = [{ innerStart: 10, innerEnd: 5 }];
  const r = await maskConsistent(src, spans);
  assert.deepEqual(r, { ok: false, error: 'inverted span at 10' });
});

test('Adjacent spans are accepted but a span starting one before the previous end overlaps', async () => {
  const spans = [
    { innerStart: 0, innerEnd: 10 },
    { innerStart: 10, innerEnd: 20 },
    { innerStart: 19, innerEnd: 22 }
  ];
  const r = await maskConsistent(ALPHABET, spans);
  assert.deepEqual(r, { ok: false, error: 'overlapping spans at 19' });
});

test('Spans are sorted by start before the overlap check', async () => {
  const spans = [
    { innerStart: 12, innerEnd: 20 },
    { innerStart: 0, innerEnd: 13 }
  ];
  const r = await maskConsistent(ALPHABET, spans);
  assert.deepEqual(r, { ok: false, error: 'overlapping spans at 12' });
});

test('An empty span is accepted but a span whose end is one below its start is inverted', async () => {
  const spans = [
    { innerStart: 2, innerEnd: 2 },
    { innerStart: 5, innerEnd: 4 }
  ];
  const r = await maskConsistent(ALPHABET, spans);
  assert.deepEqual(r, { ok: false, error: 'inverted span at 5' });
});

test('A span reaching one past the end of the source changes the mask length', async () => {
  const r = await maskConsistent('abc', [{ innerStart: 1, innerEnd: 4 }]);
  assert.deepEqual(r, { ok: false, error: 'mask changed length' });
});

test('A span starting before zero is reported as overlapping', async () => {
  const r = await maskConsistent('abc', [{ innerStart: -1, innerEnd: 2 }]);
  assert.deepEqual(r, { ok: false, error: 'overlapping spans at -1' });
});

test('A valid mask ending exactly at the source end reaches the parser, which refuses without vm modules', async () => {
  await assert.rejects(
    maskConsistent('abc', [{ innerStart: 1, innerEnd: 3 }]),
    {
      name: 'Error',
      message: 'vm.SourceTextModule unavailable \u2014 run node with --experimental-vm-modules. '
        + 'Refusing to fall back to the unfloored lexer.'
    }
  );
});
