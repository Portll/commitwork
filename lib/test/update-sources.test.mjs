// lib/update/sources.mjs: the Worker and GitHub Releases readers, redirects without the token,
// size limits, and artifact download fallback, all over a fake fetch.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fromPortll, fromGithub, downloadArtifact, getFollowing, readLimited, PORTLL_BASE, GITHUB_API } from '../update/sources.mjs';
import { fakeFetch, makeKey, manifestFor } from './lib/update-rig.mjs';

const key = makeKey();
const REL = `${GITHUB_API}/repos/Portll/commitwork/releases`;
const ASSET_URL = `${REL}/assets/1`;

describe('fromPortll', () => {
  test('stable reads only the stable manifest, with no Authorization header', async () => {
    // Arrange
    const m = manifestFor({ key });
    const fetch = fakeFetch({ [`${PORTLL_BASE}/commitwork/stable/latest.json`]: { body: m } });
    // Act
    const r = await fromPortll({ fetch, product: 'commitwork', channel: 'stable' });
    // Assert
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].manifest.version, '9.9.9');
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('beta reads beta and stable, and reports each failure', async () => {
    // Arrange
    const fetch = fakeFetch({
      [`${PORTLL_BASE}/commitwork/beta/latest.json`]: { body: 'not json' },
      [`${PORTLL_BASE}/commitwork/stable/latest.json`]: new Error('offline'),
    });
    // Act
    const r = await fromPortll({ fetch, product: 'commitwork', channel: 'beta' });
    // Assert
    assert.deepEqual(r.candidates, []);
    assert.match(r.errors[0], /beta\/latest\.json: not JSON/);
    assert.match(r.errors[1], /offline/);
  });
});

describe('fromGithub', () => {
  const m = manifestFor({ key });
  const release = (extra = {}) => ({ tag_name: 'v9.9.9', draft: false, assets: [{ name: 'portll-update.json', url: ASSET_URL }], ...extra });

  test('stable reads releases/latest and downloads the manifest asset as octet-stream with the token', async () => {
    // Arrange
    const fetch = fakeFetch({ [`${REL}/latest`]: { body: release() }, [ASSET_URL]: { body: m } });
    // Act
    const r = await fromGithub({ fetch, repo: 'Portll/commitwork', channel: 'stable', token: 'ghp_' + 'x'.repeat(30) });
    // Assert
    assert.equal(r.candidates[0].source, 'github');
    assert.equal(r.candidates[0].release.tag_name, 'v9.9.9');
    assert.equal(fetch.calls[1].init.headers.Accept, 'application/octet-stream');
    assert.match(fetch.calls[1].init.headers.Authorization, /^Bearer ghp_/);
  });

  test('beta lists releases, prereleases included, skipping drafts', async () => {
    // Arrange
    const fetch = fakeFetch({ [`${REL}?per_page=10`]: { body: [release({ draft: true, tag_name: 'v10.0.0' }), release({ prerelease: true })] }, [ASSET_URL]: { body: m } });
    // Act
    const r = await fromGithub({ fetch, repo: 'Portll/commitwork', channel: 'beta', token: null });
    // Assert
    assert.equal(r.candidates[0].release.tag_name, 'v9.9.9');
    assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('a refused token is retried anonymously, and the candidate is marked so', async () => {
    // Arrange
    const fetch = fakeFetch({
      [`${REL}/latest`]: (init) => (init.headers.Authorization ? { status: 401 } : { body: release() }),
      [ASSET_URL]: { body: m },
    });
    // Act
    const r = await fromGithub({ fetch, repo: 'Portll/commitwork', channel: 'stable', token: 'ghp_' + 'x'.repeat(30) });
    // Assert
    assert.equal(r.candidates[0].anonymous, true);
    assert.match(r.errors[0], /refused \(HTTP 401\)/);
  });

  test('no release, no asset and an unreadable asset are each reported', async () => {
    // Arrange
    const none = fakeFetch({ [`${REL}?per_page=10`]: { body: [] } });
    const noAsset = fakeFetch({ [`${REL}/latest`]: { body: release({ assets: [] }) } });
    const badAsset = fakeFetch({ [`${REL}/latest`]: { body: release() }, [ASSET_URL]: { status: 500 } });
    const down = fakeFetch({ [`${REL}/latest`]: { status: 503 } });
    // Act
    const [a, b, c, d] = await Promise.all([
      fromGithub({ fetch: none, repo: 'Portll/commitwork', channel: 'beta' }),
      fromGithub({ fetch: noAsset, repo: 'Portll/commitwork', channel: 'stable' }),
      fromGithub({ fetch: badAsset, repo: 'Portll/commitwork', channel: 'stable' }),
      fromGithub({ fetch: down, repo: 'Portll/commitwork', channel: 'stable' }),
    ]);
    // Assert
    assert.match(a.errors[0], /no release/);
    assert.match(b.errors[0], /no portll-update\.json asset/);
    assert.match(c.errors[0], /HTTP 500/);
    assert.match(d.errors[0], /HTTP 503/);
  });
});

describe('getFollowing and readLimited', () => {
  test('a cross-origin redirect is followed without the Authorization header', async () => {
    // Arrange
    const fetch = fakeFetch({
      'https://api.github.com/a': { status: 302, headers: { location: 'https://objects.example.com/b' } },
      'https://objects.example.com/b': { body: 'ok' },
    });
    // Act
    const buf = await getFollowing(fetch, 'https://api.github.com/a', { Authorization: 'Bearer t' }, 10);
    // Assert
    assert.equal(buf.toString(), 'ok');
    assert.equal(fetch.calls[0].init.redirect, 'manual');
    assert.equal(fetch.calls[1].init.headers.Authorization, undefined);
  });

  test('a same-origin redirect keeps the headers', async () => {
    // Arrange
    const fetch = fakeFetch({
      'https://api.github.com/a': { status: 301, headers: { location: '/b' } },
      'https://api.github.com/b': { body: 'ok' },
    });
    // Act
    await getFollowing(fetch, 'https://api.github.com/a', { Authorization: 'Bearer t' }, 10);
    // Assert
    assert.equal(fetch.calls[1].init.headers.Authorization, 'Bearer t');
  });

  test('redirects to http, without a location, or in a loop are refused', async () => {
    // Arrange
    const fetch = fakeFetch({
      'https://h.example/http': { status: 302, headers: { location: 'http://h.example/x' } },
      'https://h.example/none': { status: 302 },
      'https://h.example/loop': { status: 302, headers: { location: 'https://h.example/loop' } },
    });
    // Act
    const results = await Promise.allSettled(['http', 'none', 'loop'].map((p) => getFollowing(fetch, `https://h.example/${p}`, {}, 10)));
    // Assert
    assert.match(results[0].reason.message, /non-https/);
    assert.match(results[1].reason.message, /no location/);
    assert.match(results[2].reason.message, /more than 5 redirects/);
  });

  test('a body over the limit is refused, by header or by stream', async () => {
    // Arrange
    const byHeader = new Response('12345', { headers: { 'content-length': '5' } });
    const byStream = new Response('123456');
    const noStream = { headers: { get: () => null }, body: null, arrayBuffer: async () => new Uint8Array(6).buffer };
    const noStreamOk = { headers: { get: () => null }, body: null, arrayBuffer: async () => new Uint8Array(2).buffer };
    // Act
    const results = await Promise.allSettled([readLimited(byHeader, 4), readLimited(byStream, 5), readLimited(noStream, 5), readLimited(noStreamOk, 5)]);
    // Assert
    assert.match(results[0].reason.message, /5 bytes, over the 4/);
    assert.match(results[1].reason.message, /over the 5 bytes/);
    assert.match(results[2].reason.message, /over the 5 bytes/);
    assert.equal(results[3].value.length, 2);
  });
});

describe('downloadArtifact', () => {
  const bytes = Buffer.from('the tarball');
  const m = manifestFor({ key, bytes });
  const artifact = m.artifacts[0];
  const ghRelease = { tag_name: 'v9.9.9', assets: [{ name: artifact.name, url: `${REL}/assets/7` }] };

  test('a Worker manifest downloads from the Worker URL first', async () => {
    // Arrange
    const fetch = fakeFetch({ [artifact.url]: { body: bytes } });
    // Act
    const r = await downloadArtifact({ fetch, artifact, candidate: { source: 'portll' }, token: 'tok' });
    // Assert
    assert.equal(r.from, 'portll');
    assert.equal(r.bytes.toString(), 'the tarball');
    assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('falls back to the GitHub asset, looking the release up by tag', async () => {
    // Arrange
    const fetch = fakeFetch({
      [artifact.url]: { status: 404 },
      [`${REL}/tags/v9.9.9`]: { body: ghRelease },
      [`${REL}/assets/7`]: { body: bytes },
    });
    // Act
    const r = await downloadArtifact({ fetch, artifact, candidate: { source: 'portll' }, token: null });
    // Assert
    assert.equal(r.from, 'github');
    assert.match(r.errors[0], /portll: .*HTTP 404/);
  });

  test('a GitHub manifest downloads from its own release first, anonymously when the token was refused', async () => {
    // Arrange
    const fetch = fakeFetch({ [`${REL}/assets/7`]: { body: bytes } });
    // Act
    const r = await downloadArtifact({ fetch, artifact, candidate: { source: 'github', release: ghRelease, anonymous: true }, token: 'tok' });
    // Assert
    assert.equal(r.from, 'github');
    assert.equal(fetch.calls[0].init.headers.Authorization, undefined);
  });

  test('a body larger than the signed size is refused, and every failure is reported', async () => {
    // Arrange
    const noGithub = { ...artifact, github: undefined };
    const fetch = fakeFetch({ [artifact.url]: { body: Buffer.concat([bytes, Buffer.from('extra')]) } });
    const missingAsset = fakeFetch({ [artifact.url]: { status: 500 }, [`${REL}/tags/v9.9.9`]: { body: { tag_name: 'v9.9.9', assets: [] } } });
    // Act
    const a = await downloadArtifact({ fetch, artifact: noGithub, candidate: { source: 'portll' } });
    const b = await downloadArtifact({ fetch: missingAsset, artifact, candidate: { source: 'portll' } });
    // Assert
    assert.equal(a.bytes, null);
    assert.match(a.errors.join('\n'), /over the 11 bytes/);
    assert.match(a.errors.join('\n'), /names no GitHub release asset/);
    assert.match(b.errors[1], /no asset commitwork-9\.9\.9\.tgz/);
  });
});
