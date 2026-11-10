// sha256 hex of stableStringify of the canonical issue subject (monitor/ingest-external.mjs subjectDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectDigest } from '../ingest-external.mjs';

test('returns a sha256-prefixed digest for a fully populated issue', () => {
  const iss = {
    source: { kind: 'dep', key: 'k1', tool: 't', rule: 'r' },
    repo: 'repo',
    title: 'title',
    severity: 'high',
    anchor: { hash: 'abc' },
    groupMembers: ['b', 'a'],
  };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:38e9b5b78ccaabd9078739c7c7404c6ba6feeaf9370211f85dd2cbe82f33b1e5");
});

test('returns a digest when source is missing entirely', () => {
  const iss = { repo: 'r', title: 't', severity: 'low' };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:df559a376231b7c42cd4d4d30ae5b0f1976a9045896ece6eb6bf40556f86b5a7");
});

test('returns a digest when source is an empty object', () => {
  const iss = { source: {}, repo: 'r', title: 't', severity: 'med' };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:a74cd8be2887da8da13bd04b7f2f664b6c1fefe8fba6b59e1c6c4b2973ec654e");
});

test('returns a digest when anchor is present but has no hash', () => {
  const iss = { source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: { line: 5 } };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:25e79b9533edd9bc424c095a21a59b6bafabcf3ee9abfc70d45a57bb12a581c0");
});

test('returns a digest when anchor is null', () => {
  const iss = { source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', anchor: null };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:25e79b9533edd9bc424c095a21a59b6bafabcf3ee9abfc70d45a57bb12a581c0");
});

test('returns a digest when groupMembers is a single-element array', () => {
  const iss = { source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', groupMembers: ['only'] };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:55f24f46f132f239e89d37a351be9f3f0e52912adc3d2cda0470ef96a9704d3c");
});

test('returns a digest when groupMembers is an empty array', () => {
  const iss = { source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', groupMembers: [] };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:206882b6ea8c1d0d7266cae0a0104fa67667cadea156cea278cd31dee1b3ef07");
});

test('returns a digest when groupMembers is not an array', () => {
  const iss = { source: { kind: 'k' }, repo: 'r', title: 't', severity: 's', groupMembers: 'not-array' };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:25e79b9533edd9bc424c095a21a59b6bafabcf3ee9abfc70d45a57bb12a581c0");
});

test('returns a digest when all optional fields are undefined', () => {
  const iss = {};
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:a323cf773e8358fda5c4d69c6a1c1576cd88fdd707bf699b604b34f61fd15c30");
});

test('returns a digest when groupMembers is a large unsorted array', () => {
  const iss = {
    source: { kind: 'k', key: 'key', tool: 'tool', rule: 'rule' },
    repo: 'repo',
    title: 'title',
    severity: 'sev',
    anchor: { hash: 'h' },
    groupMembers: Array.from({ length: 100 }, (_, i) => `m${i}`),
  };
  const r = subjectDigest(iss);
  assert.equal(r, "sha256:f38f72a98a00d603704c33d733faf81be31e63372d71e6448fa43b297e0db892");
});
