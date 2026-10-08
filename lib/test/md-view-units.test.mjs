// lib/test/md-view-units.test.mjs — case tests for collectTokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTokens } from '../md-view.mjs';

test('collectTokens returns empty Map for empty blocks', () => {
  const result = collectTokens([]);
  assert.ok(result instanceof Map);
  assert.equal(result.size, 0);
});

test('collectTokens ignores non-table blocks', () => {
  const blocks = [{ t: 'p', children: [] }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 0);
});

test('collectTokens extracts token from table with value column', () => {
  const blocks = [{
    t: 'table',
    head: ['Token', 'Value'],
    rows: [['`--primary`', '`#ff0000`']]
  }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 1);
  assert.ok(result.has('--primary'));
  assert.equal(result.get('--primary').dark, '#ff0000');
  assert.equal(result.get('--primary').light, '#ff0000');
});

test('collectTokens extracts dark and light from separate columns', () => {
  const blocks = [{
    t: 'table',
    head: ['Token', 'Dark', 'Light'],
    rows: [['`--bg`', '`#000000`', '`#ffffff`']]
  }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 1);
  assert.ok(result.has('--bg'));
  assert.equal(result.get('--bg').dark, '#000000');
  assert.equal(result.get('--bg').light, '#ffffff');
});

test('collectTokens skips rows without valid token names', () => {
  const blocks = [{
    t: 'table',
    head: ['Token', 'Value'],
    rows: [['not-a-token', '`#ff0000`']]
  }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 0);
});

test('collectTokens skips tables without recognized headers', () => {
  const blocks = [{
    t: 'table',
    head: ['Foo', 'Bar'],
    rows: [['`--x`', '`#ff0000`']]
  }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 0);
});

test('collectTokens does not overwrite existing tokens', () => {
  const blocks = [{
    t: 'table',
    head: ['Token', 'Value'],
    rows: [
      ['`--a`', '`#111111`'],
      ['`--a`', '`#222222`']
    ]
  }];
  const result = collectTokens(blocks);
  assert.equal(result.size, 1);
  assert.equal(result.get('--a').dark, '#111111');
});
