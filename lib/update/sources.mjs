// lib/update/sources.mjs — where a portll-update@1 manifest and its artifact are fetched from:
// the Worker at updates.portll.net first, then GitHub Releases (contract sections 4 and 5).
// `fetch` is injected so tests serve both without a network.
//
// commitwork is public: the Worker is asked with no Authorization header, ever, and a token, when
// there is one, goes only to api.github.com, for its rate limit. GitHub answers an asset download
// with a redirect to another host; that redirect is followed by hand WITHOUT the header, so the
// token cannot travel with it.

export const PORTLL_BASE = 'https://updates.portll.net/v1';
export const GITHUB_API = 'https://api.github.com';
export const MANIFEST_ASSET = 'portll-update.json';
export const SOURCES = Object.freeze(['portll', 'github']);
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_REDIRECTS = 5;

class SourceError extends Error {}

/** The response body, refused once it passes `max` bytes. */
export async function readLimited(res, max) {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) throw new SourceError(`the response is ${len} bytes, over the ${max} expected`);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new SourceError(`the response is over the ${max} bytes expected`);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new SourceError(`the response is over the ${max} bytes expected`); }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

const ghHeaders = (token, accept = 'application/vnd.github+json') => ({
  Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'commitwork-update',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** GET with redirects followed by hand; headers go to the first host only. */
export async function getFollowing(fetch, url, headers, max) {
  let current = url, h = headers;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try { res = await fetch(current, { headers: h, redirect: 'manual' }); }
    catch (e) { throw new SourceError(`${current}: ${e.message}`); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers?.get?.('location');
      if (!loc) throw new SourceError(`${current}: HTTP ${res.status} with no location`);
      const next = new URL(loc, current);
      if (next.protocol !== 'https:') throw new SourceError(`${current}: redirected to a non-https URL`);
      if (next.origin !== new URL(current).origin) h = { 'User-Agent': 'commitwork-update' };
      current = next.href;
      continue;
    }
    if (res.status !== 200) throw new SourceError(`${current}: HTTP ${res.status}`);
    return readLimited(res, max);
  }
  throw new SourceError(`${url}: more than ${MAX_REDIRECTS} redirects`);
}

const parseJson = (buf, where) => {
  try { return JSON.parse(buf.toString('utf8')); }
  catch (e) { throw new SourceError(`${where}: not JSON (${e.message})`); }
};

/** Manifests from the Worker. A beta install also reads stable: it takes whichever is higher. */
export async function fromPortll({ fetch, product, channel }) {
  const channels = channel === 'beta' ? ['beta', 'stable'] : ['stable'];
  const out = [], errors = [];
  for (const c of channels) {
    const url = `${PORTLL_BASE}/${product}/${c}/latest.json`;
    try {
      const manifest = parseJson(await getFollowing(fetch, url, { Accept: 'application/json', 'User-Agent': 'commitwork-update' }, MAX_MANIFEST_BYTES), url);
      out.push({ source: 'portll', url, manifest });
    } catch (e) { errors.push(e.message); }
  }
  return { candidates: out, errors };
}

/** Manifests from GitHub Releases: stable is the latest release, beta the newest, prereleases included. */
export async function fromGithub({ fetch, repo, channel, token }) {
  const r = await githubOnce({ fetch, repo, channel, token });
  // A stale or revoked token gets 401 where no token would succeed: the repository is public.
  if (token && r.errors.some((e) => e.endsWith('HTTP 401'))) {
    const anon = await githubOnce({ fetch, repo, channel, token: null });
    return { candidates: anon.candidates.map((c) => ({ ...c, anonymous: true })), errors: ['the GitHub token was refused (HTTP 401); asked anonymously instead', ...anon.errors] };
  }
  return r;
}

async function githubOnce({ fetch, repo, channel, token }) {
  const url = channel === 'beta' ? `${GITHUB_API}/repos/${repo}/releases?per_page=10` : `${GITHUB_API}/repos/${repo}/releases/latest`;
  let releases;
  try {
    const body = parseJson(await getFollowing(fetch, url, ghHeaders(token), 4 * 1024 * 1024), url);
    releases = (Array.isArray(body) ? body : [body]).filter((r) => r && !r.draft);
  } catch (e) { return { candidates: [], errors: [e.message] }; }
  const release = releases[0];
  if (!release) return { candidates: [], errors: [`${url}: no release`] };
  const asset = (release.assets || []).find((a) => a.name === MANIFEST_ASSET);
  if (!asset) return { candidates: [], errors: [`${repo} ${release.tag_name}: no ${MANIFEST_ASSET} asset`] };
  try {
    const manifest = parseJson(await getFollowing(fetch, asset.url, ghHeaders(token, 'application/octet-stream'), MAX_MANIFEST_BYTES), asset.url);
    return { candidates: [{ source: 'github', url: asset.url, manifest, release }], errors: [] };
  } catch (e) { return { candidates: [], errors: [e.message] }; }
}

/**
 * The artifact's bytes, from the source that supplied the manifest first and the other second.
 * Size is enforced while reading; the caller checks sha256.
 */
export async function downloadArtifact({ fetch, artifact, candidate, token: given }) {
  const token = candidate.anonymous ? null : given;
  const tries = [];
  const viaPortll = () => getFollowing(fetch, artifact.url, { 'User-Agent': 'commitwork-update' }, artifact.size);
  const viaGithub = async () => {
    const g = artifact.github;
    if (!g) throw new SourceError('the artifact names no GitHub release asset');
    let release = candidate.release;
    if (!release || release.tag_name !== g.tag) {
      const url = `${GITHUB_API}/repos/${g.repo}/releases/tags/${encodeURIComponent(g.tag)}`;
      release = parseJson(await getFollowing(fetch, url, ghHeaders(token), 4 * 1024 * 1024), url);
    }
    const asset = (release.assets || []).find((a) => a.name === g.asset);
    if (!asset) throw new SourceError(`${g.repo} ${g.tag}: no asset ${g.asset}`);
    return getFollowing(fetch, asset.url, ghHeaders(token, 'application/octet-stream'), artifact.size);
  };
  const order = candidate.source === 'github' ? [['github', viaGithub], ['portll', viaPortll]] : [['portll', viaPortll], ['github', viaGithub]];
  for (const [name, get] of order) {
    try { return { bytes: await get(), from: name, errors: tries }; }
    catch (e) { tries.push(`${name}: ${e.message}`); }
  }
  return { bytes: null, from: null, errors: tries };
}
