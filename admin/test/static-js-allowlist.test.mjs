// The panel's view modules come from ONE declared allowlist — what serve.mjs declares, what
// index.html asks for and what the server will send, held to a single list rather than three kept
// in step by memory. The FONT_ASSETS arrangement, applied to JS.
// The route is exact-match on purpose; the traversal and undeclared-file cases below are what makes
// "still exact-match" a measurement rather than a comment.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, Socket } from 'node:net';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '..');
// CW_TEST_SERVE runs this against a patched COPY before the patch lands. Unset — the normal case —
// it is admin/serve.mjs. Everything below reads its source and spawns it from this one path, so a
// stray override cannot make the file assertions and the wire assertions disagree about the subject.
const SERVE = process.env.CW_TEST_SERVE || join(ADMIN, 'serve.mjs');
const SERVE_DIR = dirname(SERVE);
const SRC = serverSource();
const HTML = panelSource('index.html');

/** The frozen array, read out of the source — serve.mjs binds a port, so it cannot be imported. */
function declared() {
  const at = SRC.indexOf('const STATIC_JS_MODULES = Object.freeze([');
  assert.ok(at > -1, 'serve.mjs no longer declares STATIC_JS_MODULES — the view modules are back to one hand-written route each, or the name moved');
  const end = SRC.indexOf(']);', at);
  assert.ok(end > -1, 'STATIC_JS_MODULES is unterminated');
  return [...SRC.slice(at, end).matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
}
const DECLARED = declared();
/** Every /static/*.js index.html loads — <script src> and any dynamic import of the same shape. */
const REFERENCED = [...HTML.matchAll(/<script[^>]+src="(\/static\/[^"]+\.js)"/g)].map((m) => m[1]);

// Strings that exist in serve.mjs and in nothing this server sends. Their job is to make "the
// traversal did not leak" a measurement rather than a hope; the negative control below proves the
// predicate fires on the real file.
const SENTINELS = ['CSRF_TOKEN', 'codeStamp', 'assertOperatorPortUnroutable'];
const leaks = (text) => SENTINELS.filter((s) => text.includes(s));

const TMP = mkdtempSync(join(tmpdir(), 'cw-staticjs-'));
// A .js file that EXISTS in the directory the server reads from and is NOT declared. This is the
// only assertion here that can tell an allowlist from a directory listing.
const PROBE = join(SERVE_DIR, 'static', '__undeclared-probe.js');
const PROBE_BODY = 'window.__UNDECLARED_PROBE__ = 1;\n';
let probeMine = false;

let port, localPort, child;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/**
 * A request written straight onto the socket. http.request() would normalise `..` and refuse a NUL
 * before the server ever saw either, so the client would be doing the defending and the test would
 * pass on a server that does none. HTTP/1.0 so the body arrives unframed.
 */
const raw = (line, to) => new Promise((resolve) => {
  const s = new Socket();
  let buf = Buffer.alloc(0);
  s.setTimeout(5000, () => s.destroy());
  s.on('data', (d) => { buf = Buffer.concat([buf, d]); });
  s.on('error', () => { /* a reset IS an answer — resolved below with what arrived */ });
  s.on('close', () => {
    const txt = buf.toString('latin1');
    const cut = txt.indexOf('\r\n\r\n');
    resolve({
      status: +(txt.match(/^HTTP\/1\.[01] (\d{3})/) || [0, 0])[1],
      head: cut < 0 ? txt : txt.slice(0, cut),
      body: cut < 0 ? '' : txt.slice(cut + 4),
      text: txt,
    });
  });
  s.connect(to ?? localPort, '127.0.0.1', () => {
    s.write(Buffer.from(`GET ${line} HTTP/1.0\r\nHost: 127.0.0.1\r\nAccept: */*\r\n\r\n`, 'latin1'));
  });
});

/** A panel on two fresh ports against the fixture registry, waited on until it answers. */
async function boot() {
  const pub = await freePort();
  const loop = await freePort();
  const proc = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_SECRETS_FILE: join(TMP, 'secrets.json'), CW_ADMIN_PORT: String(pub),
      CW_ADMIN_LOCAL_PORT: String(loop) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 100; i++) {
    if ((await raw('/api/csrf', loop)).status === 200) return { proc, pub, loop };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill('SIGKILL');
  throw new Error('the panel did not come up on the operator port');
}

before(async () => {
  assert.ok(existsSync(SERVE), `no server at ${SERVE}`);
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'probe', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'probe', label: 'Probe', out: 'probe', primary: true }],
  }));
  ({ proc: child, pub: port, loop: localPort } = await boot());
});
after(() => {
  child?.kill('SIGKILL');
  if (probeMine) rmSync(PROBE, { force: true });
  rmSync(TMP, { recursive: true, force: true });
});

test('the extraction found something — this file must never pass vacuously', () => {
  assert.ok(DECLARED.length >= 3, `STATIC_JS_MODULES parsed ${DECLARED.length} entries`);
  assert.ok(REFERENCED.length >= 3, `index.html parsed ${REFERENCED.length} /static/*.js script tags`);
  assert.match(SRC, /const STATIC_JS = new Set\(STATIC_JS_MODULES\.map/,
    'STATIC_JS is not derived from STATIC_JS_MODULES — two lists again, which is the defect this file exists to stop');
  assert.match(SRC, /STATIC_JS\.has\(pathname\)/, 'no route matches the declared module set');
});

test('every declared module is served: 200, text/javascript, a non-empty body that is the file', async () => {
  for (const name of DECLARED) {
    const r = await raw(`/static/${name}`);
    assert.equal(r.status, 200, `/static/${name} answered ${r.status}`);
    assert.match(r.head, /content-type: text\/javascript/i, `/static/${name} was not sent as JavaScript`);
    assert.match(r.head, /cache-control: no-cache/i, `/static/${name} does not require revalidation — an edited view module could keep serving the old copy`);
    assert.ok(r.body.length > 0, `/static/${name} answered 200 with an EMPTY body — a missing module that reads as a present one`);
    // Bytes, not length: a truncated module and a mis-decoded one both keep the byte count plausible.
    const disk = readFileSync(join(SERVE_DIR, 'static', name)).toString('latin1');
    assert.equal(r.body, disk,
      `/static/${name} was not served as it is on disk (${r.body.length} bytes sent, ${disk.length} on disk)`);
  }
});

test('THE ALLOWLIST IS AN ALLOWLIST: an undeclared .js that EXISTS on disk is not served', async () => {
  // The one assertion here that a directory handler fails and an exact-match route passes. Written
  // to the directory the RUNNING server reads, since sendAsset reads per request — no restart.
  assert.ok(!existsSync(PROBE), `${PROBE} already exists — refusing to clobber it`);
  writeFileSync(PROBE, PROBE_BODY);
  probeMine = true;
  try {
    assert.ok(!DECLARED.includes('__undeclared-probe.js'), 'the probe must not be declared');
    const r = await raw('/static/__undeclared-probe.js');
    assert.equal(r.status, 404,
      `an undeclared file on disk answered ${r.status} — the route is serving the DIRECTORY, so what the panel publishes is decided by whoever drops a file in admin/static/`);
    assert.ok(!r.text.includes('__UNDECLARED_PROBE__'), 'the undeclared file was served');
  } finally {
    rmSync(PROBE, { force: true });
    probeMine = false;
  }
  // and the declared modules still work with it gone — the probe changed nothing
  assert.equal((await raw(`/static/${DECLARED[0]}`)).status, 200);
});

test('traversal 404s and never reads outside admin/static/', async () => {
  const attempts = [
    '/static/../serve.mjs',
    '/static/..%2Fserve.mjs',
    '/static/%2e%2e/serve.mjs',
    '/static/..%252Fserve.mjs',
    '/static/....//serve.mjs',
    '/static/..\\serve.mjs',
    '/static/comments.js/../../serve.mjs',
    '/static/./comments.js',
    `/static/${DECLARED[0]}%00.mjs`,
    '/static/%00../serve.mjs',
    '/static/../../admin/serve.mjs',
    '/static/fonts/../../serve.mjs',
  ];
  for (const path of attempts) {
    const r = await raw(path);
    // 404, not merely "not 200": a reset socket reports status 0 and would satisfy a not-200 check
    // while proving nothing about what the route did with the path.
    assert.equal(r.status, 404, `${path} answered ${r.status}`);
    assert.deepEqual(leaks(r.text), [], `${path} returned serve.mjs content`);
  }
});

test('a NUL byte in the request line is refused, and does not take the server with it', async () => {
  // A literal NUL, not %00 — the encoded form is covered above and never decoded, while this one
  // is the byte C string handling truncates on. http.request() would reject it client-side.
  const NUL = String.fromCharCode(0);
  const r = await raw(`/static/${DECLARED[0]}${NUL}.mjs`);
  assert.notEqual(r.status, 200, 'a NUL-terminated path was served');
  assert.deepEqual(leaks(r.text), [], 'a NUL-terminated path returned serve.mjs content');
  // The transport still works afterwards — otherwise every assertion above passes on a dead socket.
  assert.equal((await raw(`/static/${DECLARED[0]}`)).status, 200,
    'the server stopped answering after a NUL byte');
});

test('NEGATIVE CONTROL: the leak predicate fires on the real serve.mjs and not on what is served', async () => {
  // Every traversal assertion above is `leaks(...) === []`, which an empty response satisfies. The
  // sentinels have to be strings that ARE in the file, or the whole test is a shape.
  const real = serverSource();
  assert.deepEqual(leaks(real).sort(), [...SENTINELS].sort(),
    `these sentinels are no longer in admin/serve.mjs: ${SENTINELS.filter((s) => !real.includes(s)).join(', ')} — the traversal test cannot detect the leak it claims to`);
  // ...and a served module trips none of them, so a clean traversal result is a real negative.
  const ok = await raw(`/static/${DECLARED[0]}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(leaks(ok.text), [], 'a sentinel appears in a module the server legitimately sends — pick another');
});

test('THE ALLOWLIST IS CLOSED over what index.html actually requests', async () => {
  // The test that stops an extraction shipping a module the server will not serve: the tag lands in
  // index.html, the route is never added, and the browser logs a 404 nobody is watching while the
  // tab it powers silently does nothing.
  for (const url of REFERENCED) {
    const name = url.slice('/static/'.length);
    assert.ok(DECLARED.includes(name),
      `index.html loads ${url} and STATIC_JS_MODULES does not declare it — the server 404s it and the view it powers is dead`);
    assert.ok(existsSync(join(SERVE_DIR, 'static', name)), `${url} is referenced and declared but not on disk`);
    assert.equal((await raw(url)).status, 200, `${url} is declared and does not serve`);
  }
  // The mirror direction: a declared module nothing loads is a route with no caller, and it stops
  // the list being evidence of what the panel uses. index.html may reach it by any means, so the
  // whole document is searched rather than the script tags alone.
  const orphans = DECLARED.filter((n) => !HTML.includes(n));
  assert.deepEqual(orphans, [], `STATIC_JS_MODULES declares modules index.html never loads: ${orphans.join(', ')}`);
});

test('the joined path is the DECLARED name, never a slice of the request', async () => {
  const at = SRC.indexOf('STATIC_JS.has(pathname)');
  assert.ok(at > -1, 'the static-js route is gone');
  const route = SRC.slice(at, at + 400);
  assert.ok(!/pathname\.(slice|replace|split|substring|normalize)/.test(route),
    'the static-js route derives its filesystem path from the request — membership is checked against the declared set, but the bytes joined are the arriving ones');
  assert.ok(!/decodeURI/.test(route), 'the static-js route decodes the request path');
  assert.match(route, /join\(HERE, 'static', name\)/, 'the route does not join a declared literal');
});

test('the served set is DECLARED, not read off the disk AT BOOT', async () => {
  // The undeclared-file test above cannot see this one: its probe is created after the server
  // started, so a boot-time directory read passes it. Falsifying that design needs a server that
  // booted WITH the file already there — the published set would then be whoever dropped a file in
  // the folder, one restart later instead of one request later. The source check is the marker; the
  // second instance is the effect.
  assert.ok(!/readdirSync\(join\(HERE, 'static'/.test(SRC),
    'serve.mjs enumerates admin/static/ — the allowlist would be a directory listing with a restart in front of it');
  assert.ok(!existsSync(PROBE), `${PROBE} already exists — refusing to clobber it`);
  writeFileSync(PROBE, PROBE_BODY);
  probeMine = true;
  const second = await boot();
  try {
    assert.equal((await raw(`/static/${DECLARED[0]}`, second.loop)).status, 200,
      'the second instance is not serving — a 404 from it would prove nothing');
    const r = await raw('/static/__undeclared-probe.js', second.loop);
    assert.equal(r.status, 404,
      `a panel that BOOTED with an undeclared .js in admin/static/ answered ${r.status} for it — the allowlist is a directory listing taken at startup`);
    assert.ok(!r.text.includes('__UNDECLARED_PROBE__'), 'the undeclared file was served by the second instance');
  } finally {
    second.proc.kill('SIGKILL');
    rmSync(PROBE, { force: true });
    probeMine = false;
  }
});

test('view modules stay BEHIND the session gate on the published port', async () => {
  // They are not in PUBLIC_ASSETS and must not become public by being consolidated. The published
  // port is the one a tunnel routes; a module reachable there is reachable from the internet.
  // Keyed on the declared modules, not on any .js: /static/theme-switch.js is public on purpose, for
  // the sign-in page, and is served by its own route rather than through STATIC_JS_MODULES.
  const pub = SRC.slice(SRC.indexOf('const PUBLIC_ASSETS'), SRC.indexOf('const UNRESOLVED'));
  const exposed = DECLARED.filter((n) => pub.includes(`'/static/${n}'`));
  assert.deepEqual(exposed, [], `view modules were added to PUBLIC_ASSETS — readable without a session: ${exposed.join(', ')}`);
  const r = await raw(`/static/${DECLARED[0]}`, port);
  assert.ok([401, 403, 503].includes(r.status),
    `/static/${DECLARED[0]} answered ${r.status} on the published port — it should require a session`);
  const head = readFileSync(join(SERVE_DIR, 'static', DECLARED[0])).toString('latin1').slice(0, 60);
  assert.ok(!r.text.includes(head), 'the module body was sent to an unauthenticated caller');
});
