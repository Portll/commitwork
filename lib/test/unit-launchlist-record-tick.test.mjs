// Recording a launchlist tick into the state's ticks and log (lib/launchlist.mjs recordTick).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordTick } from '../launchlist.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const spec = { items: [{ id: 'item1', profile: 'publication' }] };

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'recordTick-'));
  const prev = process.env.CW_LAUNCHLIST_DIR;
  process.env.CW_LAUNCHLIST_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.CW_LAUNCHLIST_DIR; else process.env.CW_LAUNCHLIST_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a project name that is not a safe slug throws before anything else is checked', () => inDir(() => {
  const state = { ticks: {}, log: [] };
  assert.throws(() => recordTick(state, 'bad slug', 'item1', { by: 'alice', at: 'T0', spec, config: {} }), { name: 'Error', message: 'launchlist: not a project slug: "bad slug"' });
  assert.throws(() => recordTick(state, 'a..b', 'item1', { by: 'alice', at: 'T0', spec, config: {} }), { name: 'Error', message: 'launchlist: not a project slug: "a..b"' });
  assert.deepEqual(state, { ticks: {}, log: [] });
}));

test('a tick state outside done, na and open is refused as invalid and changes nothing', () => inDir(() => {
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { state: 'bogus', note: 'n', by: 'alice', at: 'T0', spec, config: {} });
  assert.deepEqual(r, { ok: false, refused: 'invalid', errors: ['state must be one of done, na, open'] });
  assert.deepEqual(state, { ticks: {}, log: [] });
}));

test('a tick without an identity is refused', () => inDir(() => {
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { state: 'done', note: 'n', at: 'T0', spec, config: {} });
  assert.deepEqual(r, { ok: false, refused: 'no-identity', errors: ['a tick needs an identity'] });
  assert.deepEqual(state, { ticks: {}, log: [] });
}));

test('a tick for an item that is not on the project list is refused as having no subject', () => inDir(() => {
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'missing', { state: 'done', note: 'n', by: 'alice', at: 'T0', spec, config: {} });
  assert.deepEqual(r, { ok: false, refused: 'no-subject', errors: ["missing is not on proj's list"] });
  assert.deepEqual(state, { ticks: {}, log: [] });
}));

test('a done tick with a short note is stored under the project and logged', () => inDir(() => {
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { note: 'hello', by: 'alice', at: 'T1', spec, config: {} });
  const tick = { state: 'done', note: 'hello', by: 'alice', at: 'T1', evidenceDigest: null };
  assert.deepEqual(r, { ok: true, tick, noteFile: null, noteChars: null });
  assert.deepEqual(state, { ticks: { proj: { item1: tick } }, log: [{ at: 'T1', by: 'alice', project: 'proj', item: 'item1', action: 'tick-done', note: 'hello' }] });
}));

test('an open tick removes the item from the ticks map, keeps the other items and logs the note', () => inDir(() => {
  const other = { state: 'na', note: 'keep', by: 'carol', at: 'T0', evidenceDigest: null };
  const state = { ticks: { proj: { item1: { state: 'done', note: 'old', by: 'bob', at: 'T0', evidenceDigest: null }, item2: other } }, log: [] };
  const r = recordTick(state, 'proj', 'item1', { state: 'open', note: 'reopened', by: 'alice', at: 'T2', spec, config: {} });
  assert.deepEqual(r, { ok: true, tick: { state: 'open', note: 'reopened', by: 'alice', at: 'T2', evidenceDigest: null }, noteFile: null, noteChars: null });
  assert.deepEqual(state, { ticks: { proj: { item2: other } }, log: [{ at: 'T2', by: 'alice', project: 'proj', item: 'item1', action: 'tick-open', note: 'reopened' }] });
}));

test('a checked item carries the digest of its stored result, or null when no results file exists', () => inDir((dir) => {
  const cspec = { items: [{ id: 'item1', profile: 'publication', check: 'c' }] };
  const state = { ticks: {}, log: [] };
  const a = recordTick(state, 'proj', 'item1', { state: 'na', by: 'bob', at: 'T3', spec: cspec, config: {} });
  assert.deepEqual(a, { ok: true, tick: { state: 'na', note: '', by: 'bob', at: 'T3', evidenceDigest: null }, noteFile: null, noteChars: null });
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeFileSync(join(dir, 'results', 'proj.json'), JSON.stringify({ results: { item1: { status: 'pass', summary: 'ok', evidence: ['e1'] } } }));
  const digest = createHash('sha256').update('{"status":"pass","summary":"ok","evidence":["e1"]}').digest('hex').slice(0, 16);
  const b = recordTick(state, 'proj', 'item1', { state: 'done', note: 'measured', by: 'bob', at: 'T4', spec: cspec, config: {} });
  const tick = { state: 'done', note: 'measured', by: 'bob', at: 'T4', evidenceDigest: digest };
  assert.deepEqual(b, { ok: true, tick, noteFile: null, noteChars: null });
  assert.deepEqual(state.ticks, { proj: { item1: tick } });
}));

test('a note of exactly the inline cap stays inline and writes no note file', () => inDir((dir) => {
  const note = 'y'.repeat(4000);
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { note, by: 'alice', at: 'T5', spec, config: {} });
  assert.deepEqual(r, { ok: true, tick: { state: 'done', note, by: 'alice', at: 'T5', evidenceDigest: null }, noteFile: null, noteChars: null });
  assert.equal(existsSync(join(dir, 'notes')), false);
}));

test('a note one character over the cap is spilled whole to a file and kept inline as its head and a pointer', () => inDir((dir) => {
  const note = 'a' + 'x'.repeat(4000);
  const rel = join('notes', 'proj', `item1-${createHash('sha256').update(note, 'utf8').digest('hex').slice(0, 12)}.md`);
  const inline = 'a' + 'x'.repeat(3999) + '\n\u2026 4001 characters in full, kept at ' + rel;
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { note, by: 'alice', at: 'T6', spec, config: {} });
  const tick = { state: 'done', note: inline, by: 'alice', at: 'T6', evidenceDigest: null, noteFile: rel, noteChars: 4001 };
  assert.deepEqual(r, { ok: true, tick, noteFile: rel, noteChars: 4001 });
  assert.equal(readFileSync(join(dir, rel), 'utf8'), `${note}\n`);
  assert.deepEqual(state, { ticks: { proj: { item1: tick } }, log: [{ at: 'T6', by: 'alice', project: 'proj', item: 'item1', action: 'tick-done', note: inline, noteFile: rel, noteChars: 4001 }] });
}));

test('a long note that cannot be written to the store refuses the tick and records nothing', () => inDir((dir) => {
  writeFileSync(join(dir, 'notes'), 'blocker');
  const state = { ticks: {}, log: [] };
  const r = recordTick(state, 'proj', 'item1', { note: 'z'.repeat(4001), by: 'alice', at: 'T7', spec, config: {} });
  const head = 'the note is 4001 characters and could not be written to the store: ';
  assert.deepEqual({ ...r, errors: r.errors.map((e) => e.slice(0, head.length)) }, { ok: false, refused: 'note-unwritable', errors: [head] });
  assert.deepEqual(state, { ticks: {}, log: [] });
}));
