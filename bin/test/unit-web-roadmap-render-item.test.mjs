// Renders a roadmap item as an HTML list element (bin/web-roadmap.mjs renderItem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderItem } from '../web-roadmap.mjs';

test('renders a minimal item with just a name', () => {
  const item = { name: 'Alpha' };
  const expected = '<li><b>Alpha</b></li>';
  assert.equal(renderItem(item), expected);
});

test('uses provided lead instead of name', () => {
  const item = { name: 'Alpha', lead: '<b>Custom Lead</b>' };
  const expected = '<li><b>Custom Lead</b></li>';
  assert.equal(renderItem(item), expected);
});

test('appends benefit and fact when present', () => {
  const item = { name: 'Alpha', ben: 'Speed', fact: '2x faster' };
  const expected = '<li><b>Alpha</b>: <span class="ben">Speed</span> 2x faster</li>';
  assert.equal(renderItem(item), expected);
});

test('appends benefit without fact', () => {
  const item = { name: 'Alpha', ben: 'Speed' };
  const expected = '<li><b>Alpha</b>: <span class="ben">Speed</span></li>';
  assert.equal(renderItem(item), expected);
});

test('renders sub-items as a list', () => {
  const item = { name: 'Alpha', sub: ['One', 'Two'] };
  const expected = '<li><b>Alpha</b><ul class="sub"><li>One</li><li>Two</li></ul></li>';
  assert.equal(renderItem(item), expected);
});

test('renders note and limit in a span', () => {
  const item = { name: 'Alpha', note: 'Careful', limit: '100' };
  const expected = '<li><b>Alpha</b><span class="limit">Careful <b>Limit:</b> 100</span></li>';
  assert.equal(renderItem(item), expected);
});

test('renders only note without limit', () => {
  const item = { name: 'Alpha', note: 'Careful' };
  const expected = '<li><b>Alpha</b><span class="limit">Careful</span></li>';
  assert.equal(renderItem(item), expected);
});

test('renders only limit without note', () => {
  const item = { name: 'Alpha', limit: '100' };
  const expected = '<li><b>Alpha</b><span class="limit"><b>Limit:</b> 100</span></li>';
  assert.equal(renderItem(item), expected);
});

test('renders a live pill for in progress', () => {
  const item = { name: 'Alpha', pill: 'in progress' };
  const expected = '<li><b>Alpha</b><span class="pill live">in progress</span></li>';
  assert.equal(renderItem(item), expected);
});

test('renders work details with singular change', () => {
  const item = { name: 'Alpha', work: [{ date: '2024-01-01', what: 'Fixed bug' }] };
  const expected = '<li><b>Alpha</b><details class="work"><summary>1 change</summary><ul><li><time datetime="2024-01-01">2024-01-01</time> Fixed bug</li></ul></details></li>';
  assert.equal(renderItem(item), expected);
});

test('renders work details with plural changes', () => {
  const item = { name: 'Alpha', work: [{ date: '2024-01-01', what: 'A' }, { date: '2024-01-02', what: 'B' }] };
  const expected = '<li><b>Alpha</b><details class="work"><summary>2 changes</summary><ul><li><time datetime="2024-01-01">2024-01-01</time> A</li><li><time datetime="2024-01-02">2024-01-02</time> B</li></ul></details></li>';
  assert.equal(renderItem(item), expected);
});

test('renders additional pill when added is true', () => {
  const item = { name: 'Alpha', added: true };
  const expected = '<li><b>Alpha</b><span class="pill add">additional</span></li>';
  assert.equal(renderItem(item), expected);
});
