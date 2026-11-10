// GitHub CLI output read into login, permission, labels, search rows and PR state (monitor/draft-pr-live.mjs ghSeams).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghSeams } from '../draft-pr-live.mjs';

const spawnBinding = process.binding('spawn_sync');

function withGh(reply, use) {
  const realSpawn = spawnBinding.spawn;
  spawnBinding.spawn = ({ args }) => {
    const { status = 0, stdout = '' } = reply(args);
    return { pid: 1, status, signal: null, output: [null, Buffer.from(stdout), Buffer.alloc(0)] };
  };
  try {
    return use(ghSeams({ PATH: process.env.PATH }));
  } finally {
    spawnBinding.spawn = realSpawn;
  }
}

const prints = (stdout) => () => ({ stdout });
const fails = (stdout) => () => ({ status: 1, stdout });
const labels = (reply) => withGh(reply, (s) => s.labels('o/r'));
const view = (reply) => withGh(reply, (s) => s.prView('https://github.com/o/r/pull/1'));
const echoSearch = (args) => ({
  stdout: JSON.stringify([{ kind: args.includes('issue') ? 'issue' : 'pr', term: args[args.indexOf('--search') + 1] }]),
});

test('whoami returns the trimmed login and null for blank output or a failed call', () => {
  const whoami = (reply) => withGh(reply, (s) => s.whoami());
  assert.equal(whoami(prints('  alice \n')), 'alice');
  assert.equal(whoami(prints(' \n')), null);
  assert.equal(whoami(prints('')), null);
  assert.equal(whoami(fails('alice\n')), null);
});

test('permission returns the trimmed level and null for blank output or a failed call', () => {
  const permission = (reply) => withGh(reply, (s) => s.permission('o/r'));
  assert.equal(permission(prints('  ADMIN \n')), 'ADMIN');
  assert.equal(permission(prints(' \n')), null);
  assert.equal(permission(prints('')), null);
  assert.equal(permission(fails('ADMIN\n')), null);
});

test('labels maps rows to string names and reads blank output as no labels', () => {
  const stdout = JSON.stringify([{ name: 'bug' }, { name: 7 }, {}, null]);
  assert.deepEqual(labels(prints(stdout)), ['bug', '7', '', '']);
  assert.deepEqual(labels(prints('')), []);
});

test('labels returns null for a failed call, invalid JSON or a non-array', () => {
  assert.equal(labels(fails('[{"name":"bug"}]')), null);
  assert.equal(labels(prints('not json')), null);
  assert.equal(labels(prints('{"name":"bug"}')), null);
});

test('search gathers the rows of every PR term and every issue term in order', () => {
  const found = withGh(echoSearch, (s) => s.search('o/r', { prTerms: ['a', 'b'], issueTerms: ['c'] }));
  assert.deepEqual(found, {
    prs: [{ kind: 'pr', term: '"a"' }, { kind: 'pr', term: '"b"' }],
    issues: [{ kind: 'issue', term: '"c"' }],
  });
});

test('search treats blank output and empty term lists as no rows', () => {
  const blank = withGh(prints(''), (s) => s.search('o/r', { prTerms: ['a'], issueTerms: ['b'] }));
  assert.deepEqual(blank, { prs: [], issues: [] });
  const noTerms = withGh(fails(''), (s) => s.search('o/r', { prTerms: [], issueTerms: [] }));
  assert.deepEqual(noTerms, { prs: [], issues: [] });
});

test('search returns null when a PR term cannot be read', () => {
  const terms = { prTerms: ['a'], issueTerms: ['b'] };
  const prFails = (args) => (args.includes('issue') ? { stdout: '[]' } : { status: 1, stdout: '[]' });
  assert.equal(withGh(prFails, (s) => s.search('o/r', terms)), null);
  assert.equal(withGh(prints('{"number":1}'), (s) => s.search('o/r', terms)), null);
});

test('search returns null when an issue term cannot be read after the PR terms succeed', () => {
  const issueFails = (args) => (args.includes('issue') ? { status: 1, stdout: '[]' } : { stdout: '[{"number":1}]' });
  assert.equal(withGh(issueFails, (s) => s.search('o/r', { prTerms: ['a'], issueTerms: ['b'] })), null);
  assert.equal(withGh(issueFails, (s) => s.search('o/r', { prTerms: [], issueTerms: ['b'] })), null);
});

test('prView keeps state and dates, reduces mergedBy to its login and nulls empty fields', () => {
  const merged = { state: 'MERGED', mergedAt: '2024-01-01T00:00:00Z', closedAt: '2024-01-02T00:00:00Z' };
  assert.deepEqual(view(prints(JSON.stringify({ ...merged, mergedBy: { login: 'bob' } }))), { ...merged, mergedBy: 'bob' });
  assert.deepEqual(view(prints('{"state":"OPEN"}')), { state: 'OPEN', mergedAt: null, closedAt: null, mergedBy: null });
  assert.deepEqual(view(prints('{"state":"CLOSED","mergedAt":"","closedAt":"","mergedBy":{}}')), {
    state: 'CLOSED',
    mergedAt: null,
    closedAt: null,
    mergedBy: null,
  });
});

test('prView returns null for a failed call, unparsable output, JSON null or a non-string state', () => {
  assert.equal(view(fails('{"state":"OPEN"}')), null);
  assert.equal(view(prints('not json')), null);
  assert.equal(view(prints('')), null);
  assert.equal(view(prints('null')), null);
  assert.equal(view(prints('{"state":123}')), null);
  assert.equal(view(prints('{}')), null);
});
