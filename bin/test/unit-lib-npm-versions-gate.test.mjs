// Commit gate verdict and in-scope fix buckets from an audit summary (bin/lib/npm-versions.mjs gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate } from '../lib/npm-versions.mjs';

const row = (severity, exposure, state) => ({ severity, exposure, fix: { state } });

test('an errored summary is unmeasured with the error as reason and empty buckets', () => {
  const r = gate({ error: 'boom', rows: [row('critical', 'prod', 'available')] });
  assert.deepEqual(r, { verdict: 'unmeasured', reason: 'boom', actionable: [], undetermined: [], unpatched: [] });
});

test('with default options dev rows are excluded and prod rows at high are kept', () => {
  const dev = row('high', 'dev', 'available');
  const prod = row('high', 'prod', 'unpatched');
  const r = gate({ rows: [dev, prod] });
  assert.deepEqual(r, { verdict: 'clear', actionable: [], undetermined: [], unpatched: [prod], inScope: 1 });
});

test('includeDev true brings a dev row into scope and makes it actionable', () => {
  const dev = row('high', 'dev', 'available');
  const r = gate({ rows: [dev] }, { level: 'high', includeDev: true });
  assert.deepEqual(r, { verdict: 'actionable', actionable: [dev], undetermined: [], unpatched: [], inScope: 1 });
});

test('a prod row whose severity equals the level is in scope', () => {
  const prod = row('high', 'prod', 'available');
  const r = gate({ rows: [prod] }, { level: 'high', includeDev: false });
  assert.deepEqual(r, { verdict: 'actionable', actionable: [prod], undetermined: [], unpatched: [], inScope: 1 });
});

test('a prod row one severity below the level is out of scope', () => {
  const prod = row('moderate', 'prod', 'available');
  const r = gate({ rows: [prod] }, { level: 'high', includeDev: false });
  assert.deepEqual(r, { verdict: 'clear', actionable: [], undetermined: [], unpatched: [], inScope: 0 });
});

test('available, major and blocked rows are actionable while others go to their own buckets', () => {
  const a = row('critical', 'prod', 'available');
  const b = row('high', 'prod', 'major');
  const c = row('high', 'prod', 'blocked');
  const d = row('critical', 'prod', 'unpatched');
  const e = row('high', 'prod', 'undetermined');
  const rows = [a, b, c, d, e, row('moderate', 'prod', 'undetermined'), row('info', 'prod', 'major')];
  const r = gate({ rows }, { level: 'high', includeDev: false });
  assert.deepEqual(r, { verdict: 'actionable', actionable: [a, b, c], undetermined: [e], unpatched: [d], inScope: 5 });
});

test('undetermined rows without actionable rows give an unmeasured verdict', () => {
  const u = row('high', 'prod', 'undetermined');
  const p = row('critical', 'prod', 'unpatched');
  const r = gate({ rows: [u, p] }, { level: 'high', includeDev: false });
  assert.deepEqual(r, { verdict: 'unmeasured', actionable: [], undetermined: [u], unpatched: [p], inScope: 2 });
});

test('an in-scope row with an unrecognised fix state is counted but lands in no bucket', () => {
  const r = gate({ rows: [row('high', 'prod', 'none')] }, { level: 'high', includeDev: false });
  assert.deepEqual(r, { verdict: 'clear', actionable: [], undetermined: [], unpatched: [], inScope: 1 });
});

test('level low keeps a low dev row with includeDev and drops an info row', () => {
  const low = row('low', 'dev', 'blocked');
  const r = gate({ rows: [low, row('info', 'prod', 'available')] }, { level: 'low', includeDev: true });
  assert.deepEqual(r, { verdict: 'actionable', actionable: [low], undetermined: [], unpatched: [], inScope: 1 });
});
