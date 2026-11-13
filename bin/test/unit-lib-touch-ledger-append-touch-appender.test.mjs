// A ledger appender that writes one session touch row per call and returns 1 or 0 (bin/lib/touch-ledger-append.mjs touchAppender).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { touchAppender } from '../lib/touch-ledger-append.mjs';

const AT = '2026-01-02T03:04:05.000Z';
// The appender's default is the checkout's own .claude/store/touches.jsonl. A probe that names no
// ledger would write there, and bin/test/sidecar-paths.test.mjs reads that as a store written with
// nothing versioning it, so every probe gets a scratch ledger unless it names its own.
const TMP = mkdtempSync(join(tmpdir(), 'cw-touch-appender-'));
const LEDGER = join(TMP, 'touches.jsonl');
after(() => rmSync(TMP, { recursive: true, force: true }));
const pick = (row) => Object.fromEntries(['s', 'p', 'at'].filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]]));

const probe = ({ session, repo = '/repo', pid, ledger = LEDGER }) => {
  const saved = process.env.CLAUDE_PID;
  if (pid === undefined) delete process.env.CLAUDE_PID;
  else process.env.CLAUDE_PID = pid;
  try {
    const seen = [];
    const append = touchAppender({ session, repo, at: AT, ledger });
    const n = append({
      toJSON() {
        const { toJSON, ...row } = this;
        seen.push(pick(row));
        return row;
      },
    });
    return { n, row: seen.length ? seen[0] : null };
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PID;
    else process.env.CLAUDE_PID = saved;
  }
};

test('an appender built with an empty session returns 0 and serializes no row', () => {
  assert.deepEqual(probe({ session: '', pid: '4242' }), { n: 0, row: null });
});

test('an appender built with a null repo returns 0 and serializes no row', () => {
  assert.deepEqual(probe({ session: 'abcdefghi', repo: null, pid: '4242' }), { n: 0, row: null });
});

test('a nine-character session is cut to eight characters and a positive pid is recorded', () => {
  assert.deepEqual(probe({ session: 'abcdefghi', pid: '4242' }), { n: 1, row: { s: 'abcdefgh', p: 4242, at: AT } });
});

test('an eight-character session is kept whole and an unset pid leaves p out of the row', () => {
  assert.deepEqual(probe({ session: 'abcdefgh' }), { n: 1, row: { s: 'abcdefgh', at: AT } });
});

test('a numeric session is stringified before it is cut and a pid of 1 is recorded', () => {
  assert.deepEqual(probe({ session: 1234567890, pid: '1' }), { n: 1, row: { s: '12345678', p: 1, at: AT } });
});

test('a short session is kept as is and a pid of 0 leaves p out of the row', () => {
  assert.deepEqual(probe({ session: 'abc', pid: '0' }), { n: 1, row: { s: 'abc', at: AT } });
});

test('a negative pid leaves p out of the row', () => {
  assert.deepEqual(probe({ session: 'abcdefghi', pid: '-1' }), { n: 1, row: { s: 'abcdefgh', at: AT } });
});

test('a fractional pid leaves p out of the row', () => {
  assert.deepEqual(probe({ session: 'abcdefghi', pid: '1.5' }), { n: 1, row: { s: 'abcdefgh', at: AT } });
});

test('an appender whose ledger cannot be written returns 0', () => {
  assert.equal(probe({ session: 'abcdefghi', pid: '4242', ledger: '/dev/null/commitwork-touches.jsonl' }).n, 0);
});
