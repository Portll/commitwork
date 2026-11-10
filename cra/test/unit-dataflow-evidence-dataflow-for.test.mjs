// dataflow reachability lookup (cra/dataflow-evidence.mjs dataflowFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataflowFor } from '../dataflow-evidence.mjs';

test('returns reachable evidence when hit is reachable', () => {
  const index = new Map();
  const repo = 'r';
  const rule = 'rule';
  const file = 'f';
  const key = `${repo}|${rule}|${file}`;
  index.set(key, { reachability: 'reachable', evidence: 'e1', path: '/p' });
  const r = dataflowFor(index, repo, rule, file);
  assert.deepEqual(r, { reachability: "reachable", evidence: ["e1"], path: "/p" });
});

test('returns unknown with why when hit is present but not reachable', () => {
  const index = new Map();
  const repo = 'r2';
  const rule = 'rul2';
  const file = 'f2';
  const key = `${repo}|${rule}|${file}`;
  index.set(key, { reachability: 'unreachable', why: 'because' });
  const r = dataflowFor(index, repo, rule, file);
  assert.deepEqual(r, { reachability: "reachability_unknown", evidence: [], why: "because" });
});

test('returns default why when no hit is found', () => {
  const index = new Map();
  const r = dataflowFor(index, 'no', 'hit', 'here');
  assert.deepEqual(r, { reachability: "reachability_unknown", evidence: [], why: "no CodeQL result for this repo/rule/file \u2014 the query may not cover this rule, or CodeQL may not have run here" });
});

test('returns default why when hit is null (falsy)', () => {
  const index = new Map();
  const repo = 'r3';
  const rule = 'r3r';
  const file = 'f3';
  const key = `${repo}|${rule}|${file}`;
  index.set(key, null);
  const r = dataflowFor(index, repo, rule, file);
  assert.deepEqual(r, { reachability: "reachability_unknown", evidence: [], why: "no CodeQL result for this repo/rule/file \u2014 the query may not cover this rule, or CodeQL may not have run here" });
});

test('returns reachable evidence when hit reachability is reachable and key uses empty rule and file', () => {
  const index = new Map();
  const repo = 'repo';
  const rule = '';
  const file = '';
  const key = `${repo}|${rule}|${file}`;
  index.set(key, { reachability: 'reachable', evidence: 'e2', path: '/path2' });
  const r = dataflowFor(index, repo, rule, file);
  assert.deepEqual(r, { reachability: "reachable", evidence: ["e2"], path: "/path2" });
});

test('returns unknown with why when hit has reachability undefined', () => {
  const index = new Map();
  const repo = 'repoU';
  const rule = 'ruleU';
  const file = 'fileU';
  const key = `${repo}|${rule}|${file}`;
  index.set(key, { why: 'missing reachability' });
  const r = dataflowFor(index, repo, rule, file);
  assert.deepEqual(r, { reachability: "reachability_unknown", evidence: [], why: "missing reachability" });
});
