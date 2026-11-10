// The update choices picked in an interactive terminal session (bin/lib/checkbox-tui.mjs runPicker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPicker } from '../lib/checkbox-tui.mjs';

const MSG = 'the update picker needs an interactive terminal';

const fakes = (inTTY, outTTY) => {
  const log = [];
  const stdin = {
    isTTY: inTTY,
    isRaw: false,
    setRawMode: (v) => log.push(['setRawMode', v]),
    setEncoding: (e) => log.push(['setEncoding', e]),
    resume: () => log.push(['resume']),
    pause: () => log.push(['pause']),
    on: (ev) => log.push(['stdin.on', ev]),
    removeListener: (ev) => log.push(['stdin.removeListener', ev]),
  };
  const stdout = {
    isTTY: outTTY,
    columns: 80,
    rows: 24,
    write: (s) => log.push(['write', s]),
    on: (ev) => log.push(['stdout.on', ev]),
    removeListener: (ev) => log.push(['stdout.removeListener', ev]),
  };
  return { log, stdin, stdout };
};

const start = (inTTY, outTTY) => {
  const f = fakes(inTTY, outTTY);
  const p = runPicker({
    report: { name: 'demo', dir: 'demo', deps: [] },
    operator: { prod: [], dev: [] },
    repoPolicy: {},
    initial: { cursor: 0, types: ['patch'], unchecked: new Set(), lockfile: false, advisories: false, merge: false, trustRepo: false },
    stdin: f.stdin,
    stdout: f.stdout,
  });
  return { ...f, p };
};

test('rejects with the terminal error and touches nothing when stdin is not a terminal but stdout is', async () => {
  const { log, p } = start(undefined, true);
  await assert.rejects(p, { name: 'Error', message: MSG });
  assert.deepEqual(log, []);
});

test('rejects with the terminal error and touches nothing when stdout is not a terminal but stdin is', async () => {
  const { log, p } = start(true, false);
  await assert.rejects(p, { name: 'Error', message: MSG });
  assert.deepEqual(log, []);
});

test('rejects with the terminal error and touches nothing when neither stream is a terminal', async () => {
  const { log, p } = start(false, undefined);
  await assert.rejects(p, { name: 'Error', message: MSG });
  assert.deepEqual(log, []);
});

test('enters the alternate screen, raw mode and utf8 input before listening when both streams are terminals', () => {
  const { log, p } = start(true, true);
  p.catch(() => {});
  assert.deepEqual(log.slice(0, 6), [
    ['write', '\x1b[?1049h\x1b[?25l'],
    ['setRawMode', true],
    ['setEncoding', 'utf8'],
    ['resume'],
    ['stdin.on', 'data'],
    ['stdout.on', 'resize'],
  ]);
});

test('switches stdin into raw mode exactly once, with true, when both streams are terminals', () => {
  const { log, p } = start(true, true);
  p.catch(() => {});
  assert.deepEqual(log.filter(([k]) => k === 'setRawMode'), [['setRawMode', true]]);
});

test('neither pauses stdin nor removes any listener while the picker stays open', () => {
  const { log, p } = start(true, true);
  p.catch(() => {});
  assert.deepEqual(log.filter(([k]) => k === 'pause' || k.endsWith('removeListener')), []);
});
