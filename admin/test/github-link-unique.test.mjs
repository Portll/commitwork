// admin/auth.mjs linkGithub — one GitHub account links to at most one panel user. Both link paths
// (the typed POST /api/me/github and the OAuth callback) write through it; github-link-flow.test.mjs
// covers them over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-ghunique-'));
const STORE = join(TMP, 'users.json');
process.env.CW_AUTH_STORE = STORE;
const { bootstrapRoot, linkGithub, unlinkGithub, GITHUB_LINKED_ELSEWHERE } = await import('../auth.mjs');

const A = 'a@example.com', B = 'b@example.com';
const githubOf = (email) => JSON.parse(readFileSync(STORE, 'utf8')).users.find((u) => u.email === email).github ?? null;

before(() => {
  bootstrapRoot({ email: A, password: 'correct horse battery staple' });
  const doc = JSON.parse(readFileSync(STORE, 'utf8'));
  doc.users.push({ ...doc.users[0], id: 'b-user', email: B });
  writeFileSync(STORE, JSON.stringify(doc), { mode: 0o600 });
});
after(() => rmSync(TMP, { recursive: true, force: true }));

test('a GitHub id linked to one user is refused for another, by code, and nothing is written', () => {
  linkGithub(A, { login: 'octo', id: 7 });
  const before = readFileSync(STORE, 'utf8');
  assert.throws(() => linkGithub(B, { login: 'octo', id: 7 }),
    (e) => e.code === GITHUB_LINKED_ELSEWHERE && /already linked to another panel user/.test(e.message));
  // keyed on the id: a different login for the same id is the same account
  assert.throws(() => linkGithub(B, { login: 'renamed-octo', id: 7 }), (e) => e.code === GITHUB_LINKED_ELSEWHERE);
  assert.equal(readFileSync(STORE, 'utf8'), before, 'a refused link still wrote the store');
});

test('the holder may re-link its own id, and another id is free for the other user', () => {
  assert.equal(linkGithub(A, { login: 'octo-renamed', id: 7 }).github.login, 'octo-renamed');
  assert.equal(linkGithub(B, { login: 'someone-else', id: 8 }).github.id, 8);
});

test('once unlinked, the id is free to link elsewhere', () => {
  unlinkGithub(A);
  unlinkGithub(B);
  assert.equal(linkGithub(B, { login: 'octo', id: 7 }).github.id, 7);
  assert.equal(githubOf(A), null);
});
