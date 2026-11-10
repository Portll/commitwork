// Roster rows mirrored from session titles, with contradicted bindings refused (bin/session-roster.mjs mirror).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirror } from '../session-roster.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = '2026-01-01T00:00:00.000Z';
const strip = ({ tree, ...rest }) => rest;

const run = (rows, list) => {
  const dir = mkdtempSync(join(tmpdir(), 'mirror-'));
  try {
    const p = join(dir, 'sessions.jsonl');
    writeFileSync(p, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    const r = mirror({ path: p, now: NOW, readSessions: () => list });
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { result: { ...r, added: r.added.map(strip) }, lines: lines.map(strip) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('adds a session whose title carries a new cw name, lowercased', () => {
  const { result, lines } = run([], [{ id: 'u1', title: 'x (cwAB) y' }]);
  const rec = { name: 'ab', id: 'u1', title: 'x (cwAB) y', at: NOW, via: 'title-mirror' };
  assert.deepEqual(result, { added: [rec], unseen: 0, refused: [] });
  assert.deepEqual(lines, [rec]);
});

test('counts titles without a two character cw name as unseen', () => {
  const { result, lines } = run([], [
    { id: 'u1', title: 'plain' }, { id: 'u2' }, { id: 'u3', title: '(cwa) short' }]);
  assert.deepEqual(result, { added: [], unseen: 3, refused: [] });
  assert.deepEqual(lines, []);
});

test('skips a held name and id but adds the same name under a new id', () => {
  const row = { name: 'ab', id: 'u1', via: 'observed' };
  const { result, lines } = run([row], [{ id: 'u1', title: '(cwab)' }, { id: 'u2', title: '(cwab)' }]);
  const rec = { name: 'ab', id: 'u2', title: '(cwab)', at: NOW, via: 'title-mirror' };
  assert.deepEqual(result, { added: [rec], unseen: 0, refused: [] });
  assert.deepEqual(lines, [row, rec]);
});

test('refuses a title that contradicts an observed binding of the same id', () => {
  const row = { name: 'ab', id: 'u1', via: 'observed' };
  const { result, lines } = run([row], [{ id: 'u1', title: 't (cwcd)' }]);
  assert.deepEqual(result, {
    added: [], unseen: 0,
    refused: [{ id: 'u1', titleName: 'cd', boundName: 'ab', boundVia: 'observed', title: 't (cwcd)' }],
  });
  assert.deepEqual(lines, [row]);
});

test('refuses a peer-header contradiction but adds over an unranked binding', () => {
  const rows = [{ name: 'ab', id: 'u1', via: 'peer-header' }, { name: 'cd', id: 'u2', via: 'manual' }];
  const { result, lines } = run(rows, [{ id: 'u1', title: '(cwee)' }, { id: 'u2', title: '(cwff)' }]);
  const rec = { name: 'ff', id: 'u2', title: '(cwff)', at: NOW, via: 'title-mirror' };
  assert.deepEqual(result, {
    added: [rec], unseen: 0,
    refused: [{ id: 'u1', titleName: 'ee', boundName: 'ab', boundVia: 'peer-header', title: '(cwee)' }],
  });
  assert.deepEqual(lines, [...rows, rec]);
});

test('adds a title that contradicts an equal-ranked title-mirror binding', () => {
  const row = { name: 'ab', id: 'u1', via: 'title-mirror' };
  const { result, lines } = run([row], [{ id: 'u1', title: 't (cwcd)' }]);
  const rec = { name: 'cd', id: 'u1', title: 't (cwcd)', at: NOW, via: 'title-mirror' };
  assert.deepEqual(result, { added: [rec], unseen: 0, refused: [] });
  assert.deepEqual(lines, [row, rec]);
});

test('keeps the first of two equal-ranked bindings as the one a title contradicts', () => {
  const rows = [{ name: 'ab', id: 'u1', via: 'observed' }, { name: 'cd', id: 'u1', via: 'observed' }];
  const { result, lines } = run(rows, [{ id: 'u1', title: '(cwee)' }]);
  assert.deepEqual(result, {
    added: [], unseen: 0,
    refused: [{ id: 'u1', titleName: 'ee', boundName: 'ab', boundVia: 'observed', title: '(cwee)' }],
  });
  assert.deepEqual(lines, rows);
});

test('lets a later higher-ranked binding replace an earlier lower-ranked one', () => {
  const rows = [{ name: 'ab', id: 'u1', via: 'title-mirror' }, { name: 'cd', id: 'u1', via: 'observed' }];
  const { result, lines } = run(rows, [{ id: 'u1', title: '(cwee)' }]);
  assert.deepEqual(result, {
    added: [], unseen: 0,
    refused: [{ id: 'u1', titleName: 'ee', boundName: 'cd', boundVia: 'observed', title: '(cwee)' }],
  });
  assert.deepEqual(lines, rows);
});

test('keeps an earlier higher-ranked binding over a later lower-ranked one', () => {
  const rows = [{ name: 'ab', id: 'u1', via: 'observed' }, { name: 'cd', id: 'u1', via: 'title-mirror' }];
  const { result, lines } = run(rows, [{ id: 'u1', title: '(cwee)' }]);
  assert.deepEqual(result, {
    added: [], unseen: 0,
    refused: [{ id: 'u1', titleName: 'ee', boundName: 'ab', boundVia: 'observed', title: '(cwee)' }],
  });
  assert.deepEqual(lines, rows);
});

test('ignores roster rows without an id when looking for a contradiction', () => {
  const row = { name: 'ab', via: 'observed' };
  const { result, lines } = run([row], [{ title: '(cwcd)' }]);
  assert.deepEqual(result, {
    added: [{ name: 'cd', id: undefined, title: '(cwcd)', at: NOW, via: 'title-mirror' }],
    unseen: 0, refused: [],
  });
  assert.deepEqual(lines, [row, { name: 'cd', title: '(cwcd)', at: NOW, via: 'title-mirror' }]);
});
