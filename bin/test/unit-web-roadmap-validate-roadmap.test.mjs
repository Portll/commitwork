// Validates roadmap structure and item fields (bin/web-roadmap.mjs validateRoadmap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoadmap } from '../web-roadmap.mjs';

test('returns data when current is a string and cards is an empty array', () => {
  const data = { current: 'main', cards: [] };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when current is missing', () => {
  const data = { cards: [] };
  assert.throws(() => validateRoadmap(data, 'test'), /test: current: missing/);
});

test('throws when current is not a string', () => {
  const data = { current: 123, cards: [] };
  assert.throws(() => validateRoadmap(data, 'test'), /test: current: missing/);
});

test('throws when cards is missing', () => {
  const data = { current: 'main' };
  assert.throws(() => validateRoadmap(data, 'test'), /test: cards: missing/);
});

test('throws when cards is not an array', () => {
  const data = { current: 'main', cards: {} };
  assert.throws(() => validateRoadmap(data, 'test'), /test: cards: missing/);
});

test('throws when card has unknown key', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [], extra: 'x' }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\): unknown key "extra"/);
});

test('throws when card title is missing', () => {
  const data = {
    current: 'main',
    cards: [{ status: 'S', sub: 'S', items: [] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(undefined\): "title" missing/);
});

test('throws when card status is missing', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', sub: 'S', items: [] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\): "status" missing/);
});

test('throws when card sub is missing', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', items: [] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\): "sub" missing/);
});

test('throws when card items is missing', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S' }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\): "items" missing/);
});

test('throws when card items is not an array', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: {} }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\): "items" missing/);
});

test('throws when item has both name and lead', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', lead: 'L' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: needs exactly one of "name" and "lead"/);
});

test('throws when item has neither name nor lead', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ fact: 'F', ben: 'B' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: needs exactly one of "name" and "lead"/);
});

test('throws when item has fact but no ben', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', fact: 'F' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "fact" needs "ben"/);
});

test('returns data when item has name and fact with ben', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', fact: 'F', ben: 'B' }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when item added is not boolean', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', added: 'yes' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "added" is not true or false/);
});

test('returns data when item added is true', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', added: true }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('returns data when item added is false', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', added: false }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when item spine does not match pattern', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', spine: 'bad' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "spine" is not "<plan id> <task id>"/);
});

test('returns data when item spine matches pattern', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', spine: 'abc-roadmap 1.2.3' }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when item commits is not an array', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: 'abc1234' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "commits" is not a list of hex shas/);
});

test('throws when item commits is empty array', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: [] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "commits" is not a list of hex shas/);
});

test('throws when item commits contains non-hex string', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['xyz1234'] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "commits" is not a list of hex shas/);
});

test('returns data when item commits is valid hex sha', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'] }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when item work is not an array', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: 'x' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" needs one entry per commit/);
});

test('throws when item work length does not match commits length', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234', 'def5678'], work: [{ date: '2024-01-01', what: 'w' }] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" needs one entry per commit/);
});

test('throws when work entry has wrong keys', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: [{ date: '2024-01-01', what: 'w', extra: 'x' }] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" entry 1 is not {date: YYYY-MM-DD, what}/);
});

test('throws when work entry date is not YYYY-MM-DD', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: [{ date: '2024-1-1', what: 'w' }] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" entry 1 is not {date: YYYY-MM-DD, what}/);
});

test('throws when work entry what is not a string', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: [{ date: '2024-01-01', what: 123 }] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" entry 1 is not {date: YYYY-MM-DD, what}/);
});

test('throws when work entry what is empty string', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: [{ date: '2024-01-01', what: '' }] }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: "work" entry 1 is not {date: YYYY-MM-DD, what}/);
});

test('returns data when work entry is valid', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', commits: ['abc1234'], work: [{ date: '2024-01-01', what: 'w' }] }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when item has unknown key', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N', unknown: 'x' }] }]
  };
  assert.throws(() => validateRoadmap(data, 'test'), /test: card 1 \(T\), item 1: unknown key "unknown"/);
});

test('returns data for valid card with lead item', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ lead: 'L' }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('returns data for valid card with multiple items', () => {
  const data = {
    current: 'main',
    cards: [{ title: 'T', status: 'S', sub: 'S', items: [{ name: 'N1' }, { lead: 'L2' }] }]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('returns data for multiple valid cards', () => {
  const data = {
    current: 'main',
    cards: [
      { title: 'T1', status: 'S1', sub: 'S1', items: [{ name: 'N1' }] },
      { title: 'T2', status: 'S2', sub: 'S2', items: [{ lead: 'L2' }] }
    ]
  };
  assert.strictEqual(validateRoadmap(data, 'test'), data);
});

test('throws when data is null', () => {
  assert.throws(() => validateRoadmap(null, 'test'), /test: current: missing/);
});

test('throws when data is undefined', () => {
  assert.throws(() => validateRoadmap(undefined, 'test'), /test: current: missing/);
});
