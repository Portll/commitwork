// The publish bundle: drafts are excluded BY NAME (no silent caps), hidden ships unlisted,
// imported snapshots land at the root with their chrome, the index lists published only, the
// editor shell gets the drafting origin baked in, and a drifted tree refuses to publish at all.
// Deploy itself is exercised through CW_WRANGLER (no network, no credentials in tests).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, cpSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'docsite');
const ALPHA_UUID = '0a1b2c3d-1111-4222-8333-444455556666';

const setup = ({ og = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-docsite-ptest-'));
  cpSync(FIXTURE, root, { recursive: true });
  // The og:image asset, which every generated page's head names. Written here rather than carried
  // in the fixture tree so the fixture stays text-only and reviewable; the guard under test checks
  // that the path EXISTS, so a stand-in is the honest shape of the input — and `og: false` is how
  // the absence is exercised below.
  if (og) {
    mkdirSync(join(root, 'public'), { recursive: true });
    writeFileSync(join(root, 'public', 'og.png'), 'stand-in for the rendered card; the guard checks presence, not pixels');
  }
  const dist = mkdtempSync(join(tmpdir(), 'cw-docsite-pdist-'));
  const env = { ...process.env, CW_DOCSITE_ROOT: root, CW_DOCSITE_DIST: dist };
  execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs')], { env, stdio: 'pipe' });
  return { root, dist, env };
};

const run = (env, args = []) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-publish.mjs'), ...args], { env, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

describe('docsite publish bundle', () => {
  test('drafts are excluded by name; hidden/published/imported ship', () => {
    const { dist, env } = setup();
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(dist, ALPHA_UUID, 'index.html')), 'published md doc ships');
    assert.ok(!existsSync(join(dist, 'beta')), 'draft must not ship');
    assert.match(r.out, /beta \(draft\)/, 'exclusion is named, never silent');
    assert.ok(existsSync(join(dist, 'legacy.html')), 'imported snapshot at bundle root');
  });

  test('index lists published docs only', () => {
    const { dist, env } = setup();
    run(env, ['--dry-run']);
    const index = readFileSync(join(dist, 'index.html'), 'utf8');
    assert.ok(index.includes(`/${ALPHA_UUID}/`));
    assert.ok(index.includes('/legacy'));
    assert.ok(!index.includes('/beta/'), 'draft absent from the index');
  });

  test('the editor is NOT in the public bundle — a static host cannot ask who you are', () => {
    // INVERTED 2026-08-29, and the previous version of this test is why it needs saying: it
    // asserted the editor SHIPPED, with the drafting origin baked in. That was a real decision and
    // the test was doing its job; what changed is the judgment, not the mechanism. Cloudflare Pages
    // serves whatever is in the bundle to anyone who asks, so /edit/ was a world-readable editing
    // console. The writes behind it were always gated — that is not the point, and treating it as
    // the point is how the console stayed public.
    const { dist, env } = setup();
    run(env, ['--dry-run']);
    assert.equal(existsSync(join(dist, 'edit', 'index.html')), false,
      'the editor shell is back in the public bundle — a static host has no session to check it against');
    for (const f of ['editor.js', 'editor.css', 'docsite-md.mjs', 'render-markdown.mjs']) {
      assert.equal(existsSync(join(dist, 'edit-assets', f)), false,
        `edit-assets/${f} is published — the editor's code is reachable without a session`);
    }
  });

  test('a drifted tree refuses to publish', () => {
    const { root, env } = setup();
    writeFileSync(join(root, 'pages', ALPHA_UUID, 'index.html'), '<!doctype html><p>hand-edit</p>');
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 2);
    assert.match(r.out, /refusing to publish over drift/);
  });

  test('a symlink under imported/ refuses the publish — the bundle carries real files only', () => {
    const { root, env } = setup();
    symlinkSync('/etc/hosts', join(root, 'imported', 'leak.html'));
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 2);
    assert.match(r.out, /symlink/);
  });

  // ── the bundle's edge configuration ──────────────────────────────────────────────────────────
  // Measured on the live site 2026-10-04, before any of this existed: HSTS, CSP and framing absent;
  // /robots.txt and /sitemap.xml both 404. These assert the bundle CARRIES the declaration. What a
  // deployment then does with it is Cloudflare's, and no test here can stand in for a response from
  // the real origin — that readback is named in the publish output, not simulated.
  test('_headers declares HSTS, CSP, framing, nosniff and a referrer policy', () => {
    const { dist, env } = setup();
    assert.equal(run(env, ['--dry-run']).code, 0);
    const h = readFileSync(join(dist, '_headers'), 'utf8');
    assert.match(h, /^\/\*$/m, 'the rule must apply to every path');
    for (const k of ['Strict-Transport-Security', 'Content-Security-Policy', 'X-Frame-Options',
      'X-Content-Type-Options', 'Referrer-Policy']) assert.match(h, new RegExp(`^\\s+${k}:`, 'm'), `${k} missing`);
    assert.match(h, /frame-ancestors 'none'/, 'CSP must deny framing too, not only the legacy header');
    assert.match(h, /default-src 'none'/);
  });

  test('robots.txt points at the sitemap and keeps crawlers off the editor path', () => {
    const { dist, env } = setup();
    assert.equal(run(env, ['--dry-run']).code, 0);
    const r = readFileSync(join(dist, 'robots.txt'), 'utf8');
    assert.match(r, /^User-agent: \*$/m);
    assert.match(r, /^Disallow: \/edit$/m, '/edit redirects into the authenticated panel — not a crawl target');
    assert.match(r, /^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
  });

  test('the sitemap lists published docs only — never a draft, never a hidden doc', () => {
    const { dist, env } = setup();
    assert.equal(run(env, ['--dry-run']).code, 0);
    const s = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
    assert.match(s, /<urlset\b/, 'siteCrawl checks the root element, not just the status');
    assert.ok(s.includes(`/${ALPHA_UUID}/`), 'published md doc listed');
    assert.ok(!s.includes('/beta'), 'a draft must not be advertised to a crawler');
    // `hidden` means reachable-and-unlisted BY DECLARATION. A sitemap is the most listed a URL gets,
    // so the two cannot both be honoured and the declaration wins.
    for (const d of JSON.parse(readFileSync(join(env.CW_DOCSITE_ROOT, 'manifest.json'), 'utf8')).docs) {
      if (d.state === 'hidden') assert.ok(!s.includes(`/${d.urlPath}`), `hidden doc ${d.slug} is in the sitemap`);
    }
    // An imported doc deploys as a flat <path>.html and Pages 308s its trailing-slash form, so the
    // sitemap must name the slashless URL or it indexes a redirect.
    assert.ok(s.includes('<loc>https://i.commitwork.online/legacy</loc>'), 'imported doc listed at the URL that answers 200');
  });

  test('public/ cannot silently overwrite a generated bundle file', () => {
    const { root, env } = setup();
    writeFileSync(join(root, 'public', 'robots.txt'), 'User-agent: *\nDisallow:\n');
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /would overwrite the generated robots\.txt/);
  });

  test('og:image naming an asset the bundle does not carry refuses the publish', () => {
    // The direction that lies to you: a tag resolving fine locally and 404ing in production is
    // invisible from here, so the check is on the BUNDLE, and it is proved by its absence case.
    const { env } = setup({ og: false });
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /og:image names .*\/og\.png and the bundle does not carry/);
  });

  test('a page the CSP would break refuses the publish, and a canonical link does not', () => {
    const { root, env } = setup();
    // Guard-fires half. docsite/imported/taxonomy.html carries a <script> today and ships only
    // because it is a draft — this is that case, made explicit rather than left to luck.
    writeFileSync(join(root, 'imported', 'legacy.html'), '<!doctype html><html><body><script>1</script></body></html>');
    // Rebuild first: the drift gate runs before the bundle is assembled and would otherwise be the
    // thing that refuses, which would leave the CSP guard untested while the test went green.
    execFileSync(process.execPath, [join(REPO, 'bin', 'docsite-build.mjs')], { env, stdio: 'pipe' });
    const r = run(env, ['--dry-run']);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /contains a <script> tag/);
    // Guard-does-not-overfire half, asserted separately because only one of the two directions is
    // the one that would quietly block every publish: the first version of this guard read
    // `<link rel="canonical" href="https://…">` as an external resource and refused the whole
    // bundle. A canonical is metadata and is never fetched; no CSP governs it.
    const clean = setup();
    const ok = run(clean.env, ['--dry-run']);
    assert.equal(ok.code, 0, ok.out);
    assert.match(readFileSync(join(clean.dist, 'index.html'), 'utf8'), /<link rel="canonical" href="https:\/\//);
  });

  test('deploy invokes the wrangler override with the bundle and project', () => {
    const { env } = setup();
    const r = run({ ...env, CW_DOCSITE_PROJECT: 'test-project', CW_WRANGLER: '/bin/echo' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pages deploy .*--project-name test-project/, 'echo shows the exact deploy call');
  });
});
