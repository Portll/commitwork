#!/usr/bin/env node
// docsite-publish.mjs — the explicit publish act: verify zero drift, assemble the public bundle
// (published + hidden docs, never drafts), deploy to Cloudflare Pages. Saving describes; THIS
// deploys — never a side effect of a save.
//
// Usage:
//   node bin/docsite-publish.mjs             # build --check, bundle, wrangler pages deploy
//   node bin/docsite-publish.mjs --dry-run   # bundle + report, no deploy
//
// fact: the bundle is assembled fresh in a temp dir and every EXCLUDED doc is named in the output
//   / a silently-thinned bundle reads as "everything shipped" when it did not — no silent caps
//   (expiry: never)
// fact: a Cloudflare Pages deployment REPLACES the site, so the bundle must carry every page that
//   must stay reachable — including imported snapshots of pre-docsite pages (expiry: when the
//   marketing site has moved to its own domain AND the imported entries are retired)
// fact: hidden documents in the private root ship exactly as public ones do, and drafts in either
//   root never ship / the manifest is the union (lib/docsite-roots.mjs). From the private root
//   only the declared, non-draft sources are copied; a public checkout with no private root ships
//   the published site alone (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE (via lib), CW_DOCSITE_DIST,
//   CW_WRANGLER, CW_DOCSITE_PROJECT

import { mkdtempSync, mkdirSync, cpSync, readFileSync, existsSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { loadManifest, docsiteRoot, pagePath, docHref, rootOf, sourcePath } from '../lib/docsite-manifest.mjs';
import { renderIndex, render404 } from '../lib/docsite-page.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');
const wranglerBin = () => process.env.CW_WRANGLER || 'wrangler';
// Where the authenticated editor actually lives. Env-overridable like every other input here.
const EDITOR_HOME = process.env.CW_EDITOR_HOME || 'https://commitwork.online/docsite/edit';
const project = () => process.env.CW_DOCSITE_PROJECT || 'commitwork-taxonomy';
// 'main' is the production alias; anything else deploys a PREVIEW (its own *.pages.dev URL,
// production untouched) — the safe way to validate the pipeline before the cutover gate clears.
const branch = () => process.env.CW_DOCSITE_BRANCH || 'main';
// CW_DOCSITE_API_BASE and apiBase() were removed 2026-08-29 with the published editor: their only
// job was baking the drafting origin into the static /edit/ shell, and the panel serves that
// editor same-origin behind its own login gate, so there is no second origin left to name.

const die = (msg, code = 2) => { console.error(`docsite-publish: ${msg}`); process.exit(code); };

// 1. Zero drift, or refuse: what deploys must be exactly what the sources say.
try {
  execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs'), '--check'], { stdio: 'pipe', encoding: 'utf8' });
} catch (e) {
  die(`refusing to publish over drift — run node bin/docsite-build.mjs first\n${e.stdout || ''}${e.stderr || ''}`);
}

let manifest;
try { manifest = loadManifest(); } catch (e) { die(e.message); }

const dist = process.env.CW_DOCSITE_DIST || mkdtempSync(join(tmpdir(), 'cw-docsite-dist-'));
mkdirSync(dist, { recursive: true });

const shipped = [];
const excluded = [];

const redirects = [];

// /edit/ LOOPS BACK to the editor that can ask who you are. The static shell was withdrawn from
// this bundle on 2026-08-29 ("it was never meant to have a fully public edit mode"), which left the
// path answering 404 for anyone who had bookmarked it — a dead end that says nothing about where
// the editor went. The panel serves the same editor behind OAuth at /docsite/edit, so the public
// path now redirects there instead of 404ing. 302, not 301: a permanent redirect would be cached
// by browsers indefinitely and could not be withdrawn without clearing every visitor cache.
redirects.push(`/edit/* ${EDITOR_HOME} 302`);
redirects.push(`/edit ${EDITOR_HOME} 302`);

// 2. Generated pages: published + hidden. Drafts are named, never silently dropped.
for (const doc of manifest.docs) {
  if (doc.state === 'draft') { excluded.push(`${doc.slug} (draft)`); continue; }
  if (doc.kind === 'md') {
    // The page is written at its PUBLIC path (alias if one is declared, else urlPath), and the
    // urlPath is redirected into it below. Emitting the page twice instead would give one document
    // two live addresses, which splits inbound links and lets the two copies drift apart on any
    // publish that touches only one of them.
    const pub = (doc.alias || doc.urlPath);
    const out = join(dist, pub, 'index.html');
    mkdirSync(dirname(out), { recursive: true });
    cpSync(pagePath(doc), out);
    shipped.push(`/${pub}/ (${doc.state}${doc.alias ? `, ${doc.urlPath} redirects here` : ''})`);
    if (doc.alias) redirects.push(`/${doc.urlPath}/* /${doc.alias}/ 301`);
  }
}

// 3. Imported tree: byte-exact snapshots plus their chrome (styles, assets), minus any file that
// is the source of a draft imported entry.
const importedDir = join(docsiteRoot(), 'imported');
const isPublicRoot = (d) => rootOf(d) === docsiteRoot();
if (existsSync(importedDir)) {
  const draftSources = new Set(manifest.docs.filter((d) => isPublicRoot(d) && d.kind === 'imported' && d.state === 'draft').map((d) => d.source));
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // A symlink under imported/ would copy its TARGET into the public bundle — whatever it
      // points at, wherever it lives. The bundle carries real files only; a link is a refusal,
      // never a follow (and never a silent skip).
      if (entry.isSymbolicLink()) die(`refusing to publish: ${relative(docsiteRoot(), full)} is a symlink — the bundle carries real files only`);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = relative(docsiteRoot(), full); // e.g. imported/taxonomy.html
      if (draftSources.has(rel)) { excluded.push(`${rel} (draft import)`); continue; }
      const out = join(dist, relative(importedDir, full)); // imported/x → dist/x
      mkdirSync(dirname(out), { recursive: true });
      cpSync(full, out);
    }
  };
  walk(importedDir);
  for (const d of manifest.docs) if (isPublicRoot(d) && d.kind === 'imported' && d.state !== 'draft') shipped.push(`/${d.urlPath} (${d.state}, imported)`);
}
// 3b. Private root: never a directory walk. Only each declared, non-draft imported source is copied,
// so nothing that merely sits in the private dir can reach the public bundle.
for (const d of manifest.docs) {
  if (isPublicRoot(d) || d.kind !== 'imported' || d.state === 'draft') continue;
  const src = sourcePath(d);
  if (lstatSync(src).isSymbolicLink()) die(`refusing to publish: ${d.source} in the private docsite is a symlink — the bundle carries real files only`);
  const out = join(dist, relative(join(rootOf(d), 'imported'), src));
  mkdirSync(dirname(out), { recursive: true });
  cpSync(src, out);
  shipped.push(`/${d.urlPath} (${d.state}, imported, private source)`);
}

// 4. The index: published docs only. Freshness at publish time is proven by the --check above,
// so md rows are 'fresh' by verification (not by assumption); imported rows say what they are.
const rows = manifest.docs.filter((d) => d.state === 'published').map((d) => ({
  title: d.title, href: docHref(d), state: d.state, freshness: d.kind === 'imported' ? 'imported' : 'fresh', label: d.label || null,
}));
writeAtomic(join(dist, 'index.html'), renderIndex({ rows, note: 'Introductory documents.' }));

// 4b. The 404 page. Without a root 404.html, Cloudflare Pages answers 200-with-index for EVERY
// unmatched URL — including pages this very publish just excluded as drafts, which then read as
// still-published to anyone who probes them (measured 2026-08-28; commitwork-web hit the same
// defect). Its presence flips Pages from SPA fallback to real 404s.
writeAtomic(join(dist, '404.html'), render404());

// Cloudflare Pages reads _redirects from the bundle root. Written even when empty is NOT the same
// as not written: an empty file states "no redirects declared", where an absent one is silence.
if (redirects.length) writeAtomic(join(dist, '_redirects'), redirects.join('\n') + '\n');

// 4c. SECURITY HEADERS. Cloudflare Pages reads `_headers` from the bundle root and applies it at
// the edge, so these ship WITH the content rather than living in a dashboard nobody diffs — which
// is the whole reason they are here and not in the Cloudflare UI: a header set in a console is a
// configuration no reviewer of this repository can see and no deploy can restore.
//
// Measured on the live site before this existed (2026-10-04, `curl -sSI https://i.commitwork.online/`):
// x-content-type-options and referrer-policy were present, HSTS, CSP and framing were not.
//
// The CSP is as narrow as the bundle allows, and the bundle is why it can be this narrow:
//   script-src 'none'   — no page in the bundle carries a <script>. The guard below ASSERTS that
//                         rather than trusting it, because the day somebody publishes a page with
//                         one, this line breaks it silently and the page just stops working.
//   style-src 'unsafe-inline' — every page inlines its whole stylesheet (lib/docsite-page.mjs).
//                         'unsafe-inline' is the accurate description of that, not a concession;
//                         with script-src 'none' there is no script to be injected alongside it.
//   img-src 'self' data: — the favicon and the seal are data: URIs; og.png is same-origin.
//   frame-ancestors 'none' plus X-Frame-Options: DENY — the CSP directive is what modern browsers
//                         obey and the header is for the ones that do not. Both, not either.
const HEADERS = `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=(), interest-cohort=()
`;
writeAtomic(join(dist, '_headers'), HEADERS);

// 4d. THE GUARD THAT MAKES THE CSP SAFE TO SET. `script-src 'none'` is correct only while no
// shipped page needs script, and that is a property of the bundle, not a decision recorded here.
// Asserting it at assembly time is the second witness: the header above and this scan cannot both
// be wrong in the same direction, because one declares and the other reads the bytes.
//
// It is not hypothetical. docsite/imported/taxonomy.html carries a <script> today and is excluded
// only because its manifest state is `draft` — the day it is published, this refuses rather than
// deploying a page the policy breaks.
// WHAT COUNTS AS AN EXTERNAL RESOURCE, precisely. The first version of this guard flagged any
// absolute href on a <link>, and refused the whole bundle over `<link rel="canonical">` — which is
// METADATA and is never fetched, so no CSP has an opinion about it. Same for og:image, and same for
// every <a href>: a link a reader may follow is not a resource the page loads. Only the rels that
// cause a fetch belong here, which is why the rel is read rather than the tag name.
const FETCHING_RELS = /\b(stylesheet|preload|modulepreload|prefetch|dns-prefetch|preconnect|icon|manifest)\b/i;
const EXTERNAL = /^https?:\/\//i;
const attr = (tag, name) => {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name is a literal attribute name (href/src/rel) at each call site
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
const cspViolations = (html) => {
  const out = [];
  if (/<script\b/i.test(html)) out.push('a <script> tag');
  if (/\son[a-z]+\s*=\s*["'][^"']/i.test(html)) out.push('an inline event handler attribute');
  for (const m of html.matchAll(/<(link|img|iframe)\b[^>]*>/gi)) {
    const [tag, name] = [m[0], m[1].toLowerCase()];
    const url = name === 'link' ? attr(tag, 'href') : attr(tag, 'src');
    if (!EXTERNAL.test(url)) continue;
    if (name === 'link' && !FETCHING_RELS.test(attr(tag, 'rel'))) continue;   // canonical, alternate…
    out.push(`an external <${name}> resource: ${url}`);
  }
  return out;
};
const scanHtml = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { scanHtml(full); continue; }
    if (!/\.html?$/i.test(entry.name)) continue;
    const bad = cspViolations(readFileSync(full, 'utf8'));
    if (bad.length) {
      die(`refusing to publish: ${relative(dist, full)} contains ${bad.join(' and ')}, which the bundle's `
        + "Content-Security-Policy (script-src 'none', no external origins) blocks. Either the page "
        + 'changes or the policy does — not silently one of them.');
    }
  }
};

// 4e. robots.txt and sitemap.xml. Both answered HTTP 404 before this (measured 2026-10-04).
//
// THE SITEMAP IS BUILT FROM THE MANIFEST'S PUBLISHED DOCS AND NOTHING ELSE. Not from a walk of the
// bundle, which would also list the hidden docs — `hidden` means reachable-and-unlisted BY
// DECLARATION, and a sitemap is the most listed a URL can get. Not from a hand-kept list either.
// robots.txt does the matching job on the other side: /edit is a redirect into the authenticated
// panel, and pointing a crawler at it publishes the shape of the operator's tooling for no gain.
const base = (process.env.CW_DOCSITE_BASE_URL || 'https://i.commitwork.online').replace(/\/+$/, '');
//
// THE SITEMAP LISTS THE URL THAT ANSWERS 200, which is not always docHref. An `md` doc deploys as
// <path>/index.html and docHref's trailing slash is exactly right. An `imported` doc deploys as a
// FLAT <path>.html, and Cloudflare Pages answers its trailing-slash form with a 308 to the
// slashless one — measured 2026-10-04: `/taxonomy-reference/` → `308, location: /taxonomy-reference`.
// A sitemap full of redirects is reported back as "page with redirect" and excluded from the index,
// so listing docHref for these would have published a sitemap that indexes nothing. The site's own
// index page still links the trailing-slash form and still gets there in one redirect; this is
// about the crawler contract, not about the links.
const publicPath = (d) => (d.kind === 'imported' ? `/${d.alias || d.urlPath}` : docHref(d));
const sitemapHrefs = ['/', ...manifest.docs.filter((d) => d.state === 'published').map(publicPath)];
writeAtomic(join(dist, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + sitemapHrefs.map((h) => `  <url><loc>${base}${h}</loc></url>\n`).join('')
  + '</urlset>\n');
writeAtomic(join(dist, 'robots.txt'),
  'User-agent: *\nDisallow: /edit\nDisallow: /edit/\nAllow: /\n\n'
  + `Sitemap: ${base}/sitemap.xml\n`);
shipped.push(`/robots.txt, /sitemap.xml (${sitemapHrefs.length} URLs)`);

// 5. THE EDITOR IS NOT PUBLISHED. It used to ship here as a static shell at /edit/, and Cloudflare
// Pages is a static host with no authentication in front of it — so the editing interface was
// world-readable to anyone who guessed the path. The WRITES were never open (every mutating route
// in admin/routes/docsite.mjs sits behind serve.mjs's login gate; an unauthenticated
// POST /api/docsite/save returns 403, measured 2026-08-29), but shipping the console itself
// published the shape of the tooling and invited attempts against it for no benefit.
//
// There is no loss, because the same editor is already served BEHIND the operator's OAuth by the
// panel at GET /docsite/edit, with /docsite/index beside it and the /edit-assets/* files served
// from the same origin — all of them answering 401 unauthenticated on the published port, measured
// the same day. Operator instruction 2026-08-29: "it was never meant to have a fully public edit
// mode". The editor moved to the origin that can ask who you are, rather than gaining a second
// password nobody would rotate.

// 6. Extra public statics (og.png, a releases.atom): docsite/public/** passes through to the root.
const pubDir = join(docsiteRoot(), 'public');
if (existsSync(pubDir)) {
  // A passthrough file that lands on a generated name would REPLACE the declaration with whatever
  // happens to sit in public/ — a stale sitemap listing withdrawn pages, or a robots.txt opening
  // /edit — and cpSync would do it without a word. The generated names are the declaration; a
  // collision is a refusal, not a last-writer-wins.
  const GENERATED = new Set(['index.html', '404.html', '_redirects', '_headers', 'robots.txt', 'sitemap.xml']);
  for (const entry of readdirSync(pubDir)) {
    if (GENERATED.has(entry)) die(`refusing to publish: docsite/public/${entry} would overwrite the generated ${entry} — one of them has to go`);
  }
  cpSync(pubDir, dist, { recursive: true });
  shipped.push(`public/ passthrough (${readdirSync(pubDir).length} entries)`);
}

// 6b. The two assembly-time guards, run over the FINISHED bundle so they see exactly what deploys.
scanHtml(dist);

// og:image names an absolute URL on this origin. A tag pointing at a 404 is worse than no tag: the
// crawler that fetched it records the failure against the page and caches that. So the tag and the
// asset are checked together, in the direction that can actually be wrong — a page claiming an
// image the bundle does not carry.
const ogNamed = new Set();
const collectOg = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { collectOg(full); continue; }
    if (!/\.html?$/i.test(entry.name)) continue;
    for (const m of readFileSync(full, 'utf8').matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi)) ogNamed.add(m[1]);
  }
};
collectOg(dist);
for (const url of ogNamed) {
  let p;
  try { p = new URL(url).pathname; } catch { die(`refusing to publish: og:image "${url}" is not a URL`); }
  if (!existsSync(join(dist, p.replace(/^\/+/, '')))) {
    die(`refusing to publish: og:image names ${url} and the bundle does not carry ${p} — `
      + 'render it with `node bin/docsite-og-image.mjs --write` or remove the tag');
  }
}

console.log(`bundle at ${dist}`);
console.log(`  shipped:\n    ${shipped.join('\n    ') || '(nothing)'}`);
console.log(`  excluded:\n    ${excluded.join('\n    ') || '(nothing)'}`);

if (dryRun) { console.log('dry run — no deploy'); process.exit(0); }

// 7. Deploy. Wrangler holds the credentials (keychain); this script only names the bundle.
let out;
try {
  out = execFileSync(wranglerBin(), ['pages', 'deploy', dist, '--project-name', project(), '--branch', branch(), '--commit-dirty=true'], {
    cwd: REPO, timeout: 300_000, encoding: 'utf8',
  });
} catch (e) {
  die(`wrangler deploy failed:\n${(e.stdout || '')}\n${(e.stderr || e.message)}`);
}
console.log(out.split('\n').slice(-6).join('\n'));

// 8. INVALIDATE THE EDGE CACHE. A Pages deployment is correct at the deployment level the instant
// it completes — its own *.pages.dev URL always serves the new bundle — but the CUSTOM DOMAIN in
// front of it goes through Cloudflare's separate edge cache, which a deployment does NOT implicitly
// invalidate. Measured 2026-08-30: i.commitwork.online/edit/ answered 200 with age 74613s (20.7
// hours) while the same path on the production alias answered 404. A deploy that leaves the public
// URL serving the previous bundle has not finished, so the purge belongs HERE and not in a habit.
//
// Failure to purge is REPORTED, never fatal and never silent: the bundle is already live and
// rolling the deployment back over a cache call would be the worse outcome. An unpurged deploy is
// a known state with a named next step, not a clean one.
if (process.env.CW_DOCSITE_NO_PURGE) {
  console.log('edge cache: purge SKIPPED (CW_DOCSITE_NO_PURGE set) — the custom domain may serve the previous bundle');
} else if (!process.env.CW_CLOUDFLARE_ZONE_ID) {
  console.log('edge cache: NOT PURGED — CW_CLOUDFLARE_ZONE_ID is unset. The deployment is live, but the '
    + 'custom domain can keep serving the previous bundle until its TTL expires. Purge with:\n'
    + '  node bin/cloudflare-purge.mjs');
} else {
  try {
    const pout = execFileSync(process.execPath, [join(REPO, 'bin', 'cloudflare-purge.mjs')],
      { cwd: REPO, timeout: 120_000, encoding: 'utf8' });
    console.log(`edge cache: ${pout.trim().split('\n').pop()}`);
  } catch (e) {
    console.log('edge cache: PURGE FAILED — the deployment is live and unchanged, but the custom domain '
      + `may serve the previous bundle until its TTL expires:\n  ${((e.stderr || e.message) || '').trim().split('\n')[0]}`);
  }
}
