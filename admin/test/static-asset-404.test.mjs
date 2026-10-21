// A missing static asset must 404, not answer 200 with an empty body.
//
// readTxt swallows a read failure to '' — correct at its other callers, where absent really is
// empty — and eleven asset routes passed that straight into send(200, …, 'text/css'). So a missing
// stylesheet was byte-indistinguishable from one that needed no overrides: no console warning, no
// log line, nothing. admin/static/panel-light.css sat referenced-by-HEAD and never committed for
// 32+ hours and the light theme silently did not exist off the machine that wrote it.
//
// THE FIXTURE IS A TEMP STATIC ROOT, not a mutation of the repo. serve.mjs reads CW_ADMIN_STATIC
// at call time, so the absent asset is staged somewhere writable without racing the other sessions
// on this tree. This was a detached worktree with the WORKING TREE's serve.mjs copied over it, so
// that an uncommitted fix would be covered — but that spliced one file onto an otherwise-HEAD
// checkout and produced a tree that has never existed. It failed on an import HEAD could not
// resolve (SEMGREP_PRO_MAX) while BOTH real trees were internally consistent, and a defect
// belonging to neither tree is unattributable by construction. The server under test is now this
// working tree's, whole.
//
// IT ASKS THE OPERATOR PORT, and that is not incidental. The first version asked the public one and
// passed here while FAILING against HEAD — 503 unbootstrapped, then 401 once bootstrapped, because
// the public asset routes sit in front of those gates only in THIS working tree, where another
// session is moving them and has not committed it. Measured against HEAD, /static/panel.css answers
// 200 on the public port and /static/panel-light.css answers 503, so even the committed ordering is
// not uniform. The loopback operator port serves every asset ungated on both, so this asserts
// presence and absence and nothing about a placement somebody else is mid-way through changing.
// A test that pins another session's in-flight route order is green for its author and red for
// everyone else, which is the defect this very file exists to catch, one layer up.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-asset404-'));
const STATIC = join(TMP, 'static');

// The asset deleted from the fixture static root, and one left in place. Both must be real routes,
// test proves nothing about either arm.
const GONE = 'panel-light.css';
const KEPT = 'panel.css';

let port; let localPort; let child; let up = false;

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

const hit = (path, { method = 'GET', body = null, headers = {}, operator = false } = {}) => new Promise((resolve, reject) => {
  const h = { host: 'localhost', ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: operator ? localPort : port, path, method, headers: h },
    (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json }); });
    });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});

// serve.mjs:443 throttles with 503 + retry-after when authentication is busy, and a test firing
// requests back to back trips it. Honouring the server's own retry is the correct read; treating
// its "ask again" as a verdict would make this test fail for a reason unrelated to what it checks.
const get = async (path, tries = 6) => {
  for (let i = 0; i < tries; i += 1) {
    const r = await hit(path, { operator: true });
    if (r.status !== 503) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  return hit(path);
};

before(async () => {
  // Copy the real static dir, then remove ONE asset from the copy. The repo is never mutated.
  mkdirSync(STATIC, { recursive: true });
  const realStatic = join(REPO, 'admin', 'static');
  for (const f of readdirSync(realStatic)) {
    if (statSync(join(realStatic, f)).isFile()) copyFileSync(join(realStatic, f), join(STATIC, f));
  }
  rmSync(join(STATIC, GONE), { force: true });
  assert.ok(!existsSync(join(STATIC, GONE)), 'the fixture asset is still present');
  assert.ok(existsSync(join(STATIC, KEPT)), 'the control asset is missing too — both arms are the same arm');

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
  child = spawn(process.execPath, [join(REPO, 'admin', 'serve.mjs')], {
    env: {
      ...process.env,
      CW_ADMIN_STATIC: STATIC,
      CW_AUTH_STORE: join(TMP, 'users.json'),
      CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { err += String(d); });
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) { up = true; break; } } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, `panel did not come up${err ? ` — child stderr:\n${err}` : ''}`);
  // The surface under test must be ungated before anything below asserts on it, or a gate's
  // refusal reads as the fix working.
  const reach = await hit(`/static/${KEPT}`, { operator: true });
  assert.equal(reach.status, 200,
    `the operator port answered ${reach.status} for an asset that IS present — every assertion `
    + 'below would be measuring a gate rather than the file');
});

after(() => {
  child?.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
});

describe('a missing asset is reported, not silently emptied', () => {
  test('THE DEFECT: an absent stylesheet 404s instead of answering 200 with nothing', async () => {
    const r = await get(`/static/${GONE}`);
    assert.equal(r.status, 404,
      `answered ${r.status} with ${r.body.length} bytes — a 200 here is indistinguishable from a `
      + 'stylesheet that needed no overrides, which is how the light theme went missing unnoticed');
    assert.match(r.body, new RegExp(GONE), 'the 404 must name the file, or it is a shrug');
  });

  test('the 404 is not served as CSS — a browser must not parse an error as a stylesheet', async () => {
    const r = await get(`/static/${GONE}`);
    assert.match(r.headers['content-type'] || '', /text\/plain/);
  });

  test('CONTROL: an asset that IS present still serves 200 with its real content', async () => {
    const r = await get(`/static/${KEPT}`);
    assert.equal(r.status, 200, 'the fix broke the ordinary case');
    assert.match(r.headers['content-type'] || '', /text\/css/);
    assert.ok(r.body.length > 500, `only ${r.body.length} bytes — served, but not the stylesheet`);
    assert.match(r.body, /--bg/, 'the body is not panel.css');
  });

  test('an SVG behaves the same way — the fix is not CSS-only', async () => {
    const r = await get('/cw-favicon.svg');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'] || '', /image\/svg/);
    assert.ok(r.body.includes('<svg'), 'served, but not the SVG');
  });

});
