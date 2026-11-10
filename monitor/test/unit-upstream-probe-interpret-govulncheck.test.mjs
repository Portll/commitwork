// Maps a govulncheck run to a fixed verdict (monitor/upstream-probe.mjs interpretGovulncheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretGovulncheck } from '../upstream-probe.mjs';

test('returns no-analysis when stdout is empty and status is zero', () => {
  const r = interpretGovulncheck('GHSA-1', { status: 0, stdout: '' });
  assert.deepEqual(r, { fixed: null, reason: "no-analysis(status=0)" });
});

test('returns no-analysis when stdout is null and status is one', () => {
  const r = interpretGovulncheck('GHSA-1', { status: 1, stdout: null });
  assert.deepEqual(r, { fixed: null, reason: "no-analysis(status=1)" });
});

test('returns no-analysis when records exist but none have a config object', () => {
  const stdout = JSON.stringify({ finding: { osv: 'GHSA-1', trace: [{ function: 'main' }] } });
  const r = interpretGovulncheck('GHSA-1', { status: 0, stdout });
  assert.deepEqual(r, { fixed: null, reason: "no-analysis(status=0)" });
});

test('returns still-reachable when a finding matches the advisory with a trace function', () => {
  const stdout = JSON.stringify({ config: {} }) + '\n' + JSON.stringify({ finding: { osv: 'GHSA-1', trace: [{ function: 'main' }] } });
  const r = interpretGovulncheck('GHSA-1', { status: 0, stdout });
  assert.deepEqual(r, { fixed: false, reason: "still-reachable-upstream" });
});

test('returns still-reachable when a finding matches the advisory with a trace function and status is one', () => {
  const stdout = JSON.stringify({ config: {} }) + '\n' + JSON.stringify({ finding: { osv: 'GHSA-1', trace: [{ function: 'main' }] } });
  const r = interpretGovulncheck('GHSA-1', { status: 1, stdout });
  assert.deepEqual(r, { fixed: false, reason: "still-reachable-upstream" });
});

test('returns incomplete-analysis when the advisory is absent and status is one', () => {
  const stdout = JSON.stringify({ config: {} });
  const r = interpretGovulncheck('GHSA-1', { status: 1, stdout });
  assert.deepEqual(r, { fixed: null, reason: "incomplete-analysis(status=1)" });
});

test('returns fixed when the advisory is absent and status is zero', () => {
  const stdout = JSON.stringify({ config: {} });
  const r = interpretGovulncheck('GHSA-1', { status: 0, stdout });
  assert.deepEqual(r, { fixed: true, reason: "analysed-advisory-absent" });
});

test('returns incomplete-analysis when the advisory is absent and status is two', () => {
  const stdout = JSON.stringify({ config: {} });
  const r = interpretGovulncheck('GHSA-1', { status: 2, stdout });
  assert.deepEqual(r, { fixed: null, reason: "incomplete-analysis(status=2)" });
});

test('returns fixed when the advisory is absent and status is zero with a non-matching finding', () => {
  const stdout = JSON.stringify({ config: {} }) + '\n' + JSON.stringify({ finding: { osv: 'GHSA-2', trace: [{ function: 'main' }] } });
  const r = interpretGovulncheck('GHSA-1', { status: 0, stdout });
  assert.deepEqual(r, { fixed: true, reason: "analysed-advisory-absent" });
});

test('returns incomplete-analysis when the advisory is absent and status is one with a non-matching finding', () => {
  const stdout = JSON.stringify({ config: {} }) + '\n' + JSON.stringify({ finding: { osv: 'GHSA-2', trace: [{ function: 'main' }] } });
  const r = interpretGovulncheck('GHSA-1', { status: 1, stdout });
  assert.deepEqual(r, { fixed: null, reason: "incomplete-analysis(status=1)" });
});
