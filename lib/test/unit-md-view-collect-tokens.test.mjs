// Map of --token names to dark and light colours read from palette tables (lib/md-view.mjs collectTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTokens } from '../md-view.mjs';

const both = (c) => ({ dark: c, light: c });

test('a document with no table yields an empty map', () => {
  assert.deepEqual(collectTokens([{ t: 'p' }]), new Map());
});

test('a Name and Dark table maps the token to its dark colour for both themes and the first definition wins', () => {
  const r = collectTokens([{
    t: 'table',
    head: ['Name', 'Dark'],
    rows: [['`--a`', '#112233'], ['`--a`', '#998877'], ['`--9` `width`', '#445566']],
  }]);
  assert.deepEqual(r, new Map([['--a', both('#112233')]]));
});

test('separate Dark and Light columns give each theme its own colour', () => {
  const r = collectTokens([{ t: 'table', head: ['Name', 'Dark', 'Light'], rows: [['`--a`', '#112233', '#445566']] }]);
  assert.deepEqual(r, new Map([['--a', { dark: '#112233', light: '#445566' }]]));
});

test('a Dark, Light or Value header in the first column reads the colour from the name cell', () => {
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Dark'], rows: [['`--a` #112233']] }]),
    new Map([['--a', both('#112233')]]),
  );
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Light'], rows: [['`--b` #445566']] }]),
    new Map([['--b', both('#445566')]]),
  );
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Value'], rows: [['`--c` #778899']] }]),
    new Map([['--c', both('#778899')]]),
  );
});

test('tables without a palette header or with only a contrast column are skipped', () => {
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Name', 'Note'], rows: [['`--a`', '#112233']] }]),
    new Map(),
  );
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Name', 'Dark contrast'], rows: [['`--a`', '#112233']] }]),
    new Map(),
  );
});

test('a row whose Dark cell names another token becomes an alias resolved after all tables', () => {
  const r = collectTokens([
    { t: 'table', head: ['Name', 'Dark'], rows: [['`--a`', '`--b`']] },
    { t: 'table', head: ['Name', 'Dark'], rows: [['`--b`', '#222222']] },
  ]);
  assert.deepEqual(r, new Map([['--b', both('#222222')], ['--a', both('#222222')]]));
});

test('an alias to an undefined token is dropped and a later direct definition beats the alias', () => {
  assert.deepEqual(
    collectTokens([{ t: 'table', head: ['Name', 'Dark'], rows: [['`--x`', '`--y`']] }]),
    new Map(),
  );
  const r = collectTokens([
    { t: 'table', head: ['Name', 'Dark'], rows: [['`--a`', '#112233']] },
    { t: 'table', head: ['Name', 'Dark'], rows: [['`--b`', '`--a`']] },
    { t: 'table', head: ['Name', 'Dark'], rows: [['`--b`', '#445566']] },
  ]);
  assert.deepEqual(r, new Map([['--a', both('#112233')], ['--b', both('#445566')]]));
});

test('with Light as the first column an alias takes its target from that column', () => {
  const r = collectTokens([
    { t: 'table', head: ['Name', 'Value'], rows: [['`--a`', '#112233']] },
    { t: 'table', head: ['Light'], rows: [['`--a` `--b`']] },
  ]);
  assert.deepEqual(r, new Map([['--a', both('#112233')], ['--b', both('#112233')]]));
});

test('with Dark as the first column an alias takes its target from that column', () => {
  const r = collectTokens([
    { t: 'table', head: ['Name', 'Value'], rows: [['`--a`', '#112233']] },
    { t: 'table', head: ['Dark'], rows: [['`--a` `--b`']] },
  ]);
  assert.deepEqual(r, new Map([['--a', both('#112233')], ['--b', both('#112233')]]));
});

test('tables nested in block children and list items are visited', () => {
  const r = collectTokens([
    { t: 'blockquote', children: [{ t: 'table', head: ['Name', 'Value'], rows: [['`--a`', '#112233']] }] },
    { t: 'list', items: [{ children: [{ t: 'table', head: ['Name', 'Hex'], rows: [['`--b`', '#445566']] }] }] },
  ]);
  assert.deepEqual(r, new Map([['--a', both('#112233')], ['--b', both('#445566')]]));
});
