// Counts primary verdicts per row in a TOP-100 markdown document (bin/top100-html.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../top100-html.mjs';

test('returns zeroed buckets for empty input', () => {
  const result = tally('');
  assert.deepEqual(result, { classes: 0, provable: 0, uninstalled: 0, indicative: 0, unobservable: 0, partial: 0 });
});

test('counts a single Flaw row with Provable verdict', () => {
  const md = '`Flaw` **Provable** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.provable, 1);
  assert.equal(result.uninstalled, 0);
  assert.equal(result.indicative, 0);
  assert.equal(result.unobservable, 0);
  assert.equal(result.partial, 0);
});

test('counts a single Gap row with Unobservable verdict', () => {
  const md = '`Gap` **Unobservable** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.unobservable, 1);
  assert.equal(result.provable, 0);
  assert.equal(result.indicative, 0);
  assert.equal(result.partial, 0);
});

test('counts a single Process row with Partial verdict', () => {
  const md = '`Process` **Partial** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.partial, 1);
  assert.equal(result.provable, 0);
  assert.equal(result.indicative, 0);
  assert.equal(result.unobservable, 0);
});

test('counts a single Flaw row with Indicative verdict', () => {
  const md = '`Flaw` **Indicative** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.indicative, 1);
  assert.equal(result.provable, 0);
  assert.equal(result.uninstalled, 0);
  assert.equal(result.unobservable, 0);
  assert.equal(result.partial, 0);
});

test('resolves Provable (uninstalled) to uninstalled bucket not provable', () => {
  const md = '`Flaw` **Provable (uninstalled)** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.uninstalled, 1);
  assert.equal(result.provable, 0);
  assert.equal(result.indicative, 0);
  assert.equal(result.unobservable, 0);
  assert.equal(result.partial, 0);
});

test('resolves Provable (deep) to uninstalled bucket not provable', () => {
  const md = '`Gap` **Provable (deep)** some text';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.uninstalled, 1);
  assert.equal(result.provable, 0);
  assert.equal(result.indicative, 0);
  assert.equal(result.unobservable, 0);
  assert.equal(result.partial, 0);
});

test('ignores lines that do not start with a class marker', () => {
  const md = 'some text\n**Provable** no marker\n`Flaw` **Provable** valid';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.provable, 1);
});

test('tallies multiple rows across different verdicts', () => {
  const md = [
    '`Flaw` **Provable** a',
    '`Gap` **Unobservable** b',
    '`Process` **Partial** c',
    '`Flaw` **Indicative** d',
    '`Gap` **Provable (uninstalled)** e'
  ].join('\n');
  const result = tally(md);
  assert.equal(result.classes, 5);
  assert.equal(result.provable, 1);
  assert.equal(result.unobservable, 1);
  assert.equal(result.partial, 1);
  assert.equal(result.indicative, 1);
  assert.equal(result.uninstalled, 1);
});

test('counts only the first verdict when multiple appear on one line', () => {
  const md = '`Flaw` **Provable** and **Unobservable** pair';
  const result = tally(md);
  assert.equal(result.classes, 1);
  assert.equal(result.provable, 1);
  assert.equal(result.unobservable, 0);
});
