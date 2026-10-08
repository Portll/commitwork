// node --test bin/test/ — the guard that stops a scratch repo writing into the tracked ledger.
//
// WHY IT EXISTS. The leak was fixed at two call sites on 2026-08-30 and recurred at two more:
// commit-phase-from-blob.test.mjs (6 rows/run) and forbidden-trailer.test.mjs (1 row/run), measured
// 2026-09-02 at 1,523 rows — 33% of the live ledger — with one reader (bin/gate-spine.mjs) telling
// a session those fixtures were its own edits. Fixing call sites three and four would have left
// call site five, so the refusal moved into the one writer every producer already shares.
//
// BOTH DIRECTIONS ARE ASSERTED SEPARATELY, and that is the point of the file rather than an
// afterthought. A guard tested only where it fires cannot distinguish "refuses the right thing"
// from "refuses everything", and over-refusal here is silent: it would blind attribution for the
// sibling worktrees CLAUDE.md tells sessions to prefer, and nothing would report the loss.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isScratchWriteToRealLedger, touchAppender } from '../lib/touch-ledger-append.mjs';
import { realTouchLedger } from '../lib/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the refusal fires exactly on the combination that is never legitimate', () => {
  test('a temp repo writing to the REAL ledger is refused', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-guard-'));
    try { assert.equal(isScratchWriteToRealLedger(d, realTouchLedger()), true); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the real repo writing to the REAL ledger is ALLOWED — the ordinary case', () => {
    assert.equal(isScratchWriteToRealLedger(REPO, realTouchLedger()), false);
  });

  test('a temp repo writing to its OWN scratch ledger is ALLOWED — tests assert on those rows', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-guard-'));
    try { assert.equal(isScratchWriteToRealLedger(d, join(d, 'touches.jsonl')), false); }
    finally { rmSync(d, { recursive: true, force: true }); }
  });

  // A sibling worktree is a REAL checkout that happens not to be this one. It is the case the
  // repository actively recommends, so over-refusing it is the expensive direction.
  test('a sibling worktree writing to the REAL ledger is ALLOWED', () => {
    assert.equal(isScratchWriteToRealLedger(`${REPO}-260902`, realTouchLedger()), false);
  });

  // The guard reads realTouchLedger(), which consults no env — otherwise the override a leaking
  // test sets could answer the question the guard is asking.
  test('CW_TOUCH_LEDGER cannot talk the guard out of the refusal', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-guard-'));
    const prev = process.env.CW_TOUCH_LEDGER;
    process.env.CW_TOUCH_LEDGER = join(d, 'decoy.jsonl');
    try { assert.equal(isScratchWriteToRealLedger(d, realTouchLedger()), true); }
    finally {
      if (prev === undefined) delete process.env.CW_TOUCH_LEDGER; else process.env.CW_TOUCH_LEDGER = prev;
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('the appender honours it — the effect, not just the predicate', () => {
  test('a scratch repo aimed at its own ledger still records', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-guard-'));
    try {
      const ledger = join(d, 'touches.jsonl');
      const append = touchAppender({ session: 'sess1234abcd', repo: d, ledger });
      assert.equal(append({ f: 'mine.txt', access: 'write' }), 1, 'a scratch-ledger write must land');
      assert.match(readFileSync(ledger, 'utf8'), /mine\.txt/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a scratch repo aimed at the REAL ledger records NOTHING and does not throw', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-guard-'));
    try {
      const append = touchAppender({ session: 'sess1234abcd', repo: d, ledger: realTouchLedger() });
      assert.equal(append({ f: 'mine.txt', access: 'write' }), 0, 'must report nothing written');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('C-2 · the process is recorded, and its absence is not invented', () => {
  const withPid = (v, fn) => {
    const prev = process.env.CLAUDE_PID;
    if (v === null) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = v;
    try { return fn(); } finally {
      if (prev === undefined) delete process.env.CLAUDE_PID; else process.env.CLAUDE_PID = prev;
    }
  };
  const rowFor = (pidValue) => {
    const d = mkdtempSync(join(tmpdir(), 'cw-pid-'));
    try {
      const ledger = join(d, 'touches.jsonl');
      withPid(pidValue, () => touchAppender({ session: 'sess1234abcd', repo: d, ledger })({ f: 'a.mjs' }));
      return JSON.parse(readFileSync(ledger, 'utf8').split('\n').filter(Boolean)[0]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  };

  test('a live CLAUDE_PID is recorded as `p`', () => {
    assert.equal(rowFor('44239').p, 44239);
  });

  // sessionId is neither unique across processes (--resume forks it) nor stable within one
  // (/clear replaces it), so `s` alone cannot separate two sessions or join one to itself.
  test('`s` is unchanged — the 40-odd readers that key on it are untouched', () => {
    assert.equal(rowFor('44239').s, 'sess1234');
  });

  test('no CLAUDE_PID means NO `p` — absent, never 0 and never a guess', () => {
    assert.equal('p' in rowFor(null), false);
  });

  test('a nonsense CLAUDE_PID is refused rather than recorded', () => {
    for (const bad of ['', 'abc', '0', '-1']) assert.equal('p' in rowFor(bad), false, `accepted ${JSON.stringify(bad)}`);
  });
});
