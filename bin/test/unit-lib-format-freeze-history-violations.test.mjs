// Computes violations in a frozen format's history (bin/lib/format-freeze.mjs historyViolations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyViolations } from '../lib/format-freeze.mjs';

test('returns a message when history is empty', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [] };
  assert.deepEqual(historyViolations(entry, 'fp'), ["fmt: a frozen format needs a history line pinning its schema"]);
});

test('flags a non-initial first history line', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [{ change: 'additive', version: '1.0.0', release: '1.0.0', fingerprint: 'fp' }] };
  assert.deepEqual(historyViolations(entry, 'fp'), ["fmt: the first history line must be change \"initial\""]);
});

test('flags an additive line that moves the version', () => {
  const entry = { id: 'fmt', version: '2.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' },
    { change: 'additive', version: '2.0.0', release: '1.0.0', fingerprint: 'b' }
  ] };
  assert.deepEqual(historyViolations(entry, 'b'), ["fmt: history[1] is additive but moves the version \"1.0.0\" -> \"2.0.0\""]);
});

test('flags a breaking line that keeps the version', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' },
    { change: 'breaking', version: '1.0.0', release: '1.0.0', fingerprint: 'b' }
  ] };
  assert.deepEqual(historyViolations(entry, 'b'), ["fmt: history[1] is breaking and keeps version \"1.0.0\"; a reader cannot tell the shapes apart", "fmt: history[1] is a breaking change in release 1.0.0; from 1.0 that needs a major release after 1.0.0"]);
});

test('flags a breaking line with no major release bump', () => {
  const entry = { id: 'fmt', version: '1.1.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' },
    { change: 'breaking', version: '1.1.0', release: '1.1.0', fingerprint: 'b' }
  ] };
  assert.deepEqual(historyViolations(entry, 'b'), ["fmt: history[1] is a breaking change in release 1.1.0; from 1.0 that needs a major release after 1.0.0"]);
});

test('flags an invalid change type', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' },
    { change: 'weird', version: '1.0.0', release: '1.0.0', fingerprint: 'b' }
  ] };
  assert.deepEqual(historyViolations(entry, 'b'), ["fmt: history[1] change must be additive or breaking, not \"weird\""]);
});

test('flags an unchanged fingerprint between lines', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' },
    { change: 'additive', version: '1.0.0', release: '1.0.0', fingerprint: 'a' }
  ] };
  assert.deepEqual(historyViolations(entry, 'a'), ["fmt: history[1] records no change to the fingerprint"]);
});

test('flags when the last history version differs from entry version', () => {
  const entry = { id: 'fmt', version: '2.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' }
  ] };
  assert.deepEqual(historyViolations(entry, 'a'), ["fmt: version \"2.0.0\" is not the last history version \"1.0.0\""]);
});

test('flags when the actual fingerprint differs from the last history fingerprint', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' }
  ] };
  assert.deepEqual(historyViolations(entry, 'b'), ["fmt: s changed shape (pinned a, now b). Append a history line: \"additive\" keeps the version; \"breaking\" bumps the version its writer stamps. See docs/STABILITY.md."]);
});

test('returns an empty array when the history is fully consistent', () => {
  const entry = { id: 'fmt', version: '1.0.0', schema: 's', history: [
    { change: 'initial', version: '1.0.0', release: '1.0.0', fingerprint: 'a' }
  ] };
  assert.deepEqual(historyViolations(entry, 'a'), []);
});
