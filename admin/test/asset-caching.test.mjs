// Static assets must revalidate, not re-transfer. `no-store` forbade STORING, so every navigation
// re-sent ~140 KB of stylesheet and panel JS to prove none of it had changed. `no-cache` + ETag
// forbids USING WITHOUT ASKING instead: the file is re-read and re-hashed per request, so a live
// edit still applies on the next load, and an unchanged asset answers 304 with no body.
//
// THE LIVE-EDIT ARM IS THE POINT. `no-store` was correct about the risk it named — a cached
// stylesheet makes an applied change look unapplied — so this asserts that risk is still closed,
// by editing the file and re-presenting the OLD validator.
//
// Fixture is a disposable worktree. Its admin/ tree is overlaid from the working tree as one unit:
// copying only serve.mjs over HEAD can pair it with an older auth.mjs that lacks an imported export,
// creating a tree that has never existed and measuring an import failure instead of caching.
// Requests go to the loopback OPERATOR port, which serves every asset ungated — the public port's
// gating differs between HEAD and this working tree, and pinning that would measure a gate.
//
// CW_TEST_SERVE overrides the serve.mjs under test (read at call time). Unset, it takes the working
// tree's, so this file is red until the patch lands and green after.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-assetcache-'));
const WT = join(TMP, 'wt');

const STABLE = '/static/panel.css';            // never mutated — the 200/304 pair
const EDITED = '/static/panel-light.css';      // mutated mid-test — the live-edit guarantee
const GONE = '/static/panel-cvd-light.css';    // deleted from the worktree — the 404 arm
const PROBE = '/static/config.css';            // probe-patched below — the extraHeaders arm
const PLAIN = '/cw-favicon.svg';               // passes no extraHeaders — the default arm
const FONT = '/static/fonts/IBMPlexSans-Regular-Latin1.woff2'; // not a sendAsset route at all

const EDIT_MARKER = '/* cw-live-edit-marker */\n:root{--cw-live-edit:1}\n';

// Every sendAsset route, for the cold-vs-warm byte measurement. GONE is excluded (deleted here).
const ALL_ASSETS = [STABLE, EDITED, '/static/panel-cvd.css', '/static/comments.js',
  '/static/learning.js', '/static/bola.js', '/static/theme-switch.js', '/static/house.css', PROBE, PLAIN];

let port; let localPort; let child; let up = false;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path, { method = 'GET', headers = {}, operator = true } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method,
    headers: { host: 'localhost', ...headers } }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
  });
  req.on('error', reject);
  req.end();
});

// serve.mjs throttles with 503 + retry-after; honour the server's own retry rather than scoring it.
const get = async (path, opts = {}, tries = 6) => {
  for (let i = 0; i < tries; i += 1) {
    const r = await hit(path, opts);
    if (r.status !== 503) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  return hit(path, opts);
};

before(async () => {
  execFileSync('git', ['-C', REPO, 'worktree', 'add', '-q', '--detach', WT, 'HEAD'], { stdio: 'pipe' });
  cpSync(join(REPO, 'admin'), join(WT, 'admin'), { recursive: true, force: true });
  // report.mjs currently depends on this new monitor module; keep the copied admin tree's direct
  // dependency graph coherent until both files are committed together.
  cpSync(join(REPO, 'monitor', 'history-chain.mjs'), join(WT, 'monitor', 'history-chain.mjs'));
  const under = process.env.CW_TEST_SERVE || join(REPO, 'admin', 'serve.mjs');
  assert.ok(existsSync(under), `serve.mjs under test does not exist: ${under}`);

  // PROBE PATCH, confined to the disposable checkout. After the fix no shipped caller passes a
  // header that differs from sendAsset's default, so the extraHeaders parameter has no exerciser —
  // an untestable parameter is how a silently-dropped argument survives. This synthesises the one
  // caller that discriminates: a cache-control that must WIN over the default, plus a marker header
  // that must reach the wire on both the 200 and the 304.
  const src = readFileSync(under, 'utf8');
  const anchor = "if (req.method === 'GET' && pathname === '/static/config.css') return sendAsset(join(STATIC_DIR(), 'config.css'), 'text/css');";
  const probed = "if (req.method === 'GET' && pathname === '/static/config.css') return sendAsset(join(STATIC_DIR(), 'config.css'), 'text/css', { 'x-cw-probe': 'extraheaders', 'cache-control': 'no-cache, max-age=0', etag: '\"caller-pinned\"' });";
  assert.ok(src.includes(anchor), 'the config.css route no longer matches the probe anchor — update it, do not skip the extraHeaders arm');
  writeFileSync(join(WT, 'admin', 'serve.mjs'), src.replace(anchor, probed));

  rmSync(join(WT, 'admin', 'static', 'panel-cvd-light.css'), { force: true });
  assert.ok(!existsSync(join(WT, 'admin', 'static', 'panel-cvd-light.css')), 'the 404 fixture asset is still present');
  assert.ok(existsSync(join(WT, 'admin', 'static', 'panel.css')), 'the control asset is missing too — both arms are the same arm');

  mkdirSync(join(TMP, 'src'), { recursive: true });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
  }));

  port = await freePort();
  localPort = await freePort();
  let err = '';
  child = spawn(process.execPath, [join(WT, 'admin', 'serve.mjs')], {
    env: {
      ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'),
      CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { err += String(d); });
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf', { operator: false }); if (r.status === 200) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, `panel did not come up${err ? ` — child stderr:\n${err}` : ''}`);
  const reach = await get(STABLE);
  assert.equal(reach.status, 200,
    `the operator port answered ${reach.status} for an asset that IS present — every assertion below `
    + 'would be measuring a gate rather than the file');
});

after(() => {
  child?.kill('SIGKILL');
  try { execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', WT], { stdio: 'pipe' }); } catch { /* gone */ }
  rmSync(TMP, { recursive: true, force: true });
});

describe('static assets revalidate instead of re-transferring', () => {
  test('a first GET carries an etag and cache-control: no-cache', async () => {
    const r = await get(STABLE);
    assert.equal(r.status, 200);
    assert.ok(r.headers.etag, 'no etag — there is nothing for a conditional request to present');
    assert.match(r.headers.etag, /^"[A-Za-z0-9_-]+"$/, `etag is not a quoted opaque token: ${r.headers.etag}`);
    assert.equal(r.headers['cache-control'], 'no-cache',
      `cache-control is ${r.headers['cache-control']} — no-store forbids storing, so the etag can never be presented`);
    assert.ok(r.body.length > 500, `only ${r.body.length} bytes — served, but not the stylesheet`);
  });

  test('the same etag comes back for unchanged content — it is a content hash, not a nonce', async () => {
    const a = await get(STABLE);
    const b = await get(STABLE);
    assert.equal(a.headers.etag, b.headers.etag,
      'the etag changed without the file changing — every revalidation would miss');
  });

  test('a conditional GET with the current etag answers 304 with an EMPTY body', async () => {
    const first = await get(STABLE);
    assert.equal(first.status, 200);
    assert.ok(first.body.length > 500, 'the 200 arm sent no body — the 304 below would prove nothing');

    const second = await get(STABLE, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(second.status, 304, `revalidation answered ${second.status} — the body is still on the wire`);
    // NEGATIVE CONTROL: a status-only assertion passes if the server 304s unconditionally, and the
    // saving is zero if the 304 still carries the body. Both directions are pinned here.
    assert.equal(second.body.length, 0,
      `the 304 carried ${second.body.length} bytes — a 304 with a body saves nothing`);
    assert.equal(second.headers.etag, first.headers.etag,
      'the 304 did not echo the matched etag — it may not have compared anything');
    assert.equal(second.headers['cache-control'], 'no-cache',
      'the 304 dropped cache-control — the stored copy loses its revalidation instruction');
  });

  test('NEGATIVE CONTROL: a non-matching etag still gets 200 and the full body', async () => {
    const r = await get(STABLE, { headers: { 'if-none-match': '"not-the-etag-of-anything"' } });
    assert.equal(r.status, 200,
      'a stale validator was answered 304 — the server 304s anything carrying if-none-match, and a '
      + 'browser would keep a copy it can never refresh');
    assert.ok(r.body.length > 500, `only ${r.body.length} bytes on a cache miss`);
  });

  test('a weak validator matches — If-None-Match uses weak comparison (RFC 9110 §13.1.2)', async () => {
    const first = await get(STABLE);
    const r = await get(STABLE, { headers: { 'if-none-match': `W/${first.headers.etag}` } });
    assert.equal(r.status, 304, 'W/"x" did not match "x" — a proxy that weakens the tag defeats every revalidation');
  });

  test('a list of validators matches on any member', async () => {
    const first = await get(STABLE);
    const r = await get(STABLE, { headers: { 'if-none-match': `"stale-one", ${first.headers.etag}, "stale-two"` } });
    assert.equal(r.status, 304, 'a multi-value if-none-match was not parsed as a list');
  });
});

describe('THE LIVE-EDIT GUARANTEE — the reason no-store was there', () => {
  test('editing the file invalidates the old etag: same if-none-match, new body, new etag', async () => {
    const before = await get(EDITED);
    assert.equal(before.status, 200);
    assert.ok(before.headers.etag, 'no etag on the asset about to be edited');
    assert.ok(!before.body.includes(EDIT_MARKER.trim().split('\n')[0]), 'the marker is already present — the arm is void');

    // 304 first, so the "unchanged" state is proven before the edit rather than assumed.
    const warm = await get(EDITED, { headers: { 'if-none-match': before.headers.etag } });
    assert.equal(warm.status, 304, 'the pre-edit revalidation did not 304 — the edit below proves nothing');

    writeFileSync(join(WT, 'admin', 'static', 'panel-light.css'), `${EDIT_MARKER}${before.body}`);

    const after = await get(EDITED, { headers: { 'if-none-match': before.headers.etag } });
    assert.equal(after.status, 200,
      'THE LIVE EDIT WAS NOT SEEN. The browser was told its pre-edit copy is still current — exactly '
      + 'the failure no-store existed to prevent, and the whole reason this change must be no-cache '
      + 'rather than max-age');
    assert.ok(after.body.startsWith(EDIT_MARKER), 'the 200 did not carry the edited bytes');
    assert.notEqual(after.headers.etag, before.headers.etag,
      'the etag survived a content change — every later revalidation would serve the stale copy');
  });

  test('the new etag then revalidates to 304 in its own right', async () => {
    const r = await get(EDITED);
    assert.equal(r.status, 200);
    const again = await get(EDITED, { headers: { 'if-none-match': r.headers.etag } });
    assert.equal(again.status, 304, 'the post-edit etag does not revalidate — caching is off after any edit');
  });
});

describe('the 404 path does not regress', () => {
  test('a missing asset still 404s, is not served as CSS, and names the file', async () => {
    const r = await get(GONE);
    assert.equal(r.status, 404,
      `answered ${r.status} — a 200 here is indistinguishable from a stylesheet that needed no overrides`);
    assert.match(r.headers['content-type'] || '', /text\/plain/);
    assert.match(r.body, /panel-cvd-light\.css/, 'the 404 must name the file, or it is a shrug');
  });

  test('a missing asset carries no etag — there is no representation to validate', async () => {
    const r = await get(GONE);
    assert.equal(r.headers.etag, undefined, 'a 404 offered a validator for a body that does not exist');
  });

  test('if-none-match: * on a MISSING asset is 404, never 304', async () => {
    // `*` means "any current representation". A missing asset has none, so a 304 here would tell the
    // browser its stale copy is still good — an unsupported pass, in cache form.
    const r = await get(GONE, { headers: { 'if-none-match': '*' } });
    assert.equal(r.status, 404,
      'a deleted asset answered 304 to `*` — the conditional check ran before the existence check');
    const r2 = await get(GONE, { headers: { 'if-none-match': '"whatever"' } });
    assert.equal(r2.status, 404, 'a deleted asset answered a conditional GET with something other than 404');
  });

  test('if-none-match: * on a PRESENT asset is 304 — the control for the arm above', async () => {
    const r = await get(STABLE, { headers: { 'if-none-match': '*' } });
    assert.equal(r.status, 304, '`*` did not match an asset that exists — the 404 arm above passes for the wrong reason');
  });
});

describe('extraHeaders and the untouched routes', () => {
  test('a caller-supplied header reaches the wire on the 200 and the 304', async () => {
    const first = await get(PROBE);
    assert.equal(first.status, 200);
    assert.equal(first.headers['x-cw-probe'], 'extraheaders', 'extraHeaders was dropped on the 200 path');
    const second = await get(PROBE, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(second.status, 304);
    assert.equal(second.headers['x-cw-probe'], 'extraheaders', 'extraHeaders was dropped on the 304 path');
  });

  test("a caller's cache-control WINS over the default", async () => {
    const r = await get(PROBE);
    assert.equal(r.headers['cache-control'], 'no-cache, max-age=0',
      `cache-control is ${r.headers['cache-control']} — the default overwrote the caller instead of the other way round`);
  });

  test('the etag COMPARED is the etag ADVERTISED, even when a caller overrides it', async () => {
    // Matching the computed hash while sending the caller's tag yields an asset whose validator can
    // never match: a permanent 200 that looks like working revalidation.
    const r = await get(PROBE);
    assert.equal(r.headers.etag, '"caller-pinned"', 'the caller-supplied etag did not reach the wire');
    const cond = await get(PROBE, { headers: { 'if-none-match': '"caller-pinned"' } });
    assert.equal(cond.status, 304,
      'the advertised etag was presented back and did not match — the comparison uses a tag the client never saw');
    assert.equal(cond.body.length, 0);
  });

  test('a caller passing NO headers still gets the etag and the no-cache default', async () => {
    const r = await get(PLAIN);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /image\/svg/);
    assert.ok(r.headers.etag, 'a bare sendAsset caller got no etag');
    assert.equal(r.headers['cache-control'], 'no-cache',
      'a bare caller sent no cache-control — this route was the one exposed to heuristic caching');
    const cond = await get(PLAIN, { headers: { 'if-none-match': r.headers.etag } });
    assert.equal(cond.status, 304);
    assert.equal(cond.body.length, 0);
  });

  test('nosniff survives on both the 200 and the 304', async () => {
    const first = await get(STABLE);
    assert.equal(first.headers['x-content-type-options'], 'nosniff');
    const second = await get(STABLE, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(second.headers['x-content-type-options'], 'nosniff', 'the 304 dropped nosniff');
  });

  test('the immutable font route is untouched — no etag, no no-cache', async () => {
    const r = await get(FONT);
    assert.equal(r.status, 200, 'the font route stopped serving');
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable',
      'the font route picked up asset caching it does not go through');
    assert.equal(r.headers.etag, undefined, 'the font route grew an etag it never had');
  });

  test('HEAD does not regress: asset routes are GET-only and answer 404 with no body', async () => {
    // Pinned as MEASURED against the unpatched server, not as desired. Every asset route gates on
    // `req.method === 'GET'`, so HEAD never reaches sendAsset and falls to the catch-all. Changing
    // that is a separate decision; this arm exists so the caching change cannot change it silently.
    for (const p of [STABLE, PLAIN, PROBE]) {
      const r = await hit(p, { method: 'HEAD' });
      assert.equal(r.status, 404, `HEAD ${p} answered ${r.status} — the caching change altered HEAD routing`);
      assert.equal(r.body.length, 0, `HEAD ${p} returned a body`);
      assert.equal(r.headers.etag, undefined, `HEAD ${p} grew an etag`);
    }
  });
});

describe('the saving is real, not notional', () => {
  test('a warm navigation transfers under 5% of a cold one', async () => {
    const cold = [];
    for (const p of ALL_ASSETS) {
      const r = await get(p);
      if (r.status === 200 && r.headers.etag) cold.push([p, r.headers.etag, r.body.length]);
    }
    assert.ok(cold.length >= 8, `only ${cold.length} asset routes answered 200 with an etag — the sample is too thin to measure`);

    const coldBytes = cold.reduce((n, [, , len]) => n + len, 0);
    assert.ok(coldBytes > 100_000, `a cold navigation was only ${coldBytes} bytes — the fixture is not the real asset set`);

    let warmBytes = 0; let notModified = 0;
    for (const [p, etag] of cold) {
      const r = await get(p, { headers: { 'if-none-match': etag } });
      if (r.status === 304) notModified += 1;
      warmBytes += r.body.length;
    }
    assert.equal(notModified, cold.length, `${cold.length - notModified} of ${cold.length} assets re-sent on a warm load`);
    assert.ok(warmBytes < coldBytes * 0.05,
      `warm navigation moved ${warmBytes} bytes against a cold ${coldBytes} — the revalidation is not saving anything`);
  });
});
