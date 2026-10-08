// admin/routes/docsite.mjs — the docsite's server side: authenticated doc read/save/publish APIs,
// the editor's static assets, and (via docsiteHandle, wired in serve.mjs) public serving of
// generated pages for the docsite hostname. The public site itself lives on Cloudflare Pages;
// this box is the DRAFTING origin — saves land here, publish pushes a bundle there.
//
// GATES. Every mutating route requires an operator session OR the loopback operator port
// (requireSessionOrLoopback below — the codeql-remediation gate, NOT comments.mjs's ctx.authed,
// which reads a field the dispatcher never passes and therefore always allows). CSRF: same-host
// requests are covered by serve.mjs's blanket x-cw-csrf gate, which runs before the modular
// dispatcher; requests arriving cross-origin from the DECLARED docsite origin bypass that gate at
// the serve.mjs branch and are gated there by exact Origin match instead — the Origin header is
// browser-controlled and unforgeable from web content, which is the standards-accepted origin-check
// CSRF defense. Both paths still land in the session gate here. Fail closed: no declared origins
// (env unset) means NO cross-origin request is ever accepted.
//
// fact: the save body reader is local (1 MiB cap, Buffer.concat) rather than ctx.readJsonBody /
//   serve.mjs's readJsonBody caps bodies at 64 KB, real documents exceed it (expiry: if
//   readJsonBody ever grows a size argument)
// fact: responses that need extra headers write them with respond() below, never ctx.send /
//   send(code, body, ct) silently drops a 4th headers argument (expiry: if send() grows one)
// fact: draft and hidden documents live in the private root (lib/docsite-roots.mjs) / the routes
//   read the union of both manifests; every doc reads, writes, snapshots and serves inside its own
//   root (sourcePath/pagePath/rootOf), state and order changes go back to the manifest the doc came
//   from, and a NEW doc (duplicate) starts in the private root when one is present (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE (via lib), CW_DOCSITE_ORIGINS (comma
//   list; the Phase-4 wiring derives this from the registry's commitwork-docsite area — env is the
//   test override)

import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { acquireLockOrReason, writeAtomic } from '../../monitor/lockfile.mjs';
import {
  loadManifest, findDoc, findByUrlPath, sourcePath, pagePath, docsiteRoot, ManifestError, SLUG_RE,
  validateManifest, writeManifestAtomic, readManifestState, rootOf, draftRoot, presentPrivateRoot, withRoot,
} from '../../lib/docsite-manifest.mjs';
import { pairChunks } from '../../chunk-diff/lib/chunk-identity.mjs';
import { splitBlocks } from '../../chunk-diff/lib/chunk-split.mjs';
import { boundedWordDiff } from '../../chunk-diff/lib/diff-ops.mjs';
import { renderAndWritePage, renderIndex, renderShellPage, sha256Hex, renderDocBody, CSS } from '../../lib/docsite-page.mjs';
import { PAPER_CSS } from '../../lib/brand-tokens.mjs';
import { snapshotBeforeWrite, listVersions, readVersion } from '../../lib/docsite-versions.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MAX_BODY = 1024 * 1024;

const requireSessionOrLoopback = (ctx) => {
  if (ctx.isLoopbackReq) return { user: '(loopback)' };
  const s = ctx.adminSession(ctx.req);
  return (s && s.user) ? s : null;
};

// The registry's commitwork-docsite area is the SOURCE for the docsite's hostnames; the CW_*
// envs below are test overrides that win when set. Reads are call-time and memoized on the
// registry file's mtime (this runs on every request). Fail closed at every step: no registry, an
// unparsable registry, or no declared area all yield ZERO hostnames — the docsite branch simply
// never fires and the panel is untouched. Parsing here deliberately skips loadRegistry's full
// validation: the registry's own consumers gate validity; this consumer only asks one question.
import { registryPath as sharedRegistryPath } from '../../monitor/registry.mjs';

const DOCSITE_AREA = 'commitwork-docsite';
// Path only. The deliberate choice above — parse here rather than call loadRegistry, and let
// any failure yield ZERO hostnames — is unchanged: failing closed to an inert branch is not
// the swallowing defect, it is the correct shape for a consumer asking one narrow question.
// What was wrong is WHERE it looked: monitor/projects.json is the pre-migration path, holding
// a stale 30-area snapshot against the live 35. sharedRegistryPath() honours CW_REGISTRY
// first exactly as this line did, so the override contract is byte-for-byte unchanged.
const registryPath = () => sharedRegistryPath();
let regMemo = { path: null, mtimeMs: -1, hostnames: [] };
const registryHostnames = () => {
  try {
    const p = registryPath();
    const mt = statSync(p).mtimeMs;
    if (p !== regMemo.path || mt !== regMemo.mtimeMs) {
      const reg = JSON.parse(readFileSync(p, 'utf8'));
      const a = (reg.areas || []).find((x) => x && x.slug === DOCSITE_AREA);
      const hs = a && a.deploy && Array.isArray(a.deploy.hostnames)
        ? a.deploy.hostnames.filter((h) => typeof h === 'string' && h) : [];
      regMemo = { path: p, mtimeMs: mt, hostnames: hs };
    }
    return regMemo.hostnames;
  } catch { return []; }
};

// Declared cross-origin editors. Empty when undeclared — fail closed, never a wildcard.
export const docsiteOrigins = () => {
  const env = (process.env.CW_DOCSITE_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (env.length) return new Set(env);
  return new Set(registryHostnames().map((h) => `https://${h.toLowerCase()}`));
};

// Hostnames whose requests are the docsite's to answer (serve.mjs host branch).
export const docsiteHosts = () => {
  const env = (process.env.CW_DOCSITE_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (env.length) return new Set(env);
  return new Set(registryHostnames().map((h) => h.toLowerCase()));
};

const respond = (res, code, body, headers = {}) => {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': headers['content-type'] || 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(buf);
  return true;
};

// Local JSON body reader — Buffer.concat then ONE decode (the per-chunk-decode corruption trap).
const readBody = (req, cb) => {
  const chunks = [];
  let size = 0;
  let done = false;
  req.on('data', (d) => {
    if (done) return;
    size += d.length;
    if (size > MAX_BODY) { done = true; cb(null, 'body over 1 MiB'); req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { cb(null, 'body is not JSON'); return; }
    cb(body, null);
  });
  req.on('error', () => { if (!done) { done = true; cb(null, 'read error'); } });
};

const loadManifestOr = (res) => {
  try { return loadManifest(); } catch (e) {
    // ABSENT and INVALID are both 503 here: for a server whose declaration is gone or broken,
    // "no docs" would be unsupported finding.
    respond(res, 503, { ok: false, error: e.message });
    return null;
  }
};

const navFor = (manifest) => manifest.docs.filter((d) => d.state === 'published')
  .map((d) => ({ slug: d.slug, title: d.title, href: `/${d.urlPath}/` }));

const BASE_HASH_RE = /^[0-9a-f]{64}$/;
const STATES = ['draft', 'hidden', 'published'];

// THE deploy trigger — every mutating route that changes what's live (import/state/reorder/save/
// restore) calls this after its manifest or content write succeeds, instead of a person clicking
// Publish.
//
// Rebuilds for real BEFORE calling bin/docsite-publish.mjs, which otherwise only *checks* for
// drift and refuses to publish over it — a deliberate safety gate when a human is about to
// publish, but a reliability bug now that nothing is: a lane-remediation session's shared edit to
// lib/docsite-page.mjs (this repo runs several sessions against one working tree) left
// docsite/pages/*/index.html stale relative to it, and a save that had nothing to do with that
// file failed with "refusing to publish over drift" — the fix on this side of that boundary is to
// make the state this function is responsible for always current, not to ask an editor session to
// know when someone else's shared-file edit requires a rebuild.
//
// CW_DOCSITE_SKIP_DEPLOY, read at call time: every route below now fires a REAL wrangler deploy on
// a successful write, so any test exercising them for real (spawning admin/serve.mjs against a
// fixture CW_DOCSITE_ROOT) would otherwise inherit that env into this child process and either hit
// a real drift-check failure against fixture pages or, if wrangler happens to be authenticated on
// the box running the test, actually deploy fixture content to the real Cloudflare Pages project.
// Every such test MUST set this. Never set in production.
function rebuildAndDeploy() {
  if (process.env.CW_DOCSITE_SKIP_DEPLOY) return { ok: true, output: '(deploy skipped: CW_DOCSITE_SKIP_DEPLOY)' };
  try {
    execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs')], {
      cwd: REPO, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const tail = (s) => String(s || '').split('\n').slice(-15).join('\n');
    return { ok: false, detail: `rebuild failed:\n${tail(e.stdout)}\n${tail(e.stderr)}`.trim() };
  }
  try {
    const out = execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-publish.mjs')], {
      cwd: REPO, timeout: 180_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: out.split('\n').slice(-15).join('\n') };
  } catch (e) {
    const tail = (s) => String(s || '').split('\n').slice(-15).join('\n');
    return { ok: false, detail: `${tail(e.stdout)}\n${tail(e.stderr)}`.trim() };
  }
}

// The manifests' raw bytes + the parsed union together, or a response already sent on failure. Every
// mutating route reads the manifest this way so `baseHash` always means "sha256 of what's on disk
// right now," never a stale in-memory copy from an earlier request. With a private manifest the
// hash covers both files, so an edit to either refuses a stale base.
function readManifestRaw(res) {
  try { return readManifestState(); } catch (e) {
    respond(res, 503, { ok: false, error: e instanceof ManifestError ? e.message : `manifest unreadable: ${e.message}` });
    return null;
  }
}

// The version pool a key's snapshots live in: a doc's own root, or the public root for 'manifest'
// and for a urlPath no manifest declares.
const versionRootFor = (key) => {
  if (key === 'manifest') return docsiteRoot();
  try { const doc = findByUrlPath(loadManifest(), key); return doc ? rootOf(doc) : docsiteRoot(); } catch (e) {
    // A broken manifest names no doc; the read that follows still fails on its own if it must.
    if (e instanceof ManifestError) return docsiteRoot();
    throw e;
  }
};

// ── handlers (one implementation; reached same-host via the modular loop and cross-origin via
//    docsiteHandle's CORS layer — two entries, one write path) ─────────────────────────────────

function handleList(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  const m = readManifestRaw(ctx.res);
  if (!m) return true;
  return respond(ctx.res, 200, {
    ok: true,
    manifestHash: m.hash,
    docs: manifest.docs.map((d) => ({ slug: d.slug, title: d.title, state: d.state, kind: d.kind, urlPath: d.urlPath })),
  });
}

function handleDoc(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const slug = ctx.query.get('slug') || '';
  if (!SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  const doc = findDoc(manifest, slug);
  if (!doc || doc.kind !== 'md') return respond(ctx.res, 404, { ok: false, error: 'no such editable doc' });
  let content;
  try { content = readFileSync(sourcePath(doc), 'utf8'); } catch (e) {
    return respond(ctx.res, 503, { ok: false, error: `manifest names ${doc.source} but it is unreadable: ${e.message}` });
  }
  return respond(ctx.res, 200, {
    ok: true, slug, title: doc.title, state: doc.state, urlPath: doc.urlPath, content, hash: sha256Hex(content), mtime: mtimeOf(sourcePath(doc)),
  });
}

const mtimeOf = (file) => { try { return new Date(statSync(file).mtimeMs).toISOString(); } catch { return null; } };

// The editor's disk watcher polls this instead of /doc: hash and mtime only, so a document that has
// not moved costs one stat and one read per tick, not a 1 MiB body.
function handleHead(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const slug = ctx.query.get('slug') || '';
  if (!SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  const doc = findDoc(manifest, slug);
  if (!doc || doc.kind !== 'md') return respond(ctx.res, 404, { ok: false, error: 'no such editable doc' });
  let content;
  try { content = readFileSync(sourcePath(doc), 'utf8'); } catch (e) {
    return respond(ctx.res, 503, { ok: false, error: `manifest names ${doc.source} but it is unreadable: ${e.message}` });
  }
  return respond(ctx.res, 200, { ok: true, slug, hash: sha256Hex(content), mtime: mtimeOf(sourcePath(doc)) });
}

function handleSave(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { slug, content, baseHash } = body;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
    if (typeof content !== 'string') return respond(ctx.res, 400, { ok: false, error: 'content must be a string' });
    if (typeof baseHash !== 'string' || !/^[0-9a-f]{64}$/.test(baseHash)) return respond(ctx.res, 400, { ok: false, error: 'baseHash must be the sha256 the edit started from' });
    if (Buffer.byteLength(content, 'utf8') > MAX_BODY) return respond(ctx.res, 413, { ok: false, error: 'content over 1 MiB' });
    if (content.includes('\u0000')) return respond(ctx.res, 422, { ok: false, error: 'content contains NUL bytes' });
    if (Buffer.from(content, 'utf8').toString('utf8') !== content) return respond(ctx.res, 422, { ok: false, error: 'content is not valid UTF-8 text' });
    // Render-first: a source the renderer rejects is refused BEFORE anything is written.
    try { renderDocBody(content); } catch (e) { return respond(ctx.res, 422, { ok: false, error: `render failed: ${e.message}` }); }

    const manifest = loadManifestOr(ctx.res);
    if (!manifest) return true;
    const doc = findDoc(manifest, slug);
    if (!doc || doc.kind !== 'md') return respond(ctx.res, 404, { ok: false, error: 'no such editable doc' });

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), {
      staleMs: 30_000, label: 'docsite-save', attempts: 10, spinMs: 20,
      onStale: (ageMs) => console.warn(`[docsite] breaking a stale lock (${Math.round(ageMs / 1000)}s old)`),
    });
    // 503, not 409: a filesystem that cannot take the lock is not another writer holding it.
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) {
      return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    }
    const lock = got.lock;
    try {
      let currentBytes;
      try { currentBytes = readFileSync(sourcePath(doc)); } catch (e) {
        return respond(ctx.res, 503, { ok: false, error: `manifest names ${doc.source} but it is unreadable: ${e.message}` });
      }
      const current = currentBytes.toString('utf8');
      const currentHash = sha256Hex(current);
      if (currentHash !== baseHash) {
        // The 409 carries the current content so the editor can show a compare without a second
        // request racing further edits, and the mtime so "keep newer" has a disk-side timestamp.
        return respond(ctx.res, 409, { ok: false, conflict: true, currentHash, currentContent: current, currentMtime: mtimeOf(sourcePath(doc)) });
      }
      if (sha256Hex(content) === currentHash) {
        return respond(ctx.res, 200, { ok: true, unchanged: true, newHash: currentHash, url: `/${doc.urlPath}/` });
      }
      snapshotBeforeWrite(doc.urlPath, 'editor-save', current, { root: rootOf(doc) });
      writeAtomic(sourcePath(doc), content);
      try {
        renderAndWritePage({ doc, md: content, outPath: pagePath(doc), nav: navFor(manifest) });
      } catch (e) {
        // md and html must not disagree on disk after a response: restore the md.
        try {
          writeAtomic(sourcePath(doc), current);
          return respond(ctx.res, 500, { ok: false, rolledBack: true, error: `page write failed, source restored: ${e.message}` });
        } catch (e2) {
          return respond(ctx.res, 500, { ok: false, rolledBack: false, stale: true, error: `page write failed AND rollback failed — source and page disagree on disk: ${e.message}; ${e2.message}` });
        }
      }
      // Content on an already-live doc has gone stale on the deployed site the moment it was
      // written above — a draft has nothing live to update, so only hidden/published deploy.
      // Deploy failure does NOT roll back the write above: the edit is saved and versioned
      // either way, same promise handleSave already makes on a save conflict.
      if (doc.state === 'draft') return respond(ctx.res, 200, { ok: true, newHash: sha256Hex(content), url: `/${doc.urlPath}/`, deployed: false });
      const deploy = rebuildAndDeploy();
      if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'saved, but deploy failed', detail: deploy.detail, newHash: sha256Hex(content) });
      return respond(ctx.res, 200, { ok: true, newHash: sha256Hex(content), url: `/${doc.urlPath}/`, deployed: true, deployOutput: deploy.output });
    } finally { lock.release(); }
  });
  return true;
}

// Kept as a manual escape hatch (force a redeploy with no content change) even though the editor
// no longer has a Publish button — state/save/import/reorder/restore trigger this same deploy
// automatically now (see rebuildAndDeploy above).
function handlePublish(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const deploy = rebuildAndDeploy();
  if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'publish failed', detail: deploy.detail });
  return respond(ctx.res, 200, { ok: true, output: deploy.output });
}

// A Cloudflare Pages deployment is correct at the deployment level immediately (the *.pages.dev
// URL always serves it); the custom domain sits behind Cloudflare's separate CDN edge cache, which
// a new deployment does not implicitly invalidate — measured 2026-08-29, a stale page kept serving
// from cache for several minutes after the deployment that removed it was already confirmed
// correct. Deliberately a SEPARATE, manually-triggered action, not folded into rebuildAndDeploy():
// autosave/state/import/reorder already deploy on every live-doc write, and purging the whole zone
// cache on every one of those would be excessive; this is for when propagation lag is actually
// blocking someone, not a step every write needs.
function handlePurgeCache(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    const urls = body && Array.isArray(body.urls) ? body.urls.filter((u) => typeof u === 'string' && u) : [];
    const args = urls.length ? ['--files', ...urls] : [];
    let out;
    try {
      out = execFileSync(process.execPath, [join(REPO, 'bin', 'cloudflare-purge.mjs'), ...args], {
        cwd: REPO, timeout: 30_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const tail = (s) => String(s || '').split('\n').slice(-10).join('\n');
      return respond(ctx.res, 500, { ok: false, error: 'purge failed', detail: `${tail(e.stdout)}\n${tail(e.stderr)}`.trim() });
    }
    return respond(ctx.res, 200, { ok: true, output: out.trim() });
  });
  return true;
}

// ── sync / import — docsite/imported/*.html files the manifest does not yet declare ────────────
// Orphans are proposed, never adopted (bin/docsite-build.mjs's own rule for pages/ — same spirit
// here): this only LISTS candidates; identity is minted by handleImport, explicitly, one at a time.

function handleCandidates(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  // Both roots' imported/ dirs, private first: a generator writes a private page there, and it is
  // offered for import in the root it already lives in. A file name both roots hold is offered once.
  const declared = new Set(manifest.docs.map((d) => `${rootOf(d)}\u0000${d.source}`));
  const seen = new Set();
  const found = [];
  for (const root of [presentPrivateRoot(), docsiteRoot()].filter(Boolean)) {
    let names;
    try { names = readdirSync(join(root, 'imported')).filter((f) => f.endsWith('.html')); } catch { names = []; }
    for (const file of names) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (!declared.has(`${root}\u0000imported/${file}`)) found.push({ root, file });
    }
  }
  const candidates = found.map(({ root, file }) => {
    const source = `imported/${file}`;
    let html = '';
    try { html = readFileSync(join(root, source), 'utf8'); } catch { /* still offer it; title falls back below */ }
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const rawTitle = titleMatch ? titleMatch[1].replace(/\s*—\s*commitwork[^<]*$/i, '').trim() : '';
    const suggestedSlug = (file.replace(/\.html$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported').slice(0, 64);
    return { file, source, suggestedSlug, suggestedTitle: rawTitle || file };
  });
  return respond(ctx.res, 200, { ok: true, candidates });
}

function handleImport(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { file, slug, title, public: isPublic, baseHash } = body;
    if (typeof file !== 'string' || !/^[A-Za-z0-9._-]+\.html$/.test(file)) return respond(ctx.res, 400, { ok: false, error: 'bad file' });
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
    if (typeof title !== 'string' || !title.trim() || title.length > 200) return respond(ctx.res, 400, { ok: false, error: 'bad title' });
    if (typeof baseHash !== 'string' || !BASE_HASH_RE.test(baseHash)) return respond(ctx.res, 400, { ok: false, error: 'baseHash must be the manifest sha256 the edit started from' });

    const source = `imported/${file}`;
    // The root that holds the file, private first (the same order handleCandidates offers them in).
    const root = [presentPrivateRoot(), docsiteRoot()].filter(Boolean).find((r) => existsSync(join(r, source))) || docsiteRoot();
    let real, rootReal;
    try {
      real = realpathSync(join(root, source));
      rootReal = realpathSync(resolve(root, 'imported'));
    } catch (e) {
      return respond(ctx.res, 404, { ok: false, error: `no such file: ${e.message}` });
    }
    if (!real.startsWith(rootReal + sep)) return respond(ctx.res, 400, { ok: false, error: 'file escapes docsite/imported' });

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), { staleMs: 30_000, label: 'docsite-import', attempts: 10, spinMs: 20 });
    // 503, not 409: a filesystem that cannot take the lock is not another writer holding it.
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    const lock = got.lock;
    try {
      const m = readManifestRaw(ctx.res);
      if (!m) return true;
      if (m.hash !== baseHash) return respond(ctx.res, 409, { ok: false, conflict: true, currentHash: m.hash });
      if (m.parsed.docs.some((d) => d.slug === slug)) return respond(ctx.res, 409, { ok: false, error: `slug '${slug}' already exists` });
      const urlPath = isPublic ? slug : randomUUID();
      if (m.parsed.docs.some((d) => d.urlPath === urlPath)) return respond(ctx.res, 409, { ok: false, error: `urlPath '${urlPath}' already exists` });
      const next = { ...m.parsed, docs: [...m.parsed.docs, withRoot({ slug, urlPath, title, source, kind: 'imported', state: 'hidden' }, root)] };
      const errs = validateManifest(next);
      if (errs.length) return respond(ctx.res, 500, { ok: false, error: `import would produce an invalid manifest:\n  ${errs.join('\n  ')}` });
      writeManifestAtomic(next);
      const deploy = rebuildAndDeploy();
      if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'imported, but deploy failed', detail: deploy.detail });
      return respond(ctx.res, 200, { ok: true, slug, urlPath, url: `/${urlPath}/`, deployOutput: deploy.output });
    } finally { lock.release(); }
  });
  return true;
}

// ── duplicate — a new md doc whose source starts as a copy of another's. Lands as DRAFT with a
//    fresh urlPath (uuid unless public), so nothing deploys and no reader can reach it until its
//    state is changed on purpose. The copy is the only thing shared; identity is minted new.
function handleDuplicate(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { slug, newSlug, title, public: isPublic, baseHash } = body;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
    if (typeof newSlug !== 'string' || !SLUG_RE.test(newSlug)) return respond(ctx.res, 400, { ok: false, error: 'bad newSlug' });
    if (newSlug === slug) return respond(ctx.res, 400, { ok: false, error: 'newSlug must differ from slug' });
    if (typeof title !== 'string' || !title.trim() || title.length > 200) return respond(ctx.res, 400, { ok: false, error: 'bad title' });
    if (typeof baseHash !== 'string' || !BASE_HASH_RE.test(baseHash)) return respond(ctx.res, 400, { ok: false, error: 'baseHash must be the manifest sha256 the edit started from' });

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), { staleMs: 30_000, label: 'docsite-duplicate', attempts: 10, spinMs: 20 });
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    const lock = got.lock;
    try {
      const m = readManifestRaw(ctx.res);
      if (!m) return true;
      if (m.hash !== baseHash) return respond(ctx.res, 409, { ok: false, conflict: true, currentHash: m.hash });
      const src = m.parsed.docs.find((d) => d.slug === slug);
      if (!src) return respond(ctx.res, 404, { ok: false, error: 'no such doc' });
      if (src.kind !== 'md') return respond(ctx.res, 400, { ok: false, error: `${slug} is an imported snapshot — only markdown docs can be duplicated` });
      if (m.parsed.docs.some((d) => d.slug === newSlug)) return respond(ctx.res, 409, { ok: false, error: `slug '${newSlug}' already exists` });
      const urlPath = isPublic ? newSlug : randomUUID();
      if (m.parsed.docs.some((d) => d.urlPath === urlPath)) return respond(ctx.res, 409, { ok: false, error: `urlPath '${urlPath}' already exists` });
      const source = `content/${newSlug}.md`;
      // A new draft is private material: it starts in the private root when one is present.
      const root = draftRoot();
      const target = join(root, source);
      if (existsSync(target)) return respond(ctx.res, 409, { ok: false, error: `${source} already exists on disk — refusing to overwrite an undeclared file` });
      let content;
      try { content = readFileSync(sourcePath(src), 'utf8'); } catch (e) {
        return respond(ctx.res, 503, { ok: false, error: `manifest names ${src.source} but it is unreadable: ${e.message}` });
      }
      const doc = withRoot({ slug: newSlug, urlPath, title: title.trim(), source, kind: 'md', state: 'draft' }, root);
      const next = { ...m.parsed, docs: [...m.parsed.docs, doc] };
      const errs = validateManifest(next);
      if (errs.length) return respond(ctx.res, 500, { ok: false, error: `duplicate would produce an invalid manifest:\n  ${errs.join('\n  ')}` });
      writeAtomic(target, content);
      try {
        renderAndWritePage({ doc, md: content, outPath: pagePath(doc), nav: navFor(m.parsed) });
      } catch (e) {
        return respond(ctx.res, 500, { ok: false, error: `source copied but page render failed: ${e.message}` });
      }
      snapshotBeforeWrite('manifest', 'generated', m.raw);
      writeManifestAtomic(next);
      return respond(ctx.res, 200, { ok: true, slug: newSlug, urlPath, url: `/${urlPath}/`, state: 'draft', deployed: false, hash: sha256Hex(content) });
    } finally { lock.release(); }
  });
  return true;
}

// ── state / reorder — both change what the manifest declares live or in what order; both deploy ─

function handleState(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { slug, state, baseHash } = body;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
    if (!STATES.includes(state)) return respond(ctx.res, 400, { ok: false, error: `state must be ${STATES.join('|')}` });
    if (typeof baseHash !== 'string' || !BASE_HASH_RE.test(baseHash)) return respond(ctx.res, 400, { ok: false, error: 'baseHash must be the manifest sha256 the edit started from' });

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), { staleMs: 30_000, label: 'docsite-state', attempts: 10, spinMs: 20 });
    // 503, not 409: a filesystem that cannot take the lock is not another writer holding it.
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    const lock = got.lock;
    try {
      const m = readManifestRaw(ctx.res);
      if (!m) return true;
      if (m.hash !== baseHash) return respond(ctx.res, 409, { ok: false, conflict: true, currentHash: m.hash });
      const idx = m.parsed.docs.findIndex((d) => d.slug === slug);
      if (idx < 0) return respond(ctx.res, 404, { ok: false, error: 'no such doc' });
      if (m.parsed.docs[idx].state === state) return respond(ctx.res, 200, { ok: true, unchanged: true });
      const nextDocs = m.parsed.docs.slice();
      nextDocs[idx] = { ...nextDocs[idx], state };
      const next = { ...m.parsed, docs: nextDocs };
      const errs = validateManifest(next);
      if (errs.length) return respond(ctx.res, 500, { ok: false, error: `state change would produce an invalid manifest:\n  ${errs.join('\n  ')}` });
      writeManifestAtomic(next);
      const deploy = rebuildAndDeploy();
      if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'state changed, but deploy failed', detail: deploy.detail });
      return respond(ctx.res, 200, { ok: true, state, deployOutput: deploy.output });
    } finally { lock.release(); }
  });
  return true;
}

function handleReorder(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { order, baseHash } = body;
    if (!Array.isArray(order) || order.some((s) => typeof s !== 'string')) return respond(ctx.res, 400, { ok: false, error: 'order must be an array of slugs' });
    if (typeof baseHash !== 'string' || !BASE_HASH_RE.test(baseHash)) return respond(ctx.res, 400, { ok: false, error: 'baseHash must be the manifest sha256 the edit started from' });

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), { staleMs: 30_000, label: 'docsite-reorder', attempts: 10, spinMs: 20 });
    // 503, not 409: a filesystem that cannot take the lock is not another writer holding it.
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    const lock = got.lock;
    try {
      const m = readManifestRaw(ctx.res);
      if (!m) return true;
      if (m.hash !== baseHash) return respond(ctx.res, 409, { ok: false, conflict: true, currentHash: m.hash });
      // order must account for EXACTLY the current slugs — count-in = count-out, the same
      // completeness discipline bin/taxonomy-web.mjs's reconcile() applies to edition lineages.
      const currentSlugs = m.parsed.docs.map((d) => d.slug).slice().sort();
      const wanted = order.slice().sort();
      if (currentSlugs.length !== wanted.length || currentSlugs.some((s, i) => s !== wanted[i])) {
        return respond(ctx.res, 400, { ok: false, error: 'order must be an exact permutation of every current slug — nothing added, nothing dropped' });
      }
      const bySlug = new Map(m.parsed.docs.map((d) => [d.slug, d]));
      const next = { ...m.parsed, docs: order.map((s) => bySlug.get(s)) };
      const errs = validateManifest(next);
      if (errs.length) return respond(ctx.res, 500, { ok: false, error: `reorder would produce an invalid manifest:\n  ${errs.join('\n  ')}` });
      writeManifestAtomic(next);
      const deploy = rebuildAndDeploy();
      if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'reordered, but deploy failed', detail: deploy.detail });
      return respond(ctx.res, 200, { ok: true, deployOutput: deploy.output });
    } finally { lock.release(); }
  });
  return true;
}

// ── version history / restore ────────────────────────────────────────────────────────────────

function handleVersions(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const key = ctx.query.get('key') || '';
  const origin = ctx.query.get('origin') || '';
  if (origin !== 'editor-save' && origin !== 'generated') return respond(ctx.res, 400, { ok: false, error: 'origin must be editor-save|generated' });
  let versions;
  try { versions = listVersions(key, origin, { root: versionRootFor(key) }); } catch (e) { return respond(ctx.res, 400, { ok: false, error: e.message }); }
  return respond(ctx.res, 200, { ok: true, versions });
}

// A version's bytes, so the editor can diff it, preview it or load it into the buffer WITHOUT
// restoring it — restore writes to disk and deploys; this only reads.
function handleVersion(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const key = ctx.query.get('key') || '';
  const origin = ctx.query.get('origin') || '';
  const id = ctx.query.get('id') || '';
  if (origin !== 'editor-save' && origin !== 'generated') return respond(ctx.res, 400, { ok: false, error: 'origin must be editor-save|generated' });
  let buf;
  try { buf = readVersion(key, origin, id, { root: versionRootFor(key) }); } catch (e) { return respond(ctx.res, 404, { ok: false, error: `no such version: ${e.message}` }); }
  const content = buf.toString('utf8');
  return respond(ctx.res, 200, { ok: true, key, origin, id, content, hash: sha256Hex(content) });
}

// ── git history of a doc's source — the durable record the .versions pool is not ─────────────
// Read-only. Every argument to git is fixed or validated here; the source path comes from the
// manifest, never from the query. A root that is not a git repository answers available:false
// with git's own reason, which the editor shows as such — never as "no commits".
const SHA_RE = /^[0-9a-f]{7,40}$/;
const GIT_LOG_MAX = 50;

const gitFor = (doc) => {
  const root = rootOf(doc);
  let top;
  try {
    top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  } catch (e) {
    return { available: false, reason: String(e.stderr || e.message).trim().split('\n')[0] };
  }
  // git reports the toplevel as a real path; the docsite root may be reached through a symlink
  // (macOS /var → /private/var, this repo's own sidecar links), so compare real to real.
  let src;
  try { src = realpathSync(sourcePath(doc)); } catch (e) { return { available: false, reason: `${doc.source} unreadable: ${e.message}` }; }
  const rel = relative(top, src);
  if (rel.startsWith('..')) return { available: false, reason: `${doc.source} lies outside the repository at ${top}` };
  return { available: true, top, rel };
};

const editableDocOr = (ctx) => {
  const slug = ctx.query.get('slug') || '';
  if (!SLUG_RE.test(slug)) { respond(ctx.res, 400, { ok: false, error: 'bad slug' }); return null; }
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return null;
  const doc = findDoc(manifest, slug);
  if (!doc || doc.kind !== 'md') { respond(ctx.res, 404, { ok: false, error: 'no such editable doc' }); return null; }
  return doc;
};

function handleGitLog(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const doc = editableDocOr(ctx);
  if (!doc) return true;
  const g = gitFor(doc);
  if (!g.available) return respond(ctx.res, 200, { ok: true, slug: doc.slug, available: false, reason: g.reason, commits: [] });
  let out;
  try {
    out = execFileSync('git', ['-C', g.top, 'log', `--max-count=${GIT_LOG_MAX}`, '--format=%H%x00%aI%x00%an%x00%s', '--', g.rel],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  } catch (e) {
    return respond(ctx.res, 503, { ok: false, error: `git log failed: ${String(e.stderr || e.message).trim().split('\n')[0]}` });
  }
  const commits = out.split('\n').filter(Boolean).map((line) => {
    const [sha, at, author, subject] = line.split('\0');
    return { sha, at, author, subject };
  });
  return respond(ctx.res, 200, { ok: true, slug: doc.slug, available: true, path: g.rel, commits });
}

function handleGitShow(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const sha = ctx.query.get('sha') || '';
  if (!SHA_RE.test(sha)) return respond(ctx.res, 400, { ok: false, error: 'sha must be 7-40 hex characters' });
  const doc = editableDocOr(ctx);
  if (!doc) return true;
  const g = gitFor(doc);
  if (!g.available) return respond(ctx.res, 404, { ok: false, error: `no git history: ${g.reason}` });
  let content;
  try {
    content = execFileSync('git', ['-C', g.top, 'show', `${sha}:${g.rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: MAX_BODY * 2 });
  } catch (e) {
    return respond(ctx.res, 404, { ok: false, error: `git show failed: ${String(e.stderr || e.message).trim().split('\n')[0]}` });
  }
  return respond(ctx.res, 200, { ok: true, slug: doc.slug, sha, content, hash: sha256Hex(content) });
}

// Restores write back through the SAME path the content came from — a doc's markdown source
// (origin editor-save) also gets re-rendered, so source and page never disagree on disk; a bare
// generated artifact (origin generated: an imported/*.html snapshot, or a kind:md doc's rendered
// page as a stopgap) is written back directly. Either way the CURRENT content is snapshotted
// first, so a restore is itself reversible, never a destructive rewind of the history.
function handleRestore(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const { key, origin, id } = body;
    if (typeof key !== 'string' || !key) return respond(ctx.res, 400, { ok: false, error: 'bad key' });
    if (origin !== 'editor-save' && origin !== 'generated') return respond(ctx.res, 400, { ok: false, error: 'origin must be editor-save|generated' });
    if (typeof id !== 'string' || !id) return respond(ctx.res, 400, { ok: false, error: 'bad id' });

    let archived;
    const vroot = versionRootFor(key);
    try { archived = readVersion(key, origin, id, { root: vroot }); } catch (e) { return respond(ctx.res, 404, { ok: false, error: `no such version: ${e.message}` }); }

    const got = acquireLockOrReason(join(docsiteRoot(), '.docsite.lock'), { staleMs: 30_000, label: 'docsite-restore', attempts: 10, spinMs: 20 });
    // 503, not 409: a filesystem that cannot take the lock is not another writer holding it.
    if (!got.ok && got.reason === 'unavailable') return respond(ctx.res, 503, { ok: false, unavailable: true, error: `docsite lock unavailable${got.code ? ` (${got.code})` : ''}: ${got.message}` });
    if (!got.ok) return respond(ctx.res, 409, { ok: false, locked: true, error: `docsite is locked by another writer${got.holder ? ` ('${got.holder.label}')` : ''} — try again` });
    const lock = got.lock;
    try {
      if (key === 'manifest') {
        let parsed;
        try { parsed = JSON.parse(archived.toString('utf8')); } catch (e) { return respond(ctx.res, 422, { ok: false, error: `archived manifest is not JSON: ${e.message}` }); }
        const errs = validateManifest(parsed);
        if (errs.length) return respond(ctx.res, 422, { ok: false, error: `archived manifest fails validation:\n  ${errs.join('\n  ')}` });
        // 'manifest' versions are the PUBLIC manifest's. Restoring one must not collide with a doc
        // the private manifest declares, or every later read of the union would refuse.
        const cur = readManifestRaw(ctx.res);
        if (!cur) return true;
        const priv = cur.parsed.docs.filter((d) => rootOf(d) !== docsiteRoot());
        const clash = validateManifest({ ...parsed, docs: [...parsed.docs, ...priv.map((d) => ({ ...d }))] });
        if (clash.length) return respond(ctx.res, 422, { ok: false, error: `archived manifest collides with the private manifest:\n  ${clash.join('\n  ')}` });
        writeManifestAtomic(parsed);
        const deploy = rebuildAndDeploy();
        if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'manifest restored, but deploy failed', detail: deploy.detail });
        return respond(ctx.res, 200, { ok: true, restored: 'manifest', deployOutput: deploy.output });
      }

      const manifest = loadManifestOr(ctx.res);
      if (!manifest) return true;
      const doc = findByUrlPath(manifest, key);
      if (!doc) return respond(ctx.res, 404, { ok: false, error: `no doc with urlPath '${key}'` });
      if (origin === 'editor-save' && doc.kind !== 'md') return respond(ctx.res, 400, { ok: false, error: `'editor-save' versions only exist for kind: md docs` });

      const target = origin === 'editor-save' || doc.kind === 'imported' ? sourcePath(doc) : pagePath(doc);
      let previous = null;
      try { previous = readFileSync(target, 'utf8'); } catch { /* nothing there yet */ }
      snapshotBeforeWrite(key, origin, previous, { root: rootOf(doc) });
      writeAtomic(target, archived);

      if (origin === 'editor-save') {
        try {
          renderAndWritePage({ doc, md: archived.toString('utf8'), outPath: pagePath(doc), nav: navFor(manifest) });
        } catch (e) {
          return respond(ctx.res, 500, { ok: false, error: `source restored but re-render failed: ${e.message}` });
        }
      }

      if (doc.state === 'draft') return respond(ctx.res, 200, { ok: true, restored: key, deployed: false });
      const deploy = rebuildAndDeploy();
      if (!deploy.ok) return respond(ctx.res, 500, { ok: false, error: 'restored, but deploy failed', detail: deploy.detail });
      return respond(ctx.res, 200, { ok: true, restored: key, deployed: true, deployOutput: deploy.output });
    } finally { lock.release(); }
  });
  return true;
}

// ── editor static assets — exact paths only (a gate that ends in a prefix match is trusting
//    whatever routing happens after it). Read per request: whatever is on disk is what serves. ──

const ASSETS = {
  '/edit-assets/editor.js': [join(REPO, 'docsite', 'editor', 'editor.js'), 'text/javascript; charset=utf-8'],
  '/edit-assets/editor.css': [join(REPO, 'docsite', 'editor', 'editor.css'), 'text/css; charset=utf-8'],
  '/edit-assets/docsite-md.mjs': [join(REPO, 'lib', 'docsite-md.mjs'), 'text/javascript; charset=utf-8'],
  '/edit-assets/render-markdown.mjs': [join(REPO, 'lib', 'render-markdown.mjs'), 'text/javascript; charset=utf-8'],
  '/edit-assets/html-escape.mjs': [join(REPO, 'lib', 'html-escape.mjs'), 'text/javascript; charset=utf-8'],
};

// Generated assets: served from the SAME exports the published page is built from, not from a file.
// The editor already shares the RENDERER (editor.js imports the same renderDocBody), so the preview
// markup was already guaranteed identical; only the stylesheet was a hand-copy, and it had drifted —
// measured 2026-09-01, four of six shared selectors differed, including `code`, which the published
// shell colours and the preview did not. A preview that renders the same HTML through different CSS
// is a WYSIWYG editor that lies about the one thing it exists to show.
const GENERATED = new Map([
  ['/edit-assets/page.css', () => CSS],
  ['/edit-assets/tokens.css', () => PAPER_CSS],
]);

function serveAsset(ctx) {
  const gen = GENERATED.get(ctx.pathname);
  if (typeof gen === 'function') {
    return respond(ctx.res, 200, gen(), { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' });
  }
  const hit = Object.hasOwn(ASSETS, ctx.pathname) ? ASSETS[ctx.pathname] : null;
  if (!hit) return false;
  let buf;
  try { buf = readFileSync(hit[0]); } catch (e) {
    // Missing asset is a 503 naming the gap, never a 200-empty (the tracked-assets lesson).
    return respond(ctx.res, 503, { ok: false, error: `asset source unreadable: ${e.message}` });
  }
  return respond(ctx.res, 200, buf, { 'content-type': hit[1], 'cache-control': 'no-cache' });
}

// THE PREVIEW SHELL. The editor's preview iframe loads this once per document: the published
// page's own chrome (header, nav, title, badge, footer) from the same renderer the build uses,
// with an empty #pv-root where the body goes. The editor then swaps only that container per
// keystroke, so the preview is the real template around live text rather than bare body CSS.
// Gated like the editor: it names every document's title in its nav.
function servePreviewShell(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  const slug = ctx.query.get('slug') || '';
  if (!SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  const doc = findDoc(manifest, slug);
  if (!doc || doc.kind !== 'md') return respond(ctx.res, 404, { ok: false, error: 'no such editable doc' });
  const badge = doc.state === 'published' ? '' : `<span class="badge${doc.state === 'draft' ? ' warn' : ''}">${doc.state}</span>`;
  // Nav links point at the panel's own built copies, which resolve on this origin; the public
  // /<urlPath>/ form does not.
  const nav = navFor(manifest).map((n) => ({ ...n, href: `/docsite/page?slug=${encodeURIComponent(n.slug)}` }));
  const html = renderShellPage({
    title: doc.title, bodyHtml: '<div id="pv-root"></div>', srcHash: 'live preview', nav, currentSlug: doc.slug, badge,
    generator: 'admin/routes/docsite.mjs (editor preview shell)',
  });
  return respond(ctx.res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

function serveEditorPage(ctx) {
  let html;
  try { html = readFileSync(join(REPO, 'docsite', 'editor', 'edit.html'), 'utf8'); } catch (e) {
    return respond(ctx.res, 503, { ok: false, error: `editor page unreadable: ${e.message}` });
  }
  // Local serving: same-origin API.
  html = html.replaceAll('__CW_API_BASE__', '');
  return respond(ctx.res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

// THE PANEL'S OWN COPY OF EVERY DOCUMENT. The local index used to link at `/<urlPath>/`, which is
// a PUBLIC path: on the panel origin nothing serves it, so the drafting view listed documents it
// could not open, and the ones it most needed to show — drafts, which by definition are not on the
// public site at all — were the ones with no reachable copy anywhere.
//
// This serves the BUILT page from the working tree, not a re-render, so what the operator reads is
// the artifact that would ship rather than a second rendering that could disagree with it. State is
// deliberately NOT consulted: draft, hidden and published are all readable here. That is the whole
// point of an operator view, and it is safe precisely because this origin asks who you are — the
// public bundle still carries only what docsite-publish puts in it.
// UPLOAD A MARKDOWN FILE AND SEE WHAT IT WOULD CHANGE, BEFORE ANYTHING IS WRITTEN. The doc's
// current content/<slug>.md is the BASE; the uploaded text is the candidate. This route computes
// and returns; it never writes. Merging is a separate, deliberate act through the existing save
// path, which carries baseHash CAS — so an upload cannot silently overwrite an edit made while the
// operator was looking at the diff.
//
// THE DIFF IS NOT WRITTEN HERE EITHER. chunk-diff/ already carries this exact problem solved and
// tested: splitBlocks cuts markdown into blocks, pairChunks pairs them by exact hash, then by
// whitespace-normalised hash, then by similarity — and reports UNRESOLVED rather than forcing a
// low-confidence pairing, which is the same explicit uncertainty rule this repo applies everywhere.
// boundedWordDiff refines an EDITED pair to word level and declares `capped` instead of hanging on
// a pathological input. Writing a second diff here would have meant a second set of edge cases to
// get wrong, and no witness that the two agreed.
function handleDiff(ctx) {
  if (!requireSessionOrLoopback(ctx)) return respond(ctx.res, 401, { ok: false, error: 'authentication required' });
  readBody(ctx.req, (body, err) => {
    if (err) return respond(ctx.res, err === 'body over 1 MiB' ? 413 : 400, { ok: false, error: err });
    if (!body || typeof body !== 'object') return respond(ctx.res, 400, { ok: false, error: 'body must be a JSON object' });
    const slug = typeof body.slug === 'string' ? body.slug : '';
    const text = typeof body.text === 'string' ? body.text : null;
    if (!SLUG_RE.test(slug)) return respond(ctx.res, 400, { ok: false, error: 'bad slug' });
    // An ABSENT upload and an EMPTY one are different: empty is a real candidate that deletes
    // everything, and answering it with "no text supplied" would hide a destructive edit.
    if (text === null) return respond(ctx.res, 400, { ok: false, error: 'text must be the uploaded markdown (a string; "" is a valid, destructive candidate)' });

    const manifest = loadManifestOr(ctx.res);
    if (!manifest) return true;
    const doc = (manifest.docs || []).find((d) => d.slug === slug);
    if (!doc) return respond(ctx.res, 404, { ok: false, error: `no document with slug '${slug}'` });
    if (doc.kind !== 'md') return respond(ctx.res, 400, { ok: false, error: `${slug} is an imported snapshot, not markdown — there is no .md base to diff against` });

    let base;
    try { base = readFileSync(sourcePath(doc), 'utf8'); } catch (e) {
      // Fail closed. Treating an unreadable base as "" would report every block ADDED and present
      // a total rewrite as a clean import.
      return respond(ctx.res, e.code === 'ENOENT' ? 404 : 503, { ok: false,
        error: e.code === 'ENOENT' ? `${slug} has no markdown source at ${doc.source}` : `base unreadable: ${e.message}` });
    }

    const { pairs, noBaseline } = pairChunks(splitBlocks(base), splitBlocks(text));

    // PAIRS COME BACK IN MATCH ORDER, NOT DOCUMENT ORDER. pairChunks resolves by exact hash, then
    // whitespace-normalised hash, then similarity, then sweeps up deletions and additions — so the
    // array is ordered by HOW each pair was found, which has nothing to do with where the text sits.
    // Handing that to a caller unordered would render a scrambled diff and, worse, let a merge
    // assemble the blocks in resolution order and call it a document. The chunk's own `idx` is
    // carried for exactly this ("a position may aid rendering, never stand in for identity"), so
    // ordering is reconstructed here rather than left to every consumer to get wrong separately.
    //
    // The merged document is the CANDIDATE's document, so newIdx is the spine. A DELETED block has
    // no place in it at all; it is slotted just after the last surviving block that preceded it in
    // the BASE, which is where a reader looks for the thing that is gone.
    const withNew = pairs.filter((p) => p.new).sort((a, b) => a.new.idx - b.new.idx);
    const seat = (p) => {
      if (p.new) return p.new.idx;
      let before = -1;
      for (const q of withNew) if (q.old && q.old.idx < p.old.idx) before = Math.max(before, q.new.idx);
      return before + 0.5;
    };
    const out = pairs
      .map((p) => [seat(p), p])
      .sort((a, b) => a[0] - b[0])
      .map(([, p]) => {
        const row = {
          state: p.state,
          old: p.old ? p.old.src : null,
          new: p.new ? p.new.src : null,
          oldIdx: p.old ? p.old.idx : null,
          newIdx: p.new ? p.new.idx : null,
        };
        if (p.state === 'EDITED' && p.old && p.new) {
          const { ops, capped } = boundedWordDiff(p.old.src, p.new.src);
          row.words = ops; row.capped = capped;
        }
        return row;
      });
    const counts = out.reduce((a, r) => { a[r.state] = (a[r.state] || 0) + 1; return a; }, {});
    return respond(ctx.res, 200, {
      ok: true, slug, noBaseline: !!noBaseline, counts, pairs: out,
      // The hash the MERGE must be made against. Returning it here is what lets the save refuse a
      // write whose base moved while the operator was reading the diff.
      baseHash: sha256Hex(base),
      unchanged: base === text,
    });
  });
}

function serveDocPage(ctx) {
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  const slug = new URL(ctx.req.url, 'http://x').searchParams.get('slug') || '';
  const doc = (manifest.docs || []).find((d) => d.slug === slug);
  if (!doc) return respond(ctx.res, 404, { ok: false, error: `no document with slug '${slug}'` });
  const file = doc.kind === 'imported' ? sourcePath(doc) : pagePath(doc);
  let html;
  try { html = readFileSync(file, 'utf8'); } catch (e) {
    // Fail closed and say which half is missing: an unbuilt page and an unreadable one are
    // different problems, and an empty 200 would look like a document with nothing in it.
    return respond(ctx.res, e.code === 'ENOENT' ? 404 : 503, { ok: false,
      error: e.code === 'ENOENT'
        ? `${doc.slug} has no built page yet — run node bin/docsite-build.mjs`
        : `${doc.slug} is unreadable: ${e.message}` });
  }
  return respond(ctx.res, 200, html, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
}

function serveLocalIndex(ctx) {
  const manifest = loadManifestOr(ctx.res);
  if (!manifest) return true;
  // Live freshness, three honest states: fresh / stale / unknown (+ imported, its own thing).
  const rows = manifest.docs.map((d) => {
    let freshness = 'unknown';
    if (d.kind === 'imported') freshness = 'imported';
    else {
      try {
        const md = readFileSync(sourcePath(d), 'utf8');
        const page = readFileSync(pagePath(d), 'utf8');
        const m = page.match(/data-src-sha256="([0-9a-f]{64})"/);
        freshness = m && m[1] === sha256Hex(md) ? 'fresh' : 'stale';
      } catch { freshness = 'unknown'; }
    }
    return { title: d.title, href: `/docsite/page?slug=${encodeURIComponent(d.slug)}`, state: d.state, freshness };
  });
  return respond(ctx.res, 200, renderIndex({ rows, showFreshness: true, note: 'Local drafting view — every state shown, including drafts. Freshness is shown here and nowhere else: it says whether the built page matches its source.' }), {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
  });
}

export const routes = [
  { method: 'GET', path: '/api/docsite/list', handle: handleList },
  { method: 'GET', path: '/api/docsite/doc', handle: handleDoc },
  { method: 'POST', path: '/api/docsite/save', handle: handleSave },
  { method: 'POST', path: '/api/docsite/publish', handle: handlePublish },
  { method: 'POST', path: '/api/docsite/purge-cache', handle: handlePurgeCache },
  { method: 'GET', path: '/api/docsite/candidates', handle: handleCandidates },
  { method: 'POST', path: '/api/docsite/import', handle: handleImport },
  { method: 'POST', path: '/api/docsite/duplicate', handle: handleDuplicate },
  { method: 'POST', path: '/api/docsite/state', handle: handleState },
  { method: 'POST', path: '/api/docsite/reorder', handle: handleReorder },
  { method: 'GET', path: '/api/docsite/versions', handle: handleVersions },
  { method: 'GET', path: '/api/docsite/version', handle: handleVersion },
  { method: 'POST', path: '/api/docsite/restore', handle: handleRestore },
  { method: 'GET', path: '/api/docsite/head', handle: handleHead },
  { method: 'GET', path: '/api/docsite/git-log', handle: handleGitLog },
  { method: 'GET', path: '/api/docsite/git-show', handle: handleGitShow },
  { method: 'GET', path: '/docsite/edit', handle: serveEditorPage },
  { method: 'GET', path: '/docsite/preview-shell', handle: servePreviewShell },
  { method: 'GET', path: '/docsite/index', handle: serveLocalIndex },
  { method: 'POST', path: '/api/docsite/diff', handle: handleDiff },
  { method: 'GET', path: '/docsite/page', handle: serveDocPage },
  { method: 'GET', path: '/edit-assets/editor.js', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/editor.css', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/page.css', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/tokens.css', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/docsite-md.mjs', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/render-markdown.mjs', handle: serveAsset },
  { method: 'GET', path: '/edit-assets/html-escape.mjs', handle: serveAsset },
];

// ── docsiteHandle — the serve.mjs branch for the docsite HOSTNAME and the cross-origin API.
// Wired ahead of the blanket CSRF gate for /api/docsite/* ONLY; every other panel route keeps the
// same-host gate. Returns true when the request was handled.
const API_PATHS = new Set([
  '/api/docsite/list', '/api/docsite/doc', '/api/docsite/save', '/api/docsite/publish',
  '/api/docsite/purge-cache',
  '/api/docsite/candidates', '/api/docsite/import', '/api/docsite/state', '/api/docsite/reorder',
  '/api/docsite/versions', '/api/docsite/restore',
  '/api/docsite/version', '/api/docsite/head', '/api/docsite/git-log', '/api/docsite/git-show', '/api/docsite/diff',
  '/api/docsite/duplicate',
]);

export function docsiteHandle(ctx) {
  const { req, res, pathname } = ctx;
  const origin = req.headers.origin || '';
  const fromDeclaredOrigin = docsiteOrigins().has(origin);

  if (API_PATHS.has(pathname)) {
    if (req.method === 'OPTIONS') {
      if (!fromDeclaredOrigin) return respond(res, 403, { ok: false, error: 'origin not declared' });
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return true;
    }
    if (!fromDeclaredOrigin) return false; // same-host flow: blanket CSRF gate + modular loop own it
    const wrap = (fn) => { withCors(res, origin); return fn(ctx); };
    if (pathname === '/api/docsite/list' && req.method === 'GET') return wrap(handleList);
    if (pathname === '/api/docsite/doc' && req.method === 'GET') return wrap(handleDoc);
    if (pathname === '/api/docsite/save' && req.method === 'POST') return wrap(handleSave);
    if (pathname === '/api/docsite/publish' && req.method === 'POST') return wrap(handlePublish);
    if (pathname === '/api/docsite/purge-cache' && req.method === 'POST') return wrap(handlePurgeCache);
    if (pathname === '/api/docsite/candidates' && req.method === 'GET') return wrap(handleCandidates);
    if (pathname === '/api/docsite/import' && req.method === 'POST') return wrap(handleImport);
    if (pathname === '/api/docsite/state' && req.method === 'POST') return wrap(handleState);
    if (pathname === '/api/docsite/reorder' && req.method === 'POST') return wrap(handleReorder);
    if (pathname === '/api/docsite/versions' && req.method === 'GET') return wrap(handleVersions);
    if (pathname === '/api/docsite/restore' && req.method === 'POST') return wrap(handleRestore);
    if (pathname === '/api/docsite/version' && req.method === 'GET') return wrap(handleVersion);
    if (pathname === '/api/docsite/head' && req.method === 'GET') return wrap(handleHead);
    if (pathname === '/api/docsite/git-log' && req.method === 'GET') return wrap(handleGitLog);
    if (pathname === '/api/docsite/git-show' && req.method === 'GET') return wrap(handleGitShow);
    if (pathname === '/api/docsite/diff' && req.method === 'POST') return wrap(handleDiff);
    if (pathname === '/api/docsite/duplicate' && req.method === 'POST') return wrap(handleDuplicate);
    return false;
  }

  // Host-branch pages beyond the doc pages themselves: the index at the root, and the editor —
  // pathname '/' only ever reaches this handler when serve.mjs matched the docsite hostname.
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveLocalIndex(ctx);
  if (req.method === 'GET' && (pathname === '/edit' || pathname === '/edit/' || pathname === '/edit/index.html')) return serveEditorPage(ctx);
  if (req.method === 'GET' && Object.hasOwn(ASSETS, pathname)) return serveAsset(ctx);
  if (req.method === 'GET' && pathname === '/docsite/preview-shell') return servePreviewShell(ctx);

  // Public serving for the docsite hostname (used when the host header names the docsite area, or
  // locally under /docsite/pages/). The manifest gates the filesystem: an on-disk page with no
  // entry is a 404, and the resolved path is re-confined as the second witness.
  const m = pathname.match(/^\/(?:docsite\/pages\/)?([a-z0-9][a-z0-9-]{0,63}|[0-9a-f-]{36})\/?(?:index\.html)?$/);
  if (m && req.method === 'GET') {
    const manifest = loadManifestOr(res);
    if (!manifest) return true;
    const doc = findByUrlPath(manifest, m[1]);
    if (!doc) return false;
    const file = doc.kind === 'imported' ? sourcePath(doc) : pagePath(doc);
    // Confinement asserts on the RESOLVED REAL path, not on the joined string: resolve() does not
    // follow symlinks, so a link inside docsite/ pointing outside passes a string-prefix check
    // while realpath disagrees. The test that earns this plants a real symlink (the
    // commitwork-web/serve.mjs lesson, relayed 2026-08-27).
    let real;
    let rootReal;
    try {
      real = realpathSync(file);
      rootReal = realpathSync(resolve(rootOf(doc)));
    } catch (e) {
      return respond(res, 503, { ok: false, error: `declared but unreadable: ${e.message}` });
    }
    if (!real.startsWith(rootReal + sep)) return respond(res, 404, { ok: false, error: 'not found' });
    let buf;
    try { buf = readFileSync(real); } catch (e) {
      return respond(res, 503, { ok: false, error: `declared but unreadable: ${e.message}` });
    }
    const etag = `"${sha256Hex(buf).slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); res.end(); return true; }
    return respond(res, 200, buf, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', etag });
  }
  return false;
}

const corsHeaders = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
  vary: 'origin',
});
const withCors = (res, origin) => { for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v); };
