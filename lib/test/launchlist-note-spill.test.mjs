// A note is the durable record of a measurement, so it must not be cut in silence in the tick or
// the log. These assert the note survives, that a note which cannot be kept refuses the tick, and
// that the spilled copy is readable back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTE_INLINE_MAX, recordTick, loadSpec, notesDir, launchlistDir } from '../launchlist.mjs';

const spec = loadSpec();
const ITEM = 'pub.repo.readme';
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-note-spill-'));
  process.env.CW_LAUNCHLIST_DIR = dir;
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ projects: { demo: { profiles: ['publication'] } } }));
  return dir;
};
const blank = () => ({ version: 1, ticks: {}, items: {}, log: [] });
const tick = (state, note) => recordTick(state, 'demo', ITEM, { note, by: 'test', spec, config: { projects: { demo: {} } } });

test('a note within the inline limit is kept whole and spills nothing', (t) => {
  const dir = fresh(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = blank();
  const note = 'x'.repeat(NOTE_INLINE_MAX);
  const out = tick(state, note);
  assert.equal(out.ok, true);
  assert.equal(out.tick.note, note, 'held inline, unshortened');
  assert.equal(out.noteFile, null);
  assert.equal(out.tick.noteFile, undefined);
  assert.throws(() => readdirSync(notesDir()), /ENOENT/, 'no notes directory is created');
});

test('a longer note is written whole, and the inline copy says where', (t) => {
  const dir = fresh(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = blank();
  const note = `HEAD${'y'.repeat(NOTE_INLINE_MAX)}TAIL`;
  const out = tick(state, note);
  assert.equal(out.ok, true);
  assert.ok(out.noteFile, 'a spill path is reported');
  assert.equal(out.noteChars, note.length);
  assert.equal(readFileSync(join(launchlistDir(), out.noteFile), 'utf8'), `${note}\n`, 'the whole note is on disk');
  assert.ok(out.tick.note.includes(out.noteFile), 'the inline copy points at it');
  assert.ok(out.tick.note.startsWith('HEAD'), 'and keeps its head');
  assert.ok(!out.tick.note.includes('TAIL'), 'the inline copy is still bounded');
  assert.equal(state.log.at(-1).noteFile, out.noteFile, 'the log entry carries the pointer too');
});

test('the spilled note is private: 0600 on the file, 0700 on its directory', (t) => {
  if (process.platform === 'win32') return t.skip('no POSIX modes on win32');
  const dir = fresh(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = tick(blank(), 'z'.repeat(NOTE_INLINE_MAX + 1));
  assert.equal(statSync(join(launchlistDir(), out.noteFile)).mode & 0o777, 0o600);
  assert.equal(statSync(notesDir()).mode & 0o777, 0o700);
});

test('the same note twice is the same file, not two', (t) => {
  const dir = fresh(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const note = 'w'.repeat(NOTE_INLINE_MAX + 50);
  const a = tick(blank(), note);
  const b = tick(blank(), note);
  assert.equal(a.noteFile, b.noteFile, 'content-addressed, so re-recording is idempotent');
  assert.equal(readdirSync(join(notesDir(), 'demo')).length, 1);
});

test('a different note is a different file', (t) => {
  const dir = fresh(); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = tick(blank(), 'a'.repeat(NOTE_INLINE_MAX + 1));
  const b = tick(blank(), 'b'.repeat(NOTE_INLINE_MAX + 1));
  assert.notEqual(a.noteFile, b.noteFile);
  assert.equal(readdirSync(join(notesDir(), 'demo')).length, 2);
});

test('a note that cannot be written REFUSES the tick rather than shortening it', (t) => {
  if (process.platform === 'win32') return t.skip('no POSIX modes on win32');
  if (process.getuid && process.getuid() === 0) return t.skip('root ignores the unwritable directory');
  const dir = fresh(); t.after(() => { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); });
  mkdirSync(notesDir(), { recursive: true });
  chmodSync(notesDir(), 0o500);                        // readable, not writable
  const state = blank();
  const out = tick(state, 'q'.repeat(NOTE_INLINE_MAX + 1));
  assert.equal(out.ok, false);
  assert.equal(out.refused, 'note-unwritable');
  assert.match(out.errors[0], /characters and could not be written/);
  assert.deepEqual(state.ticks, {}, 'no tick was recorded');
  assert.deepEqual(state.log, [], 'and nothing was logged as though it had been');
});
