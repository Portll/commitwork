// F-3 · a row filed by a BYPASS cannot witness the tool's reachability.
//
// THE DEFECT, measured 2026-08-30 on the live store: 4 of 1,436 spine rows carry a `via` field, and
// all four read *"spine/db.mjs direct — substrate MCP not attached to this session"*.
// `overwatchReachability()` read only `at`, so those four were counted as "somebody filed recently
// ⇒ demonstrably reachable" — rows explicitly stating the tool was UNAVAILABLE, granting fleet-wide
// proof that it was AVAILABLE, and thereby denying the outage exemption to every session.
//
// The evidence that would have flipped the verdict was on the row, and no reader consulted it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overwatchReachability } from '../gate-spine-core.mjs';

const NOW = Date.parse('2026-08-30T10:00:00Z');
const OUT = 60 * 60 * 1000;
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

test('THE DEFECT: a bypass row does not prove the tool is reachable', () => {
  const rows = [{ at: at(60_000), via: 'spine/db.mjs direct — substrate MCP not attached to this session' }];
  assert.notEqual(overwatchReachability({ spineRows: rows, dbMtimeMs: null, now: NOW, outageMs: OUT }), true,
    'a row that says the MCP was not attached cannot be proof the MCP was attached');
});

test('a row filed through the tool DOES prove it — the guard still discriminates', () => {
  const rows = [{ at: at(60_000) }];
  assert.equal(overwatchReachability({ spineRows: rows, dbMtimeMs: null, now: NOW, outageMs: OUT }), true);
});

test('mixed rows: the tool-filed one carries the verdict, the bypass is ignored', () => {
  const rows = [
    { at: at(30_000), via: 'spine/db.mjs direct — substrate MCP not attached to this session' },
    { at: at(90_000) },
  ];
  assert.equal(overwatchReachability({ spineRows: rows, dbMtimeMs: null, now: NOW, outageMs: OUT }), true,
    'a genuine filing is still evidence even when a bypass row sits beside it');
});

test('ONLY bypass rows is UNKNOWN, never false — nothing witnessed the tool either way', () => {
  const rows = [
    { at: at(30_000), via: 'direct' },
    { at: at(40_000), via: 'direct' },
  ];
  assert.equal(overwatchReachability({ spineRows: rows, dbMtimeMs: null, now: NOW, outageMs: OUT }), 'unknown',
    'absence of a witness is not evidence of an outage — grey is its own state in both directions');
});

test('a STALE tool-filed row still reaches the outage arm, not unknown', () => {
  const rows = [{ at: at(OUT * 3) }];
  const v = overwatchReachability({ spineRows: rows, dbMtimeMs: NOW - OUT * 3, now: NOW, outageMs: OUT });
  assert.notEqual(v, true, 'nothing has been filed within the window');
});

test('the bypass filter does not swallow rows with an unrelated falsy via', () => {
  // `via: ''` is not a route claim; treat it as absent rather than as a bypass.
  const rows = [{ at: at(60_000), via: '' }];
  assert.equal(overwatchReachability({ spineRows: rows, dbMtimeMs: null, now: NOW, outageMs: OUT }), true);
});
