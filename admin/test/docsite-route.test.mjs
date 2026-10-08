// docsite routes, invoked directly with a fake ctx that mimics the REAL dispatcher contract
// ({req, res, pathname, query, adminSession, isLoopbackReq}) — the comments.mjs lesson is that an
// auth gate reading a field the dispatcher never passes ALWAYS OPENS, so these tests assert the
// refusals actually fire, not merely that the happy path works. The serve.mjs-level witnesses
// (panel POSTs still CSRF-refused with the docsite branch wired; host isolation) belong to
// admin/test/docsite-serve.test.mjs, written with the serve.mjs wiring.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
// MUST be set before any test invokes a mutating handler: handleSave/State/Import/Reorder/Restore
// each call rebuildAndDeploy(), which — unless this is set — runs a REAL `wrangler pages deploy`
// against whatever CW_DOCSITE_PROJECT this process's environment names (the real production
// project, by default). Measured 2026-08-29: running this file without this line live-deployed
// fixture content to i.commitwork.online three times in one run (once per test exercising
// handleSave against the 'published' alpha fixture doc). This line is what stops that, for THIS
// process and any other session that runs this same file — it's set unconditionally at module
// load, not opt-in.
process.env.CW_DOCSITE_SKIP_DEPLOY = '1';

import { routes, docsiteHandle, docsiteOrigins, docsiteHosts } from '../routes/docsite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE = join(REPO, 'bin', 'test', 'fixtures', 'docsite');
const ALPHA_UUID = '0a1b2c3d-1111-4222-8333-444455556666';
const sha = (s) => createHash('sha256').update(s).digest('hex');

const handlerFor = (method, path) => {
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handle;
};

class FakeReq extends EventEmitter {
  constructor({ method = 'GET', headers = {} } = {}) { super(); this.method = method; this.headers = headers; }
  destroy() { this.emit('end'); }
}
class FakeRes {
  constructor() {
    this.headers = {};
    this.done = new Promise((res) => { this._resolve = res; });
  }
  writeHead(code, headers = {}) { this.code = code; Object.assign(this.headers, headers); }
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  end(buf) { this.body = buf === undefined ? '' : buf; this._resolve(this); }
  get json() { return JSON.parse(this.body.toString()); }
}

const call = async (handler, { method = 'GET', pathname = '/', query = '', body, session = false, loopback = false, headers = {} } = {}) => {
  const req = new FakeReq({ method, headers });
  const res = new FakeRes();
  const ctx = {
    req, res, pathname, query: new URLSearchParams(query),
    adminSession: () => (session ? { user: 'op' } : null),
    isLoopbackReq: loopback,
  };
  const handled = handler(ctx);
  if (method === 'POST') {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  }
  if (handled === false) return { handled: false };
  await res.done;
  return res;
};

const freshRoot = ({ build = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-docsite-rtest-'));
  cpSync(FIXTURE, root, { recursive: true });
  process.env.CW_DOCSITE_ROOT = root;
  if (build) execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs')], { env: { ...process.env, CW_DOCSITE_ROOT: root }, stdio: 'pipe' });
  return root;
};
const alphaMd = (root) => readFileSync(join(root, 'content', 'alpha.md'), 'utf8');

describe('docsite API gates', () => {
  test('save without session and without loopback is refused, and writes nothing', async () => {
    const root = freshRoot({ build: false });
    const before = alphaMd(root);
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', body: { slug: 'alpha', content: '# replaced', baseHash: sha(before) },
    });
    assert.equal(res.code, 401);
    assert.equal(alphaMd(root), before, 'refusal must not write');
  });

  test('list and doc are session-gated too', async () => {
    freshRoot({ build: false });
    assert.equal((await call(handlerFor('GET', '/api/docsite/list'))).code, 401);
    assert.equal((await call(handlerFor('GET', '/api/docsite/doc'), { query: 'slug=alpha' })).code, 401);
    assert.equal((await call(handlerFor('GET', '/api/docsite/list'), { session: true })).code, 200);
  });
});

describe('docsite save contract', () => {
  test('happy path: writes md, regenerates page, returns the new hash', async () => {
    const root = freshRoot();
    const before = alphaMd(root);
    const next = `${before}\nAppended by test.\n`;
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: next, baseHash: sha(before) },
    });
    assert.equal(res.code, 200);
    assert.equal(res.json.newHash, sha(next));
    assert.equal(alphaMd(root), next);
    const page = readFileSync(join(root, 'pages', ALPHA_UUID, 'index.html'), 'utf8');
    assert.ok(page.includes('Appended by test.'));
    assert.ok(page.includes(`data-src-sha256="${sha(next)}"`), 'page hash tracks the new source');
  });

  test('identical save is an idempotent no-op', async () => {
    const root = freshRoot();
    const cur = alphaMd(root);
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: cur, baseHash: sha(cur) },
    });
    assert.equal(res.code, 200);
    assert.equal(res.json.unchanged, true);
  });

  test('stale baseHash: 409 carrying the current hash AND content', async () => {
    const root = freshRoot();
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: '# mine', baseHash: sha('not the current content') },
    });
    assert.equal(res.code, 409);
    assert.equal(res.json.conflict, true);
    assert.equal(res.json.currentHash, sha(alphaMd(root)));
    assert.equal(res.json.currentContent, alphaMd(root));
  });

  test('NUL bytes are refused before any write', async () => {
    const root = freshRoot({ build: false });
    const before = alphaMd(root);
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: `bad${String.fromCharCode(0)}byte`, baseHash: sha(before) },
    });
    assert.equal(res.code, 422);
    assert.equal(alphaMd(root), before);
  });

  test('traversal-shaped and unknown slugs die at the vocabulary', async () => {
    freshRoot({ build: false });
    const bad = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: '../../etc/passwd', content: 'x', baseHash: sha('') },
    });
    assert.equal(bad.code, 400);
    const missing = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'nosuch', content: 'x', baseHash: sha('') },
    });
    assert.equal(missing.code, 404);
  });

  test('imported snapshots are not editable', async () => {
    freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'legacy', content: 'x', baseHash: sha('') },
    });
    assert.equal(res.code, 404);
  });

  test('a missing manifest is 503, never an empty site', async () => {
    const root = freshRoot({ build: false });
    rmSync(join(root, 'manifest.json'));
    const res = await call(handlerFor('GET', '/api/docsite/list'), { session: true });
    assert.equal(res.code, 503);
  });
});

describe('declaration source: registry-derived, env-overridden, fail closed', () => {
  const swapEnv = (patch, fn) => {
    const prev = {};
    for (const [k, v] of Object.entries(patch)) {
      prev[k] = process.env[k];
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try { return fn(); } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };

  test('hostnames derive from the registry commitwork-docsite area; origins are their https form', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-reg-'));
    const reg = join(dir, 'projects.json');
    writeFileSync(reg, JSON.stringify({ areas: [{ slug: 'commitwork-docsite', deploy: { hostnames: ['i.docsite.example'], public: true, requiresAuth: false, hosting: 'pages' } }] }));
    swapEnv({ CW_REGISTRY: reg, CW_DOCSITE_ORIGINS: undefined, CW_DOCSITE_HOSTS: undefined }, () => {
      assert.deepEqual([...docsiteHosts()], ['i.docsite.example']);
      assert.deepEqual([...docsiteOrigins()], ['https://i.docsite.example']);
    });
  });

  test('a broken or absent registry yields ZERO hostnames — never a guess', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-reg-'));
    const broken = join(dir, 'projects.json');
    writeFileSync(broken, '{ not json');
    swapEnv({ CW_REGISTRY: broken, CW_DOCSITE_ORIGINS: undefined, CW_DOCSITE_HOSTS: undefined }, () => {
      assert.equal(docsiteHosts().size, 0);
      assert.equal(docsiteOrigins().size, 0);
    });
    swapEnv({ CW_REGISTRY: join(dir, 'nope.json'), CW_DOCSITE_ORIGINS: undefined, CW_DOCSITE_HOSTS: undefined }, () => {
      assert.equal(docsiteHosts().size, 0);
    });
  });

  test('the env override wins over the registry when set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-docsite-reg-'));
    const reg = join(dir, 'projects.json');
    writeFileSync(reg, JSON.stringify({ areas: [{ slug: 'commitwork-docsite', deploy: { hostnames: ['from-registry.example'] } }] }));
    swapEnv({ CW_REGISTRY: reg, CW_DOCSITE_HOSTS: 'from-env.example', CW_DOCSITE_ORIGINS: 'https://from-env.example' }, () => {
      assert.deepEqual([...docsiteHosts()], ['from-env.example']);
      assert.deepEqual([...docsiteOrigins()], ['https://from-env.example']);
    });
  });
});

describe('docsiteHandle: cross-origin gate and public serving', () => {
  const ORIGIN = 'https://i.commitwork.online';
  // CW_REGISTRY is pinned to a nonexistent path: this suite tests the ENV-declared behavior, and
  // since the live registry genuinely declares the docsite area now, an empty env would otherwise
  // fall through to a real declaration and "no declared origins" would silently stop being true.
  const withOrigins = async (value, fn) => {
    const prev = process.env.CW_DOCSITE_ORIGINS;
    const prevReg = process.env.CW_REGISTRY;
    process.env.CW_DOCSITE_ORIGINS = value;
    process.env.CW_REGISTRY = '/nonexistent-cw-registry-isolated-for-test';
    try { return await fn(); } finally {
      if (prev === undefined) delete process.env.CW_DOCSITE_ORIGINS; else process.env.CW_DOCSITE_ORIGINS = prev;
      if (prevReg === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = prevReg;
    }
  };

  test('fail closed: with no declared origins, preflight is refused', async () => {
    freshRoot({ build: false });
    await withOrigins('', async () => {
      const res = await call(docsiteHandle, { method: 'OPTIONS', pathname: '/api/docsite/save', headers: { origin: ORIGIN } });
      assert.equal(res.code, 403);
    });
  });

  test('declared origin: preflight 204 with exact-origin CORS headers', async () => {
    freshRoot({ build: false });
    await withOrigins(ORIGIN, async () => {
      const res = await call(docsiteHandle, { method: 'OPTIONS', pathname: '/api/docsite/save', headers: { origin: ORIGIN } });
      assert.equal(res.code, 204);
      assert.equal(res.headers['access-control-allow-origin'], ORIGIN);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
      assert.equal(res.headers.vary, 'origin');
    });
  });

  test('undeclared-origin POST falls through to the same-host chain (no CORS bypass)', async () => {
    freshRoot({ build: false });
    await withOrigins(ORIGIN, async () => {
      const r = await call(docsiteHandle, { method: 'POST', pathname: '/api/docsite/save', headers: { origin: 'https://evil.example' } });
      assert.equal(r.handled, false);
    });
  });

  test('declared-origin save works, session still required, CORS headers attached', async () => {
    const root = freshRoot();
    await withOrigins(ORIGIN, async () => {
      const unauth = await call(docsiteHandle, {
        method: 'POST', pathname: '/api/docsite/save', headers: { origin: ORIGIN },
        body: { slug: 'alpha', content: '# x', baseHash: sha(alphaMd(root)) },
      });
      assert.equal(unauth.code, 401, 'origin match is not authentication');
      const before = alphaMd(root);
      const next = `${before}\ncross-origin edit\n`;
      const ok = await call(docsiteHandle, {
        method: 'POST', pathname: '/api/docsite/save', session: true, headers: { origin: ORIGIN },
        body: { slug: 'alpha', content: next, baseHash: sha(before) },
      });
      assert.equal(ok.code, 200);
      assert.equal(ok.headers['access-control-allow-origin'], ORIGIN);
      assert.equal(alphaMd(root), next);
    });
  });

  test('public page serving is manifest-gated with an etag', async () => {
    const root = freshRoot();
    const res = await call(docsiteHandle, { pathname: `/${ALPHA_UUID}/` });
    assert.equal(res.code, 200);
    assert.ok(res.headers.etag);
    assert.ok(res.body.toString().includes('Alpha doc'));
    const cached = await call(docsiteHandle, { pathname: `/${ALPHA_UUID}/`, headers: { 'if-none-match': res.headers.etag } });
    assert.equal(cached.code, 304);
    const unknown = await call(docsiteHandle, { pathname: '/deadbeef-dead-4bee-8fde-adbeefdeadbe/' });
    assert.equal(unknown.handled, false, 'undeclared path falls through — the panel 404s it');
    const imported = await call(docsiteHandle, { pathname: '/legacy' });
    assert.equal(imported.code, 200);
    assert.ok(imported.body.toString().includes('Legacy import'));
  });

  test('an inherited property name is not an editor asset', async () => {
    freshRoot();
    for (const pathname of ['constructor', '__proto__', 'toString']) {
      const r = await call(docsiteHandle, { pathname });
      assert.equal(r.handled, false, `${pathname} was answered as an asset (${r.code})`);
    }
  });

  test('declared-but-unreadable page is 503, not 404 and not empty', async () => {
    const root = freshRoot();
    rmSync(join(root, 'pages', ALPHA_UUID, 'index.html'));
    const res = await call(docsiteHandle, { pathname: `/${ALPHA_UUID}/` });
    assert.equal(res.code, 503);
  });

  test('a REAL symlink at a served path pointing outside the root is refused (realpath, not string prefix)', async () => {
    const root = freshRoot();
    const page = join(root, 'pages', ALPHA_UUID, 'index.html');
    rmSync(page);
    // The joined path is inside the root; only realpath disagrees. A confinement check that
    // strips ../ or prefix-matches the unresolved path cannot see this hole.
    symlinkSync('/etc/hosts', page);
    const res = await call(docsiteHandle, { pathname: `/${ALPHA_UUID}/` });
    assert.equal(res.code, 404, `symlink target must not serve (got ${res.code})`);
    assert.ok(!String(res.body).includes('localhost'), 'no bytes of the symlink target may leak');
  });
});

// ── sync / import / state / reorder / versions / restore ────────────────────────────────────────
// CW_DOCSITE_SKIP_DEPLOY is set unconditionally at the top of this file, so every route below runs
// its real write logic but never touches the network — rebuildAndDeploy() returns a fixed,
// recognisable stand-in ('(deploy skipped: CW_DOCSITE_SKIP_DEPLOY)'), which doubles as proof the
// deploy step actually fired (or didn't) rather than something a mock silently swallowed.
const manifestHashOf = (root) => sha(readFileSync(join(root, 'manifest.json'), 'utf8'));
const manifestOf = (root) => JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const SKIP_MARK = '(deploy skipped: CW_DOCSITE_SKIP_DEPLOY)';

describe('docsite sync / import', () => {
  test('candidates lists an undeclared imported/*.html and never a declared one', async () => {
    const root = freshRoot({ build: false });
    writeFileSync(join(root, 'imported', 'fresh-note.html'), '<!doctype html><title>A Fresh Note</title><body>hi</body>');
    const res = await call(handlerFor('GET', '/api/docsite/candidates'), { session: true });
    assert.equal(res.code, 200);
    assert.equal(res.json.candidates.length, 1);
    const c = res.json.candidates[0];
    assert.equal(c.file, 'fresh-note.html');
    assert.equal(c.suggestedSlug, 'fresh-note');
    assert.equal(c.suggestedTitle, 'A Fresh Note');
    assert.ok(!res.json.candidates.some((x) => x.file === 'legacy.html'), 'legacy.html is already declared');
  });

  test('candidates gated on session/loopback', async () => {
    freshRoot({ build: false });
    assert.equal((await call(handlerFor('GET', '/api/docsite/candidates'))).code, 401);
  });

  test('import: mints a uuid urlPath, lands hidden, and deploys', async () => {
    const root = freshRoot({ build: false });
    writeFileSync(join(root, 'imported', 'fresh-note.html'), '<!doctype html><title>t</title><body>hi</body>');
    const res = await call(handlerFor('POST', '/api/docsite/import'), {
      method: 'POST', loopback: true,
      body: { file: 'fresh-note.html', slug: 'fresh-note', title: 'A Fresh Note', public: false, baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.match(res.json.urlPath, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(res.json.deployOutput, SKIP_MARK);
    const doc = manifestOf(root).docs.find((d) => d.slug === 'fresh-note');
    assert.ok(doc, 'new entry present in manifest');
    assert.equal(doc.kind, 'imported');
    assert.equal(doc.state, 'hidden');
    assert.equal(doc.source, 'imported/fresh-note.html');
  });

  test('import with public:true mints urlPath = slug', async () => {
    const root = freshRoot({ build: false });
    writeFileSync(join(root, 'imported', 'fresh-note.html'), '<!doctype html><title>t</title><body>hi</body>');
    const res = await call(handlerFor('POST', '/api/docsite/import'), {
      method: 'POST', loopback: true,
      body: { file: 'fresh-note.html', slug: 'fresh-note', title: 'A Fresh Note', public: true, baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 200);
    assert.equal(res.json.urlPath, 'fresh-note');
  });

  test('import refuses a slug that already exists', async () => {
    const root = freshRoot({ build: false });
    writeFileSync(join(root, 'imported', 'fresh-note.html'), '<!doctype html><title>t</title><body>hi</body>');
    const res = await call(handlerFor('POST', '/api/docsite/import'), {
      method: 'POST', loopback: true,
      body: { file: 'fresh-note.html', slug: 'alpha', title: 'x', public: false, baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 409);
    assert.match(res.json.error, /already exists/);
  });

  test('import refuses a file that escapes docsite/imported', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/import'), {
      method: 'POST', loopback: true,
      body: { file: '../manifest.json', slug: 'escape', title: 'x', public: false, baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 400);
  });

  test('import with a stale baseHash is a 409 conflict, writes nothing', async () => {
    const root = freshRoot({ build: false });
    writeFileSync(join(root, 'imported', 'fresh-note.html'), '<!doctype html><title>t</title><body>hi</body>');
    const before = readFileSync(join(root, 'manifest.json'), 'utf8');
    const res = await call(handlerFor('POST', '/api/docsite/import'), {
      method: 'POST', loopback: true,
      body: { file: 'fresh-note.html', slug: 'fresh-note', title: 'x', public: false, baseHash: sha('stale') },
    });
    assert.equal(res.code, 409);
    assert.equal(res.json.conflict, true);
    assert.equal(readFileSync(join(root, 'manifest.json'), 'utf8'), before, 'refusal must not write');
  });
});

describe('docsite state', () => {
  test('changes state and deploys', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true,
      body: { slug: 'beta', state: 'hidden', baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(res.json.deployOutput, SKIP_MARK);
    assert.equal(manifestOf(root).docs.find((d) => d.slug === 'beta').state, 'hidden');
  });

  test('setting the same state is a no-op — unchanged, no deploy field', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true,
      body: { slug: 'alpha', state: 'published', baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 200);
    assert.equal(res.json.unchanged, true);
    assert.equal(res.json.deployOutput, undefined, 'a no-op state change must not deploy');
  });

  test('bad state value is refused', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true,
      body: { slug: 'alpha', state: 'archived', baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 400);
  });

  test('unknown slug is 404', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true,
      body: { slug: 'nosuch', state: 'hidden', baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 404);
  });

  test('stale baseHash is a 409 conflict, writes nothing', async () => {
    const root = freshRoot({ build: false });
    const before = readFileSync(join(root, 'manifest.json'), 'utf8');
    const res = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true,
      body: { slug: 'alpha', state: 'hidden', baseHash: sha('stale') },
    });
    assert.equal(res.code, 409);
    assert.equal(res.json.conflict, true);
    assert.equal(readFileSync(join(root, 'manifest.json'), 'utf8'), before);
  });

  test('gated on session/loopback', async () => {
    freshRoot({ build: false });
    assert.equal((await call(handlerFor('POST', '/api/docsite/state'), { method: 'POST', body: { slug: 'alpha', state: 'hidden', baseHash: sha('') } })).code, 401);
  });
});

describe('docsite reorder', () => {
  test('a valid permutation reorders the manifest and deploys', async () => {
    const root = freshRoot({ build: false });
    const current = manifestOf(root).docs.map((d) => d.slug);
    assert.deepEqual(current, ['alpha', 'beta', 'legacy']);
    const reversed = [...current].reverse();
    const res = await call(handlerFor('POST', '/api/docsite/reorder'), {
      method: 'POST', loopback: true, body: { order: reversed, baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(res.json.deployOutput, SKIP_MARK);
    assert.deepEqual(manifestOf(root).docs.map((d) => d.slug), reversed);
  });

  test('a missing slug is refused — count-in must equal count-out', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/reorder'), {
      method: 'POST', loopback: true, body: { order: ['alpha', 'beta'], baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 400);
    assert.match(res.json.error, /permutation/);
  });

  test('an extra/unknown slug is refused the same way', async () => {
    const root = freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/reorder'), {
      method: 'POST', loopback: true, body: { order: ['alpha', 'beta', 'legacy', 'ghost'], baseHash: manifestHashOf(root) },
    });
    assert.equal(res.code, 400);
  });

  test('stale baseHash is a 409 conflict, writes nothing', async () => {
    const root = freshRoot({ build: false });
    const before = readFileSync(join(root, 'manifest.json'), 'utf8');
    const res = await call(handlerFor('POST', '/api/docsite/reorder'), {
      method: 'POST', loopback: true, body: { order: ['legacy', 'beta', 'alpha'], baseHash: sha('stale') },
    });
    assert.equal(res.code, 409);
    assert.equal(readFileSync(join(root, 'manifest.json'), 'utf8'), before);
  });
});

describe('docsite versions / restore', () => {
  test('a doc with no writes yet has an empty version list, not an error', async () => {
    freshRoot({ build: false });
    const res = await call(handlerFor('GET', '/api/docsite/versions'), {
      session: true, query: `key=${ALPHA_UUID}&origin=editor-save`,
    });
    assert.equal(res.code, 200);
    assert.deepEqual(res.json.versions, []);
  });

  test('bad origin is refused', async () => {
    freshRoot({ build: false });
    const res = await call(handlerFor('GET', '/api/docsite/versions'), { session: true, query: `key=${ALPHA_UUID}&origin=bogus` });
    assert.equal(res.code, 400);
  });

  test('a save snapshots the prior source, and restoring it round-trips the content and re-renders the page', async () => {
    const root = freshRoot();
    const original = alphaMd(root);
    const edited = `${original}\nEdited once.\n`;
    const saved = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: edited, baseHash: sha(original) },
    });
    assert.equal(saved.code, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.deployOutput, SKIP_MARK, 'alpha is published — a save must deploy');

    const listed = await call(handlerFor('GET', '/api/docsite/versions'), { session: true, query: `key=${ALPHA_UUID}&origin=editor-save` });
    assert.equal(listed.code, 200);
    assert.equal(listed.json.versions.length, 1, 'the PRE-edit content was snapshotted once');

    const restore = await call(handlerFor('POST', '/api/docsite/restore'), {
      method: 'POST', loopback: true,
      body: { key: ALPHA_UUID, origin: 'editor-save', id: listed.json.versions[0].id },
    });
    assert.equal(restore.code, 200, JSON.stringify(restore.json));
    assert.equal(restore.json.deployed, true);
    assert.equal(alphaMd(root), original, 'source is back to the pre-edit content');
    const page = readFileSync(join(root, 'pages', ALPHA_UUID, 'index.html'), 'utf8');
    assert.ok(!page.includes('Edited once.'), 'the page was re-rendered from the restored source, not left stale');
  });

  test('restoring a draft doc does not deploy', async () => {
    const root = freshRoot();
    const before = readFileSync(join(root, 'content', 'beta.md'), 'utf8');
    const edited = `${before}\nx\n`;
    await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'beta', content: edited, baseHash: sha(before) },
    });
    const listed = await call(handlerFor('GET', '/api/docsite/versions'), { session: true, query: `key=beta&origin=editor-save` });
    const restore = await call(handlerFor('POST', '/api/docsite/restore'), {
      method: 'POST', loopback: true, body: { key: 'beta', origin: 'editor-save', id: listed.json.versions[0].id },
    });
    assert.equal(restore.code, 200);
    assert.equal(restore.json.deployed, false, 'beta is a draft — nothing live to update');
  });

  test('restoring the manifest itself round-trips a state change', async () => {
    const root = freshRoot({ build: false });
    const state1 = await call(handlerFor('POST', '/api/docsite/state'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', state: 'hidden', baseHash: manifestHashOf(root) },
    });
    assert.equal(state1.code, 200);
    assert.equal(manifestOf(root).docs.find((d) => d.slug === 'alpha').state, 'hidden');

    const listed = await call(handlerFor('GET', '/api/docsite/versions'), { session: true, query: 'key=manifest&origin=generated' });
    assert.equal(listed.json.versions.length, 1, 'the pre-state-change manifest was snapshotted');

    const restore = await call(handlerFor('POST', '/api/docsite/restore'), {
      method: 'POST', loopback: true, body: { key: 'manifest', origin: 'generated', id: listed.json.versions[0].id },
    });
    assert.equal(restore.code, 200, JSON.stringify(restore.json));
    assert.equal(manifestOf(root).docs.find((d) => d.slug === 'alpha').state, 'published', 'back to pre-change state');
  });

  test('restore of a nonexistent version id is 404', async () => {
    freshRoot({ build: false });
    const res = await call(handlerFor('POST', '/api/docsite/restore'), {
      method: 'POST', loopback: true,
      body: { key: ALPHA_UUID, origin: 'editor-save', id: '2026-01-01T00-00-00-000Z-000000000000.snapshot' },
    });
    assert.equal(res.code, 404);
  });

  test('versions and restore are gated on session/loopback', async () => {
    freshRoot({ build: false });
    assert.equal((await call(handlerFor('GET', '/api/docsite/versions'), { query: `key=${ALPHA_UUID}&origin=generated` })).code, 401);
    assert.equal((await call(handlerFor('POST', '/api/docsite/restore'), { method: 'POST', body: { key: ALPHA_UUID, origin: 'generated', id: 'x' } })).code, 401);
  });
});

// ── head / version / git-log / git-show — what the editor's conflict panel, watcher and history
//    pane read. Each is read-only; the tests assert that by hashing the source before and after.
describe('docsite head, version and git history', () => {
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe', env: gitEnv });

  test('head answers the source hash and an ISO mtime, and is gated', async () => {
    const root = freshRoot({ build: false });
    assert.equal((await call(handlerFor('GET', '/api/docsite/head'), { query: 'slug=alpha' })).code, 401);
    const res = await call(handlerFor('GET', '/api/docsite/head'), { session: true, query: 'slug=alpha' });
    assert.equal(res.code, 200);
    assert.equal(res.json.hash, sha(alphaMd(root)));
    assert.ok(Number.isFinite(Date.parse(res.json.mtime)), `mtime is not an ISO date: ${res.json.mtime}`);
    assert.equal((await call(handlerFor('GET', '/api/docsite/head'), { session: true, query: 'slug=legacy' })).code, 404, 'an imported doc has no editable head');
  });

  test('doc carries the same mtime head does, and a stale save 409 carries currentMtime', async () => {
    freshRoot({ build: false });
    const doc = await call(handlerFor('GET', '/api/docsite/doc'), { session: true, query: 'slug=alpha' });
    const head = await call(handlerFor('GET', '/api/docsite/head'), { session: true, query: 'slug=alpha' });
    assert.equal(doc.json.mtime, head.json.mtime);
    const res = await call(handlerFor('POST', '/api/docsite/save'), {
      method: 'POST', loopback: true, body: { slug: 'alpha', content: '# mine', baseHash: sha('stale') },
    });
    assert.equal(res.code, 409);
    assert.equal(res.json.currentMtime, head.json.mtime, 'the 409 names the disk copy\'s mtime so "keep newer" can compare');
  });

  test('version returns a snapshot\'s bytes without restoring it', async () => {
    const root = freshRoot();
    const before = alphaMd(root);
    const next = `${before}\nSecond version.\n`;
    await call(handlerFor('POST', '/api/docsite/save'), { method: 'POST', loopback: true, body: { slug: 'alpha', content: next, baseHash: sha(before) } });
    const listed = await call(handlerFor('GET', '/api/docsite/versions'), { session: true, query: `key=${ALPHA_UUID}&origin=editor-save` });
    assert.equal(listed.json.versions.length, 1);
    const v = await call(handlerFor('GET', '/api/docsite/version'), { session: true, query: `key=${ALPHA_UUID}&origin=editor-save&id=${listed.json.versions[0].id}` });
    assert.equal(v.code, 200, JSON.stringify(v.json));
    assert.equal(v.json.content, before, 'the snapshot is the pre-save content');
    assert.equal(v.json.hash, sha(before));
    assert.equal(alphaMd(root), next, 'reading a version wrote nothing');
    assert.equal((await call(handlerFor('GET', '/api/docsite/version'), { session: true, query: `key=${ALPHA_UUID}&origin=editor-save&id=nope` })).code, 404);
    assert.equal((await call(handlerFor('GET', '/api/docsite/version'), { query: `key=${ALPHA_UUID}&origin=editor-save&id=x` })).code, 401);
  });

  test('git-log on a root that is not a repository says so — available:false, never an empty history', async () => {
    freshRoot({ build: false });
    const res = await call(handlerFor('GET', '/api/docsite/git-log'), { session: true, query: 'slug=alpha' });
    assert.equal(res.code, 200);
    assert.equal(res.json.available, false);
    assert.ok(res.json.reason, 'the reason git gave is passed through');
    assert.deepEqual(res.json.commits, []);
    const show = await call(handlerFor('GET', '/api/docsite/git-show'), { session: true, query: 'slug=alpha&sha=abcdef1' });
    assert.equal(show.code, 404);
  });

  test('git-log lists the commits touching the source; git-show returns the content at a sha; both read-only', async () => {
    const root = freshRoot({ build: false });
    git(root, 'init', '-q');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'first: alpha and beta');
    const v1 = alphaMd(root);
    writeFileSync(join(root, 'content', 'alpha.md'), `${v1}\nedited on disk\n`);
    git(root, 'commit', '-q', '-am', 'second: alpha edited');
    const v2 = alphaMd(root);

    const log = await call(handlerFor('GET', '/api/docsite/git-log'), { session: true, query: 'slug=alpha' });
    assert.equal(log.code, 200, JSON.stringify(log.json));
    assert.equal(log.json.available, true);
    assert.equal(log.json.path, 'content/alpha.md');
    assert.equal(log.json.commits.length, 2);
    assert.equal(log.json.commits[0].subject, 'second: alpha edited', 'newest first');
    assert.match(log.json.commits[0].sha, /^[0-9a-f]{40}$/);
    assert.ok(Number.isFinite(Date.parse(log.json.commits[0].at)));

    const betaLog = await call(handlerFor('GET', '/api/docsite/git-log'), { session: true, query: 'slug=beta' });
    assert.equal(betaLog.json.commits.length, 1, 'beta was only touched by the first commit');

    const old = await call(handlerFor('GET', '/api/docsite/git-show'), { session: true, query: `slug=alpha&sha=${log.json.commits[1].sha}` });
    assert.equal(old.code, 200, JSON.stringify(old.json));
    assert.equal(old.json.content, v1);
    assert.equal(old.json.hash, sha(v1));
    const cur = await call(handlerFor('GET', '/api/docsite/git-show'), { session: true, query: `slug=alpha&sha=${log.json.commits[0].sha.slice(0, 7)}` });
    assert.equal(cur.json.content, v2, 'an abbreviated sha resolves');
    assert.equal(alphaMd(root), v2, 'git-show wrote nothing');

    assert.equal((await call(handlerFor('GET', '/api/docsite/git-show'), { session: true, query: 'slug=alpha&sha=../../etc' })).code, 400, 'a non-hex sha dies at the vocabulary');
    assert.equal((await call(handlerFor('GET', '/api/docsite/git-show'), { session: true, query: 'slug=alpha&sha=0000000' })).code, 404, 'an unknown sha is 404, not empty content');
    assert.equal((await call(handlerFor('GET', '/api/docsite/git-log'), { query: 'slug=alpha' })).code, 401);
    assert.equal((await call(handlerFor('GET', '/api/docsite/git-show'), { query: 'slug=alpha&sha=abcdef1' })).code, 401);
  });
});

describe('docsite duplicate', () => {
  const dup = (root, body) => call(handlerFor('POST', '/api/docsite/duplicate'), { method: 'POST', loopback: true, body: { baseHash: manifestHashOf(root), ...body } });

  test('copies the source into a new private draft and writes nothing else', async () => {
    const root = freshRoot();
    const before = alphaMd(root);
    const res = await dup(root, { slug: 'alpha', newSlug: 'alpha-copy', title: 'Alpha (copy)' });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(res.json.slug, 'alpha-copy');
    assert.equal(res.json.state, 'draft');
    assert.equal(res.json.deployed, false, 'a draft deploys nothing');
    assert.match(res.json.urlPath, /^[0-9a-f-]{36}$/, 'private by default: a fresh uuid, not the slug');
    assert.equal(readFileSync(join(root, 'content', 'alpha-copy.md'), 'utf8'), before);
    assert.equal(alphaMd(root), before, 'the original is untouched');
    const entry = manifestOf(root).docs.find((d) => d.slug === 'alpha-copy');
    assert.deepEqual({ ...entry, urlPath: 'x' }, { slug: 'alpha-copy', urlPath: 'x', title: 'Alpha (copy)', source: 'content/alpha-copy.md', kind: 'md', state: 'draft' });
    const page = readFileSync(join(root, 'pages', res.json.urlPath, 'index.html'), 'utf8');
    assert.ok(page.includes(`data-src-sha256="${sha(before)}"`), 'the page was built from the copied source');
  });

  test('public:true mints urlPath = newSlug', async () => {
    const root = freshRoot();
    const res = await dup(root, { slug: 'alpha', newSlug: 'alpha-pub', title: 'Alpha public', public: true });
    assert.equal(res.code, 200, JSON.stringify(res.json));
    assert.equal(res.json.urlPath, 'alpha-pub');
  });

  test('refuses an existing slug, a same slug, an imported source, an undeclared file on disk, and a stale manifest', async () => {
    const root = freshRoot();
    assert.equal((await dup(root, { slug: 'alpha', newSlug: 'beta', title: 'x' })).code, 409, 'slug taken');
    assert.equal((await dup(root, { slug: 'alpha', newSlug: 'alpha', title: 'x' })).code, 400, 'same slug');
    assert.equal((await dup(root, { slug: 'legacy', newSlug: 'legacy-copy', title: 'x' })).code, 400, 'imported has no md source');
    writeFileSync(join(root, 'content', 'stray.md'), '# undeclared\n');
    assert.equal((await dup(root, { slug: 'alpha', newSlug: 'stray', title: 'x' })).code, 409, 'never overwrite an undeclared file');
    assert.equal(readFileSync(join(root, 'content', 'stray.md'), 'utf8'), '# undeclared\n');
    const stale = await dup(root, { slug: 'alpha', newSlug: 'alpha-two', title: 'x', baseHash: sha('stale') });
    assert.equal(stale.code, 409);
    assert.equal(stale.json.conflict, true);
    assert.ok(!manifestOf(root).docs.some((d) => d.slug === 'alpha-two'), 'a stale baseHash writes nothing');
    assert.equal((await call(handlerFor('POST', '/api/docsite/duplicate'), { method: 'POST', body: { slug: 'alpha', newSlug: 'z', title: 'x', baseHash: sha('x') } })).code, 401);
  });
});

describe('docsite preview shell', () => {
  test('is the published template around an empty body container, gated, md only', async () => {
    freshRoot({ build: false });
    assert.equal((await call(handlerFor('GET', '/docsite/preview-shell'), { query: 'slug=alpha' })).code, 401);
    assert.equal((await call(handlerFor('GET', '/docsite/preview-shell'), { session: true, query: 'slug=legacy' })).code, 404, 'an imported doc has no live body to preview');
    assert.equal((await call(handlerFor('GET', '/docsite/preview-shell'), { session: true, query: 'slug=nope' })).code, 404);
    const res = await call(handlerFor('GET', '/docsite/preview-shell'), { session: true, query: 'slug=alpha' });
    assert.equal(res.code, 200);
    const html = res.body.toString();
    assert.match(html, /<header class="site">/, 'the shell header');
    assert.match(html, /<footer class="site">/, 'the shell footer');
    assert.match(html, /<div id="pv-root"><\/div>/, 'the empty body container the editor fills');
    assert.match(html, /<h1>[^<]*<\/h1>|<h1>[^<]*<span class="badge/, 'the shell renders the manifest title as its own h1');
    assert.match(html, /href="\/docsite\/page\?slug=/, 'nav links resolve on the panel origin, not the public path');
    assert.doesNotMatch(html, /href="\/[0-9a-f-]{36}\/"/, 'no public capability path in the nav');
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

// Draft and hidden documents live in the private root (lib/docsite-roots.mjs). The routes read the
// union of both manifests and write every doc back to the manifest it came from; a new draft starts
// in the private root. CW_DOCSITE_PRIVATE names that root here and is removed after, so no other
// block in this file ever sees one.
describe('docsite routes over a private root', () => {
  const SECRET_UUID = '7e6d5c4b-1111-4222-8333-444455556666';
  const privateRoot = () => {
    const priv = mkdtempSync(join(tmpdir(), 'cw-docsite-rpriv-'));
    mkdirSync(join(priv, 'content'), { recursive: true });
    writeFileSync(join(priv, 'content', 'secret.md'), '# Secret\n\nHidden draft.\n');
    writeFileSync(join(priv, 'manifest.json'), `${JSON.stringify({ version: 1, note: 'fixture', docs: [
      { slug: 'secret', urlPath: SECRET_UUID, title: 'Secret', source: 'content/secret.md', kind: 'md', state: 'hidden' },
    ] }, null, 2)}\n`);
    process.env.CW_DOCSITE_PRIVATE = priv;
    return priv;
  };
  const listOf = async () => (await call(handlerFor('GET', '/api/docsite/list'), { session: true })).json;

  test('list carries private docs, and a state change goes back to the private manifest', async () => {
    try {
      const root = freshRoot({ build: false });
      const priv = privateRoot();
      const list = await listOf();
      assert.ok(list.docs.some((d) => d.slug === 'secret'), 'the private doc is listed');
      const res = await call(handlerFor('POST', '/api/docsite/state'), { method: 'POST', loopback: true, body: { slug: 'secret', state: 'draft', baseHash: list.manifestHash } });
      assert.equal(res.code, 200, JSON.stringify(res.json));
      assert.equal(JSON.parse(readFileSync(join(priv, 'manifest.json'), 'utf8')).docs[0].state, 'draft');
      assert.ok(!JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).docs.some((d) => d.slug === 'secret'),
        'a private doc is never written into the public manifest');
    } finally { delete process.env.CW_DOCSITE_PRIVATE; }
  });

  test('a duplicate starts as a draft in the private root', async () => {
    try {
      const root = freshRoot({ build: false });
      const priv = privateRoot();
      const list = await listOf();
      const res = await call(handlerFor('POST', '/api/docsite/duplicate'), { method: 'POST', loopback: true, body: { slug: 'alpha', newSlug: 'alpha-draft', title: 'Alpha draft', baseHash: list.manifestHash } });
      assert.equal(res.code, 200, JSON.stringify(res.json));
      assert.ok(readFileSync(join(priv, 'content', 'alpha-draft.md'), 'utf8').length > 0);
      assert.ok(!JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).docs.some((d) => d.slug === 'alpha-draft'));
      assert.ok(JSON.parse(readFileSync(join(priv, 'manifest.json'), 'utf8')).docs.some((d) => d.slug === 'alpha-draft'));
    } finally { delete process.env.CW_DOCSITE_PRIVATE; }
  });
});
