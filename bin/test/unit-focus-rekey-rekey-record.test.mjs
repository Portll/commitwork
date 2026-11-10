// Maps a verdict record to a session by timestamp proximity and nudge witness (bin/focus-rekey.mjs rekeyRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rekeyRecord } from '../focus-rekey.mjs';

test('returns unparseable-at when the timestamp is invalid', () => {
  const r = rekeyRecord({ at: 'not-a-date', session: null, repo: null }, []);
  assert.deepEqual(r, { recordAt: "not-a-date", recordSession: null, repo: null, how: "unparseable-at", session: null, candidates: 0 });
});

test('returns already-session when the record session matches an index entry', () => {
  const index = [{ session: 'abcdef1234567890', file: '/tmp/transcript.log', repo: 'repo1', times: [1000], nudges: [] }];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: 'abcdef12', repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: "abcdef12", repo: "repo1", how: "already-session", session: "abcdef12", transcript: "transcript.log", candidates: 1 });
});

test('returns timestamp-join when exactly one transcript matches the window', () => {
  const index = [{ session: '1111111122223333', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [] }];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: null, repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: null, repo: "repo1", how: "timestamp-join", window: 1000, session: "11111111", transcript: "a.log", candidates: 1 });
});

test('returns no-transcript when no transcripts match the window', () => {
  const index = [{ session: '1111111122223333', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [] }];
  const r = rekeyRecord({ at: '2024-01-01T00:00:05Z', session: null, repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:05Z", recordSession: null, repo: "repo1", how: "no-transcript", window: 1000, session: null, candidates: 0 });
});

test('returns timestamp-join+nudge when a tie is broken by a nudge witness', () => {
  const index = [
    { session: 'aaaa1111bbbb2222', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [1704067200000] },
    { session: 'cccc3333dddd4444', file: '/tmp/c.log', repo: 'repo1', times: [1704067200000], nudges: [] }
  ];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: null, repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: null, repo: "repo1", how: "timestamp-join+nudge", window: 1000, session: "aaaa1111", transcript: "a.log", candidates: 2, nudgeCandidates: 1 });
});

test('returns tie when multiple transcripts match and no nudge breaks the tie', () => {
  const index = [
    { session: 'aaaa1111bbbb2222', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [] },
    { session: 'cccc3333dddd4444', file: '/tmp/c.log', repo: 'repo1', times: [1704067200000], nudges: [] }
  ];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: null, repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: null, repo: "repo1", how: "tie", window: 1000, session: null, candidates: 2, nudgeCandidates: 0, tied: ["aaaa1111", "cccc3333"] });
});

test('returns tie with nudge candidates when multiple transcripts have nudges in the window', () => {
  const index = [
    { session: 'aaaa1111bbbb2222', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [1704067200000] },
    { session: 'cccc3333dddd4444', file: '/tmp/c.log', repo: 'repo1', times: [1704067200000], nudges: [1704067200000] }
  ];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: null, repo: 'repo1' }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: null, repo: "repo1", how: "tie", window: 1000, session: null, candidates: 2, nudgeCandidates: 2, tied: ["aaaa1111", "cccc3333"] });
});

test('returns timestamp-join when the record has no repo and one transcript matches', () => {
  const index = [
    { session: '1111111122223333', file: '/tmp/a.log', repo: 'repo1', times: [1704067200000], nudges: [] },
    { session: '4444444455556666', file: '/tmp/b.log', repo: 'repo2', times: [1704067200000], nudges: [] }
  ];
  const r = rekeyRecord({ at: '2024-01-01T00:00:00Z', session: null, repo: null }, index);
  assert.deepEqual(r, { recordAt: "2024-01-01T00:00:00Z", recordSession: null, repo: null, how: "tie", window: 1000, session: null, candidates: 2, nudgeCandidates: 0, tied: ["11111111", "44444444"] });
});
