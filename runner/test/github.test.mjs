import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GithubError, createGithub } from '../github.mjs';
import { PRIVATE, contentsBody, fakeFetch, fixture } from './lib/fixtures.mjs';

const SHA = '4ad5e3e9b1a9f4c2b8d7e6f5a4b3c2d1e0f9a8b7';
const typed = (status, pattern) => (e) => {
  assert.ok(e instanceof GithubError, `expected a GithubError, got ${e?.name}`);
  assert.equal(e.status, status);
  if (pattern) assert.match(e.reason, pattern);
  return true;
};

test('ETag: a 304 is answered from the cache, with If-None-Match sent', async () => {
  let n = 0;
  const fetch = fakeFetch(() => (++n === 1
    ? { body: fixture('runs-queued.json'), headers: { etag: 'W/"runs-1"' } }
    : { status: 304 }));
  const gh = createGithub({ token: 't', fetch });
  const first = await gh.runs(PRIVATE);
  const second = await gh.runs(PRIVATE);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].init.headers['if-none-match'], undefined);
  assert.equal(fetch.calls[1].init.headers['if-none-match'], 'W/"runs-1"');
  assert.deepEqual(second, first);
  assert.equal(second[0].id, 30433642);
});

test('ETag: POSTs are never conditional and never cached', async () => {
  const fetch = fakeFetch(() => ({ status: 202, body: {}, headers: { etag: 'W/"x"' } }));
  const gh = createGithub({ token: 't', fetch });
  await gh.cancelRun(PRIVATE, 30433642);
  await gh.cancelRun(PRIVATE, 30433642);
  assert.ok(fetch.calls.every((c) => c.init.method === 'POST' && !('if-none-match' in c.init.headers)));
});

test('ETag: the cache is bounded, oldest entry out first', async () => {
  const fetch = fakeFetch(() => ({ body: fixture('repo-private.json'), headers: { etag: 'W/"m"' } }));
  const gh = createGithub({ token: 't', fetch, cacheMax: 1 });
  await gh.repoMeta('example-owner/a');
  await gh.repoMeta('example-owner/b');
  await gh.repoMeta('example-owner/a');
  assert.equal(fetch.calls[2].init.headers['if-none-match'], undefined, 'a was evicted by b');
});

test('the token is the one passed in, never the ambient one', async (t) => {
  const prior = process.env.GITHUB_TOKEN;
  t.after(() => { if (prior === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = prior; });
  process.env.GITHUB_TOKEN = 'ambient';
  const fetch = fakeFetch(() => ({ body: fixture('repo-private.json') }));
  await createGithub({ token: 'given', fetch }).repoMeta(PRIVATE);
  assert.equal(fetch.calls[0].init.headers.authorization, 'Bearer given');
  assert.throws(() => createGithub({ fetch }), typed(0, /no token/));
});

test('errors are typed: HTTP status, network, rate limit, non-JSON, missing list', async () => {
  const gh = (handler) => createGithub({ token: 't', fetch: fakeFetch(handler) });
  await assert.rejects(gh(() => ({ status: 404, body: { message: 'Not Found' } })).repoMeta(PRIVATE), typed(404, /Not Found/));
  await assert.rejects(gh(() => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }).repoMeta(PRIVATE), typed(0, /network: ECONNRESET/));
  await assert.rejects(gh(() => ({ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } })).runners(PRIVATE), typed(403, /^rate limited/));
  const notJson = createGithub({ token: 't', fetch: async () => new Response('<html>', { status: 502 }) });
  await assert.rejects(notJson.repoMeta(PRIVATE), typed(502, /not JSON/));
  await assert.rejects(gh(() => ({ body: { total_count: 0 } })).runs(PRIVATE), typed(200, /workflow_runs/));
});

test('bad arguments reject rather than throw, before any request', async () => {
  const fetch = fakeFetch(() => ({ body: {} }));
  const gh = createGithub({ token: 't', fetch });
  await assert.rejects(gh.repoMeta('../../user'), typed(0));
  await assert.rejects(gh.runJobs(PRIVATE, '1;2'), typed(0, /run id/));
  await assert.rejects(gh.fileAt(PRIVATE, '.github/../secrets', SHA), typed(0, /path/));
  await assert.rejects(gh.fileAt(PRIVATE, '.github/workflows/ci.yml', 'main'), typed(0, /sha/));
  await assert.rejects(gh.runs(PRIVATE, 'completed'), typed(0, /not polled/));
  assert.equal(fetch.calls.length, 0);
});

test('fileAt reads the contents API at a sha and decodes it', async () => {
  const fetch = fakeFetch(() => ({ body: contentsBody('name: CI\n') }));
  const text = await createGithub({ token: 't', fetch }).fileAt(PRIVATE, '.github/workflows/ci.yml', SHA);
  assert.equal(text, 'name: CI\n');
  assert.equal(fetch.calls[0].url, `https://api.github.com/repos/${PRIVATE}/contents/.github/workflows/ci.yml?ref=${SHA}`);
});

test('generate-jitconfig posts name, group 1, labels and work folder', async () => {
  const fetch = fakeFetch(() => ({ status: 201, body: fixture('jitconfig.json') }));
  const gh = createGithub({ token: 't', fetch });
  const out = await gh.generateJitConfig(PRIVATE, { name: 'cw-slot-1-399444496-1792660200', labels: ['self-hosted', 'commitwork'] });
  assert.equal(out.runner.id, 27);
  assert.equal(fetch.calls[0].url, `https://api.github.com/repos/${PRIVATE}/actions/runners/generate-jitconfig`);
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
    name: 'cw-slot-1-399444496-1792660200', runner_group_id: 1, labels: ['self-hosted', 'commitwork'], work_folder: '_work',
  });
  await assert.rejects(gh.generateJitConfig(PRIVATE, { labels: ['x'] }), typed(0, /name/));
});

test('list, delete and policy endpoints hit their paths', async () => {
  const fetch = fakeFetch((url) => (url.endsWith('/runners?per_page=100') ? { body: fixture('runners.json') }
    : url.includes('fork-pr-contributor-approval') ? { body: fixture('fork-approval.json') }
      : url.includes('/jobs?') ? { body: fixture('jobs.json') } : { status: 204 }));
  const gh = createGithub({ token: 't', fetch });
  assert.equal((await gh.runners(PRIVATE)).length, 4);
  assert.equal((await gh.forkApproval(PRIVATE)).approval_policy, 'first_time_contributors');
  assert.equal((await gh.runJobs(PRIVATE, 30433642))[0].id, 399444496);
  assert.equal(await gh.deleteRunner(PRIVATE, 23), null);
  assert.equal(fetch.calls[3].init.method, 'DELETE');
  assert.match(fetch.calls[2].url, /\/actions\/runs\/30433642\/jobs\?filter=latest&per_page=100$/);
});
