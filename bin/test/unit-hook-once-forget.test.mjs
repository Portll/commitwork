// Deletes hook-once state records, one key or all, and journals the forgetting (bin/hook-once.mjs forget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forget } from '../hook-once.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'forget-'));
  process.env.CW_HOOK_STATE = dir;
  try {
    fn(dir);
  } finally {
    delete process.env.CW_HOOK_STATE;
    rmSync(dir, { recursive: true, force: true });
  }
};

const events = (dir, key) =>
  readFileSync(join(dir, `${key}.events.jsonl`), 'utf8').trim().split('\n').map((line) => {
    const { at, ...rest } = JSON.parse(line);
    return rest;
  });

test('keyless reset removes every record file and keeps the event journals', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.json'), '{}');
  writeFileSync(join(dir, 'b.json'), '{}');
  writeFileSync(join(dir, 'a.events.jsonl'), 'line\n');
  assert.equal(forget(), undefined);
  assert.deepEqual(readdirSync(dir).sort(), ['a.events.jsonl']);
  assert.equal(readFileSync(join(dir, 'a.events.jsonl'), 'utf8'), 'line\n');
}));

test('an empty string key resets all records just like no key', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.json'), '{}');
  writeFileSync(join(dir, 'a.events.jsonl'), 'line\n');
  assert.equal(forget('', 'why'), undefined);
  assert.deepEqual(readdirSync(dir).sort(), ['a.events.jsonl']);
}));

test('keyless reset of a missing state directory changes nothing', () => withDir((dir) => {
  process.env.CW_HOOK_STATE = join(dir, 'absent');
  assert.equal(forget(), undefined);
  assert.deepEqual(readdirSync(dir), []);
}));

test('keyless reset skips a listed record that is already gone and still removes the next one', () => withDir((dir) => {
  const deep = join(dir, 'deep');
  mkdirSync(join(deep, 't.events.jsonl'), { recursive: true });
  writeFileSync(join(deep, 'a.json'), '{}');
  writeFileSync(join(deep, 'b.json'), '{}');
  symlinkSync(join(deep, 't.events.jsonl'), join(dir, 'link'));
  const second = readdirSync(deep).filter((f) => !f.endsWith('.events.jsonl'))[1];
  writeFileSync(join(dir, second), '{}');
  process.env.CW_HOOK_STATE = `${dir}/link/..`;
  forget();
  assert.equal(existsSync(join(dir, second)), false);
  assert.deepEqual(readdirSync(deep).sort(), ['a.json', 'b.json', 't.events.jsonl']);
}));

test('forgetting a key removes only its record and journals forgotten with the reason', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.json'), '{}');
  writeFileSync(join(dir, 'b.json'), '{}');
  assert.equal(forget('a', 'done'), undefined);
  assert.equal(existsSync(join(dir, 'a.json')), false);
  assert.equal(existsSync(join(dir, 'b.json')), true);
  assert.deepEqual(events(dir, 'a'), [{ v: 1, key: 'a', event: 'forgotten', reason: 'done', prev: 'genesis' }]);
}));

test('forgetting a key with an empty reason journals the event without a reason field', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.json'), '{}');
  forget('a', '');
  assert.equal(existsSync(join(dir, 'a.json')), false);
  assert.deepEqual(events(dir, 'a'), [{ v: 1, key: 'a', event: 'forgotten', prev: 'genesis' }]);
}));

test('forgetting a key with no record still journals the forgotten event', () => withDir((dir) => {
  forget('a', 'gone');
  assert.equal(existsSync(join(dir, 'a.json')), false);
  assert.deepEqual(events(dir, 'a'), [{ v: 1, key: 'a', event: 'forgotten', reason: 'gone', prev: 'genesis' }]);
}));

test('forgetting an unsafe key uses the sanitized name for both record and journal', () => withDir((dir) => {
  writeFileSync(join(dir, 'x_y_z.json'), '{}');
  forget('x/y z', 'r');
  assert.equal(existsSync(join(dir, 'x_y_z.json')), false);
  assert.equal(existsSync(join(dir, 'x')), false);
  assert.deepEqual(events(dir, 'x_y_z'), [{ v: 1, key: 'x_y_z', event: 'forgotten', reason: 'r', prev: 'genesis' }]);
}));
