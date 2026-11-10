// A thin GitHub REST client for the dispatcher. The token and fetch are passed in; nothing here
// reads the environment. GETs are ETag-conditional: GitHub does not charge a 304 against the rate
// limit, so an unchanged answer is served from the cache for free. Every failure is a GithubError.

export class GithubError extends Error {
  constructor(status, reason, where) {
    super(`${where}: ${status} ${reason}`);
    this.name = 'GithubError';
    this.status = status;
    this.reason = reason;
    this.where = where;
  }
}

const API = 'https://api.github.com';
const CACHE_MAX = 512;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const RUN_STATUSES = new Set(['queued', 'in_progress']);

const repoPath = (repo) => {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new GithubError(0, 'not an owner/name repository', String(repo));
  return `/repos/${repo}`;
};

const idOf = (n, what) => {
  if (!Number.isSafeInteger(n) || n <= 0) throw new GithubError(0, `not a ${what} id`, String(n));
  return n;
};

const contentPath = (path, sha) => {
  const parts = String(path).split('/');
  if (!path || parts.some((p) => !p || p === '.' || p === '..')) throw new GithubError(0, 'not a repository-relative path', String(path));
  if (!SHA_RE.test(String(sha))) throw new GithubError(0, 'not a commit sha', String(sha));
  return `/contents/${parts.map(encodeURIComponent).join('/')}?ref=${sha}`;
};

function reasonOf(body, res) {
  const limited = res.headers.get('x-ratelimit-remaining') === '0' ? 'rate limited: ' : '';
  return limited + (body && typeof body.message === 'string' ? body.message : res.statusText || 'request failed');
}

async function readBody(res, where) {
  let text;
  try { text = await res.text(); } catch (e) { throw new GithubError(res.status, `body unreadable: ${e.code || e.message}`, where); }
  if (!text) return null;
  try { return JSON.parse(text); } catch { throw new GithubError(res.status, 'body is not JSON', where); }
}

function listOf(body, key, where) {
  if (!body || !Array.isArray(body[key])) throw new GithubError(200, `response has no ${key} list`, where);
  return body[key];
}

function decodeFile(body, where) {
  if (!body || body.type !== 'file' || body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new GithubError(200, `not a decodable file (${body?.type}/${body?.encoding})`, where);
  }
  return Buffer.from(body.content, 'base64').toString('utf8');
}

/** A client over an injected fetch. `token` is the dispatcher's PAT. */
export function createGithub({ token, fetch: fetchImpl, base = API, cacheMax = CACHE_MAX } = {}) {
  if (typeof token !== 'string' || !token) throw new GithubError(0, 'no token given', 'createGithub');
  if (typeof fetchImpl !== 'function') throw new GithubError(0, 'no fetch given', 'createGithub');
  const cache = new Map();
  const remember = (url, entry) => {
    cache.delete(url);
    cache.set(url, entry);
    if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
  };

  async function send(method, path, body) {
    const url = base + path;
    const where = `${method} ${path}`;
    const cached = method === 'GET' ? cache.get(url) : undefined;
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'commitwork-runner',
    };
    if (cached) headers['if-none-match'] = cached.etag;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new GithubError(0, `network: ${e.code || e.message}`, where);
    }
    if (res.status === 304 && cached) { remember(url, cached); return cached.body; }
    const parsed = await readBody(res, where);
    if (res.status < 200 || res.status > 299) throw new GithubError(res.status, reasonOf(parsed, res), where);
    const etag = res.headers.get('etag');
    if (method === 'GET' && etag) remember(url, { etag, body: parsed });
    return parsed;
  }

  // Every method is async, so a bad argument rejects like any other failure instead of throwing.
  const get = (path) => send('GET', path);
  return {
    repoMeta: async (repo) => get(repoPath(repo)),
    forkApproval: async (repo) => get(`${repoPath(repo)}/actions/permissions/fork-pr-contributor-approval`),
    async runs(repo, status = 'queued') {
      if (!RUN_STATUSES.has(status)) throw new GithubError(0, `run status ${status} is not polled`, 'runs');
      const path = `${repoPath(repo)}/actions/runs?status=${status}&per_page=100`;
      return listOf(await get(path), 'workflow_runs', path);
    },
    async runJobs(repo, runId) {
      const path = `${repoPath(repo)}/actions/runs/${idOf(runId, 'run')}/jobs?filter=latest&per_page=100`;
      return listOf(await get(path), 'jobs', path);
    },
    async fileAt(repo, path, sha) {
      const url = repoPath(repo) + contentPath(path, sha);
      return decodeFile(await get(url), url);
    },
    async runners(repo) {
      const path = `${repoPath(repo)}/actions/runners?per_page=100`;
      return listOf(await get(path), 'runners', path);
    },
    deleteRunner: async (repo, runnerId) => send('DELETE', `${repoPath(repo)}/actions/runners/${idOf(runnerId, 'runner')}`),
    async generateJitConfig(repo, { name, labels, workFolder = '_work' } = {}) {
      const path = `${repoPath(repo)}/actions/runners/generate-jitconfig`;
      if (typeof name !== 'string' || !name) throw new GithubError(0, 'no runner name given', path);
      if (!Array.isArray(labels) || !labels.length) throw new GithubError(0, 'no labels given', path);
      return send('POST', path, { name, runner_group_id: 1, labels, work_folder: workFolder });
    },
    cancelRun: async (repo, runId) => send('POST', `${repoPath(repo)}/actions/runs/${idOf(runId, 'run')}/cancel`),
  };
}
