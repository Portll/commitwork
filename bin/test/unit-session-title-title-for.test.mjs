// Title of the session whose id or 8-char prefix matches the given id (bin/session-title.mjs titleFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFor } from '../session-title.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const ENV = ['HOME', 'CLAUDE_CONFIG_DIR'];

function slugsFor(p) {
  return [
    p.replace(/[^a-zA-Z0-9]/g, '-'),
    p.split(sep).join('-').split('.').join('-'),
    p.split(sep).join('-'),
  ];
}

function run(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'titleFor-'));
  const saved = ENV.map((k) => process.env[k]);
  try {
    const cwd = join(dir, 'repo');
    const home = join(dir, 'home');
    mkdirSync(cwd);
    process.env.HOME = home;
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude');
    const slugs = new Set();
    for (const p of [cwd, realpathSync(cwd)]) {
      for (const s of slugsFor(p)) slugs.add(s);
    }
    for (const slug of slugs) {
      const t = join(home, '.claude', 'projects', slug);
      mkdirSync(t, { recursive: true });
      for (const [name, [lines, mtime]] of Object.entries(files)) {
        const body = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
        writeFileSync(join(t, name), body);
        utimesSync(join(t, name), mtime, mtime);
      }
    }
    return fn(cwd);
  } finally {
    ENV.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
}

const ai = (t) => ({ type: 'ai-title', aiTitle: t });
const custom = (t) => ({ type: 'custom-title', customTitle: t });

test('falsy ids return null even when a session with an empty id exists', () => {
  run({ '.jsonl': [[ai('Blank')], 1000], 'abc12345.jsonl': [[ai('Alpha')], 2000] }, (cwd) => {
    assert.equal(titleFor('', cwd), null);
    assert.equal(titleFor(undefined, cwd), null);
    assert.equal(titleFor(null, cwd), null);
    assert.equal(titleFor(0, cwd), null);
  });
});

test('a full session id returns that session ai title', () => {
  run({ 'abc12345.jsonl': [[ai('Alpha')], 1000] }, (cwd) => {
    assert.equal(titleFor('abc12345', cwd), 'Alpha');
  });
});

test('an id that matches no session returns null', () => {
  run({ 'abc12345.jsonl': [[ai('Alpha')], 1000] }, (cwd) => {
    assert.equal(titleFor('zzzzzzzz', cwd), null);
  });
});

test('the eight character prefix of a longer id returns its title', () => {
  run({ 'abc12345-0000.jsonl': [[ai('Long')], 1000] }, (cwd) => {
    assert.equal(titleFor('abc12345', cwd), 'Long');
  });
});

test('a seven character prefix does not match a longer id', () => {
  run({ 'abc12345-0000.jsonl': [[ai('Long')], 1000] }, (cwd) => {
    assert.equal(titleFor('abc1234', cwd), null);
  });
});

test('a query longer than eight characters matches on its first eight', () => {
  run({ 'abc12345-0000.jsonl': [[ai('Long')], 1000] }, (cwd) => {
    assert.equal(titleFor('abc12345-9999', cwd), 'Long');
  });
});

test('a shared eight character prefix resolves to the newest session even for an older full id', () => {
  const files = {
    'abc12345-aaaa.jsonl': [[ai('Newer')], 2000],
    'abc12345-bbbb.jsonl': [[ai('Older')], 1000],
  };
  run(files, (cwd) => {
    assert.equal(titleFor('abc12345-bbbb', cwd), 'Newer');
  });
});

test('an older session is found by its own id when a newer unrelated session exists', () => {
  const files = {
    'aaaaaaaa1.jsonl': [[ai('Newer')], 2000],
    'bbbbbbbb2.jsonl': [[ai('Older')], 1000],
  };
  run(files, (cwd) => {
    assert.equal(titleFor('bbbbbbbb2', cwd), 'Older');
  });
});

test('the last custom title wins over earlier custom titles and the ai title', () => {
  const lines = [ai('Machine'), custom('First'), '{"type":"custom-title","customTitle":"Brok', custom('Second')];
  run({ 'cccccccc.jsonl': [lines, 1000] }, (cwd) => {
    assert.equal(titleFor('cccccccc', cwd), 'Second');
  });
});

test('a matching session without any title returns null', () => {
  run({ 'dddddddd.jsonl': [[{ type: 'user', message: 'hi' }, ai('')], 1000] }, (cwd) => {
    assert.equal(titleFor('dddddddd', cwd), null);
  });
});
