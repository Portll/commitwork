// Lists transcript sessions with their titles and mtimes, newest first (bin/session-title.mjs sessions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessions } from '../session-title.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const line = (o) => JSON.stringify(o);

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sessions-'));
  const keys = ['HOME', 'CLAUDE_CONFIG_DIR'];
  const saved = keys.map((k) => process.env[k]);
  try {
    const cwd = realpathSync(dir);
    process.env.HOME = dir;
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude');
    const names = new Set([cwd.replace(/[^a-zA-Z0-9]/g, '-'), cwd.replace(/[\\/]/g, '-'), cwd.replace(/[\\/.]/g, '-')]);
    for (const base of [join(dir, '.claude'), join(dir, '.config', 'claude')]) {
      for (const n of files ? names : []) {
        const tdir = join(base, 'projects', n);
        mkdirSync(tdir, { recursive: true });
        for (const [name, body, secs] of files) {
          const p = join(tdir, name);
          if (body === null) { symlinkSync(join(dir, 'missing'), p); continue; }
          writeFileSync(p, body);
          utimesSync(p, secs, secs);
        }
      }
    }
    return sessions(cwd);
  } finally {
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns an empty array when the transcript directory does not exist', () => {
  assert.deepEqual(run(null), []);
});

test('reports a custom title with source custom and an eight character short id', () => {
  const r = run([['0123456789abcdef.jsonl', line({ type: 'custom-title', customTitle: 'Fix gate' }) + '\n', 1000]]);
  assert.deepEqual(r, [{ id: '0123456789abcdef', short: '01234567', title: 'Fix gate', source: 'custom', mtime: 1000000 }]);
});

test('reports an ai title with source ai when there is no custom title', () => {
  const r = run([['fedcba9876543210.jsonl', line({ type: 'ai-title', aiTitle: 'Auto name' }) + '\n', 2000]]);
  assert.deepEqual(r, [{ id: 'fedcba9876543210', short: 'fedcba98', title: 'Auto name', source: 'ai', mtime: 2000000 }]);
});

test('the last non-empty custom title wins over earlier ones and over the ai title', () => {
  const body = [
    line({ type: 'custom-title', customTitle: 'First' }),
    line({ type: 'ai-title', aiTitle: 'Guess' }),
    line({ type: 'custom-title', customTitle: 'Second' }),
    line({ type: 'custom-title', customTitle: '' }),
    line({ type: 'ai-title', aiTitle: '' }),
  ].join('\n');
  const r = run([['abcdefgh12345678.jsonl', body, 1000]]);
  assert.deepEqual(r, [{ id: 'abcdefgh12345678', short: 'abcdefgh', title: 'Second', source: 'custom', mtime: 1000000 }]);
});

test('a title field only counts when the line type matches it', () => {
  const r = run([
    ['aaaaaaaa0001.jsonl', line({ type: 'ai-title', aiTitle: 'Real ai', customTitle: 'Sneaky' }), 2000],
    ['bbbbbbbb0002.jsonl', line({ type: 'custom-title', aiTitle: 'Stray' }), 1000],
  ]);
  assert.deepEqual(r, [
    { id: 'aaaaaaaa0001', short: 'aaaaaaaa', title: 'Real ai', source: 'ai', mtime: 2000000 },
    { id: 'bbbbbbbb0002', short: 'bbbbbbbb', title: null, source: null, mtime: 1000000 },
  ]);
});

test('a line whose raw text lacks a quoted title marker is skipped even if it parses as a title', () => {
  const body = [line({ type: 'ai-title', aiTitle: 'Plain' }), '{"type":"custom\\u002dtitle","customTitle":"Hidden"}'].join('\n');
  const r = run([['cccccccc0003.jsonl', body, 3000]]);
  assert.deepEqual(r, [{ id: 'cccccccc0003', short: 'cccccccc', title: 'Plain', source: 'ai', mtime: 3000000 }]);
});

test('a truncated title line at the tail is ignored and earlier titles are kept', () => {
  const body = line({ type: 'ai-title', aiTitle: 'Kept' }) + '\n' + '{"type":"custom-title","customTi';
  const r = run([['ffffffff0006.jsonl', body, 1000]]);
  assert.deepEqual(r, [{ id: 'ffffffff0006', short: 'ffffffff', title: 'Kept', source: 'ai', mtime: 1000000 }]);
});

test('a transcript whose stat and read fail is listed with mtime 0 and no title after newer files', () => {
  const r = run([
    ['dddddddd0004.jsonl', null],
    ['eeeeeeee0005.jsonl', line({ type: 'custom-title', customTitle: 'Live' }), 1000],
  ]);
  assert.deepEqual(r, [
    { id: 'eeeeeeee0005', short: 'eeeeeeee', title: 'Live', source: 'custom', mtime: 1000000 },
    { id: 'dddddddd0004', short: 'dddddddd', title: null, source: null, mtime: 0 },
  ]);
});

test('sorts sessions newest first, ignores non-jsonl files and lists untitled transcripts', () => {
  const r = run([
    ['11111111aaaa.jsonl', line({ type: 'user', text: 'hi' }) + '\n', 1000],
    ['33333333cccc.jsonl', line({ type: 'ai-title', aiTitle: 'Newest' }), 3000],
    ['notes.txt', line({ type: 'custom-title', customTitle: 'Nope' }), 4000],
    ['22222222bbbb.jsonl', line({ type: 'custom-title', customTitle: 'Mid' }), 2000],
  ]);
  assert.deepEqual(r, [
    { id: '33333333cccc', short: '33333333', title: 'Newest', source: 'ai', mtime: 3000000 },
    { id: '22222222bbbb', short: '22222222', title: 'Mid', source: 'custom', mtime: 2000000 },
    { id: '11111111aaaa', short: '11111111', title: null, source: null, mtime: 1000000 },
  ]);
});
