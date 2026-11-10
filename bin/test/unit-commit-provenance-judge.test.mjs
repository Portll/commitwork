// Evaluates commit provenance rules and returns violation records (bin/commit-provenance.mjs judge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../commit-provenance.mjs';

const ctx = {
  branch: 'main',
  protection: { branch: 'main', signatures: new Map([['sha1', 'N']]) },
  bots: { names: new Set(['bot@example.com']) }
};

test('flags unsigned commits on protected branches', () => {
  const commit = { sha: 'sha1', authorName: 'Alice', authorEmail: 'a@x.com', committerName: 'Alice', committerEmail: 'a@x.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), [{ rule: "unsigned-on-protected-branch", path: "main", sha: "sha1", sev: "med", cwe: "CWE-347", detail: "signature=N on protected branch main" }]);
});

test('ignores signed commits on protected branches', () => {
  const commit = { sha: 'sha2', authorName: 'Alice', authorEmail: 'a@x.com', committerName: 'Alice', committerEmail: 'a@x.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), []);
});

test('flags machine-authored merges without human authorization', () => {
  const commit = { sha: 'sha3', authorName: 'bot', authorEmail: 'bot@example.com', committerName: 'bot', committerEmail: 'bot@example.com', parents: ['p1', 'p2'], subject: 'Merge', body: '' };
  assert.deepEqual(judge(commit, ctx), [{ rule: "bot-authored-merge", path: "main", sha: "sha3", sev: "med", cwe: "CWE-345", detail: "merge of 2 parents, author=machine, no authorized-by marker" }]);
});

test('allows machine-authored merges with human authorization', () => {
  const commit = { sha: 'sha4', authorName: 'bot', authorEmail: 'bot@example.com', committerName: 'bot', committerEmail: 'bot@example.com', parents: ['p1', 'p2'], subject: 'Merge', body: 'Authorized by: Alice' };
  assert.deepEqual(judge(commit, ctx), []);
});

test('flags human author committer identity mismatches', () => {
  const commit = { sha: 'sha5', authorName: 'Alice', authorEmail: 'a@x.com', committerName: 'Bob', committerEmail: 'b@x.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), [{ rule: "author-committer-mismatch", path: "main", sha: "sha5", sev: "low", cwe: "CWE-345", detail: "author=human committer=human, identities differ" }]);
});

test('allows matching human author and committer identities', () => {
  const commit = { sha: 'sha6', authorName: 'Alice', authorEmail: 'a@x.com', committerName: 'Alice', committerEmail: 'a@x.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), []);
});

test('flags unregistered machine authors', () => {
  const commit = { sha: 'sha7', authorName: 'unknown-bot', authorEmail: 'unknown@x.com', committerName: 'unknown-bot', committerEmail: 'unknown@x.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), [{ rule: "machine-author-unregistered", path: "main", sha: "sha7", sev: "high", cwe: "CWE-345", detail: "author=machine, not in the declared bot list (1 registered)" }]);
});

test('allows registered machine authors', () => {
  const commit = { sha: 'sha8', authorName: 'bot', authorEmail: 'bot@example.com', committerName: 'bot', committerEmail: 'bot@example.com', parents: [], subject: 's', body: '' };
  assert.deepEqual(judge(commit, ctx), []);
});
