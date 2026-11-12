// admin/routes/dfd.mjs `repo=<name>`: a scanned repository drawn by name. The name is only a key
// into the panel's registry — a path, a traversal or an unknown name is a 400 with its reason — and
// the static pass runs in a child over the registered checkout. The repository is built per test
// (flow/test/dfd-fixture-repo.mjs); the registry is a temp projects.json named by CW_REGISTRY.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureRepo } from '../../flow/test/dfd-fixture-repo.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-dfd-repo-route-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
const { root: FIXTURE } = fixtureRepo();
const NOT_GIT = mkdtempSync(join(tmpdir(), 'cw-dfd-not-git-'));

// The registry is read by the panel's own resolver: set before the route module is imported.
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: FIXTURE, manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
const { routes, load, registeredRepo, passInChild, REPO_NAME_RE } = await import('../routes/dfd.mjs');

const handler = (method, path) => routes.find((r) => r.method === method && r.path === path).handle;
async function call(path, url) {
  let out = null;
  await handler('GET', path)({ req: { url }, send: (status, body, ct, headers) => { out = { status, body, ct, headers }; } });
  assert.ok(out, 'the handler answered nothing');
  return out;
}
const known = () => [{ name: 'fixrepo', path: FIXTURE }, { name: 'nogit', path: NOT_GIT }, { name: 'nopath' }];

describe('dfd repo= — only a registered name', () => {
  test('a path, a traversal, an empty or overlong value is refused before any lookup', () => {
    // arrange
    const attempts = ['../../etc', '/etc/passwd', '..', '.', 'a/b', 'a\\b', '', 'x'.repeat(129), 'fix repo', 'fixrepo\0'];
    let looked = 0;
    const repos = () => { looked++; return known(); };

    // act
    const got = attempts.map((a) => registeredRepo(a, repos));

    // assert
    for (const g of got) assert.match(g.error, /^repo must name a repository the panel knows \(letters, digits, \. _ -\), not a path: /);
    assert.equal(looked, 0);
    assert.equal(REPO_NAME_RE.test('fixrepo'), true);
  });

  test('a name the registry does not know, or knows without a path, is refused with the count it does know', () => {
    // arrange
    const names = ['other', 'nopath'];

    // act
    const got = names.map((n) => registeredRepo(n, known));
    const one = registeredRepo('other', () => [{ name: 'fixrepo', path: FIXTURE }]);
    const none = registeredRepo('other', () => null);

    // assert
    assert.equal(got[0].error, "unknown repository other: the panel's registry names 3 repositories, and not this one");
    assert.match(got[1].error, /^unknown repository nopath/);
    assert.match(one.error, /names 1 repository, and not this one/);
    assert.match(none.error, /names 0 repositories/);
  });

  test('a registered name resolves to its registered path, and only that', () => {
    // arrange
    const name = 'fixrepo';

    // act
    const got = registeredRepo(name, known);

    // assert
    assert.deepEqual(got, { path: FIXTURE });
  });
});

describe('dfd repo= — load', () => {
  test('the pass is handed the registered path and the query\'s tests/imports; its model is filtered here', async () => {
    // arrange
    let seen = null;
    const model = { v: 1, kind: 'dfd', title: 't', source: { producer: 'flow-graph' },
      nodes: [{ id: 'a', kind: 'process', label: 'src/a.ts' }, { id: 'b', kind: 'store', label: 'out/b' }, { id: 'c', kind: 'store', label: 'out/c' }],
      flows: [{ from: 'a', to: 'b', label: 'w', mode: 'sync' }] };
    const pass = async (path, o) => { seen = { path, ...o }; return { model }; };

    // act
    const got = await load('/api/dfd?repo=fixrepo&focus=out%2Fb&hops=0&tests=1', {}, { drawing: false, repos: known, pass });

    // assert
    assert.equal(got.status, 200);
    assert.deepEqual([seen.path, seen.tests, seen.imports], [FIXTURE, true, false]);
    assert.deepEqual(got.model.nodes.map((n) => n.id), ['b']);
  });

  test('a refused name is a synchronous 400; a failed pass keeps its status; a filter that matches nothing is 422', async () => {
    // arrange
    const failing = async () => ({ status: 500, error: 'boom' });
    const model = { v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [] };

    // act
    const bad = load('/dfd/?repo=..%2F..%2Fetc', {}, { repos: known, pass: failing });
    const failed = await load('/dfd/?repo=fixrepo', {}, { repos: known, pass: failing });
    const empty = await load('/dfd/?repo=fixrepo&focus=zzz', {}, { repos: known, pass: async () => ({ model }) });
    const usage = load('/dfd/?repo=fixrepo&hops=x', {}, { repos: known, pass: failing });

    // assert
    assert.deepEqual([bad.status, failed.status, empty.status, usage.status], [400, 500, 422, 400]);
    assert.match(bad.error, /not a path: "\.\.\/\.\.\/etc"/);
    assert.equal(failed.error, 'boom');
  });
});

describe('dfd repo= — the child', () => {
  test('passInChild runs the static pass over a checkout and returns its unfiltered model', async () => {
    // arrange
    const path = FIXTURE;

    // act
    const got = await passInChild(path, { env: process.env, imports: true, tests: true });

    // assert
    assert.equal(got.error, undefined);
    assert.equal(got.model.source.producer, 'flow-graph');
    assert.equal(got.model.source.unknown.unanalysable, 3);
    assert.ok(got.model.flows.some((f) => f.label === 'imports'));
  });

  test('passInChild: a directory that is not a checkout is 404, a pass that times out 500 with the signal', async () => {
    // arrange
    const env = process.env;

    // act
    const notGit = await passInChild(NOT_GIT, { env });
    const slow = await passInChild(FIXTURE, { env, timeoutMs: 1 });

    // assert
    assert.equal(notGit.status, 404);
    assert.match(notGit.error, /^the static pass over the repository failed: --repo .* is not a git checkout/);
    assert.equal(slow.status, 500);
    assert.match(slow.error, /failed \(SIGTERM\)/);
  });

  test('passInChild: a child that fails before the pass, or exits 0 with no model, is a 500, never an empty diagram', async () => {
    // arrange
    const env = { ...process.env, NODE_OPTIONS: '--require=/nonexistent-preload.cjs' };
    const silent = (file, argv, opts, cb) => cb(null, 'not json', '');

    // act
    const crashed = await passInChild(FIXTURE, { env });
    const garbled = await passInChild(FIXTURE, { exec: silent });

    // assert
    assert.equal(crashed.status, 500);
    assert.match(crashed.error, /^the static pass over the repository failed: /);
    assert.equal(garbled.status, 500);
    assert.match(garbled.error, /^the static pass returned no readable model: /);
  });
});

describe('dfd repo= — the routes, through the panel\'s registry', () => {
  test('the page draws a registered repository, its banner saying what was not read', async () => {
    // arrange
    const url = '/dfd/?repo=fixrepo';

    // act
    const r = await call('/dfd/', url);

    // assert
    assert.equal(r.status, 200, r.body.slice(0, 400));
    assert.match(r.ct, /^text\/html/);
    assert.match(r.body, /Unknown, not clean:<\/strong> 3 of 8 source file\(s\) not analysed/);
    assert.ok(r.headers['content-security-policy']);
  });

  test('the document of a registered repository is its dfd@1 model with source.unknown', async () => {
    // arrange
    const url = '/api/dfd?repo=fixrepo';

    // act
    const r = await call('/api/dfd', url);

    // assert
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, 'dfd');
    assert.deepEqual(r.body.source.unknown.unsupportedLanguages, { python: 1 });
  });

  test('a traversal and an unknown name are 400s, as a page and as JSON', async () => {
    // arrange
    const urls = [['/dfd/', '/dfd/?repo=..%2F..%2Fetc%2Fpasswd'], ['/api/dfd', '/api/dfd?repo=%2Fetc'], ['/api/dfd', '/api/dfd?repo=nosuchrepo']];

    // act
    const got = await Promise.all(urls.map(([p, u]) => call(p, u)));

    // assert
    assert.deepEqual(got.map((r) => r.status), [400, 400, 400]);
    assert.match(got[0].body, /not a path: &quot;\.\.\/\.\.\/etc\/passwd&quot;/);
    assert.deepEqual(got[1].body, { ok: false, error: 'repo must name a repository the panel knows (letters, digits, . _ -), not a path: "/etc"' });
    assert.match(got[2].body.error, /^unknown repository nosuchrepo: the panel's registry names \d+ repositor/);
  });
});
