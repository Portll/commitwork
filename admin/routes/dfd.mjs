// admin/routes/dfd.mjs — the data flow diagram behind the panel login.
//
// GET /dfd/       the page (renderHtml), sent under the page's own hash-pinned CSP
// GET /api/dfd    the filtered dfd@1 document as JSON
//
// Source, read at call time: the dfd@1 file CW_DFD_FILE names, else the flow store's graph
// (<CW_HARNESS_STORE>/flow.json) through the adapter. The query mirrors the command's flags —
// prefix, focus, hops, direction, collapse, collapse-all-groups-over, orientation, max, tests,
// imports — and goes through the command's own parser and loader (flow/dfd-cli.mjs), so the page
// and `node flow/dfd-cli.mjs` read, filter and refuse alike. collapse and orientation shape the
// drawing only; /api/dfd returns the document before either.
//
// `repo=<name>` draws a scanned repository instead: the static pass over the checkout the panel's
// own fleet resolver (admin/lib/core.mjs resolvedRepos, the sweep's resolver) names `name`. Only a
// name is taken — never a path from the query: a value that is not a registry name (letters,
// digits, `.`, `_`, `-`, not `.` or `..`) is refused 400 before any lookup, and a name the
// registry does not know is refused 400 with the reason. The pass runs in a child (`node
// --experimental-vm-modules flow/dfd-cli.mjs --repo <registered path> --emit model`): the panel
// has no vm modules, and the child reads the target's sources without running them. The model it
// returns is filtered and collapsed here, through the same prepare() as every other source.
//
// Dispatched below the login gate (admin/serve.mjs MODULAR_ROUTES), so every route here already
// has a session.

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, prepare, EXIT, DEFAULT_MAX } from '../../flow/dfd-cli.mjs';
import { renderHtml } from '../../lib/dfd-render.mjs';
import { MARK_ICON } from '../../lib/brand-tokens.mjs';
import { esc } from '../../lib/html-escape.mjs';
import { resolvedRepos } from '../lib/core.mjs';

const CLI = fileURLToPath(new URL('../../flow/dfd-cli.mjs', import.meta.url));
export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
export const PASS_TIMEOUT_MS = 180_000;

const FILTER_PARAMS = ['prefix', 'focus', 'hops', 'direction'];
const DRAWING_PARAMS = ['collapse', 'collapse-all-groups-over', 'orientation', 'max'];
const BOOL_PARAMS = ['tests', 'imports'];
const STATUS = { [EXIT.USAGE]: 400, [EXIT.INVALID]: 422, [EXIT.INPUT]: 404, [EXIT.SIZE]: 422 };

/**
 * `repo=<name>` -> { path } of the registered checkout, or { error } (always a 400). The name is a
 * key into the registry and nothing else: it is never joined to a directory.
 */
export function registeredRepo(name, repos = resolvedRepos) {
  if (!REPO_NAME_RE.test(name) || name === '.' || name === '..') {
    return { error: `repo must name a repository the panel knows (letters, digits, . _ -), not a path: ${JSON.stringify(name.slice(0, 80))}` };
  }
  const list = repos() || [];
  const hit = list.find((r) => r && r.name === name && typeof r.path === 'string' && r.path);
  if (!hit) return { error: `unknown repository ${name}: the panel's registry names ${list.length} repositor${list.length === 1 ? 'y' : 'ies'}, and not this one` };
  return { path: hit.path };
}

/** Run the static pass on a registered checkout in a child -> { model } or { status, error }. */
export function passInChild(path, { env = process.env, timeoutMs = PASS_TIMEOUT_MS, tests = false, imports = false, exec = execFile } = {}) {
  const argv = ['--experimental-vm-modules', '--no-warnings', CLI, '--repo', path, '--emit', 'model', ...(tests ? ['--tests'] : []), ...(imports ? ['--imports'] : [])];
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return new Promise((resolveP) => {
    exec(process.execPath, argv, { env: childEnv, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const code = typeof err.code === 'number' ? err.code : null;
        const why = String(stderr || err.message).trim().replace(/^dfd: /, '').split('\n')[0];
        return resolveP({ status: code === EXIT.INPUT ? 404 : 500, error: `the static pass over the repository failed${code === null ? ` (${err.signal || err.code})` : ''}: ${why}` });
      }
      try { resolveP({ model: JSON.parse(stdout) }); } catch (e) { resolveP({ status: 500, error: `the static pass returned no readable model: ${e.message}` }); }
    });
  });
}

/** The request's query -> the command's argv, its source fixed by the environment. */
export function argvFor(url, env = process.env, { drawing = true } = {}) {
  const q = new URL(url, 'http://panel.invalid').searchParams;
  const argv = env.CW_DFD_FILE ? ['--from', env.CW_DFD_FILE] : ['--graph'];
  for (const k of [...FILTER_PARAMS, ...(drawing ? DRAWING_PARAMS : [])]) if (q.has(k)) argv.push(`--${k}`, q.get(k));
  for (const k of BOOL_PARAMS) if (q.get(k) === '1' || q.get(k) === 'true') argv.push(`--${k}`);
  return argv;
}

/**
 * -> { status, opts, model, collapse, drawn } or { status, error }. `drawing: false` ignores the
 * drawing keys. With `repo=` in the query the answer is a Promise (the pass runs in a child);
 * without it, as before, synchronous. `repos` and `pass` are the registry and the child, for tests.
 */
export function load(url, env = process.env, { drawing = true, repos = resolvedRepos, pass = passInChild } = {}) {
  // a value flag always takes the next argument as its value, so a query value cannot become a flag
  const { opts, error } = parseArgs(argvFor(url, env, { drawing }));
  if (error) return { status: 400, error };
  const q = new URL(url, 'http://panel.invalid').searchParams;
  if (q.has('repo')) {
    const reg = registeredRepo(q.get('repo'), repos);
    if (reg.error) return { status: 400, error: reg.error };
    return pass(reg.path, { env, tests: !!opts.tests, imports: !!opts.imports }).then((built) => {
      if (built.error) return { status: built.status, error: built.error };
      const got = prepare(opts, { env, source: built.model });
      if (got.error) return { status: STATUS[got.code], error: got.error };
      return { status: 200, opts, ...got };
    });
  }
  const got = prepare(opts, { env });
  if (got.error) return { status: STATUS[got.code], error: got.error };
  return { status: 200, opts, ...got };
}

const errorPage = (status, msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8">${MARK_ICON}<title>data flow diagram unavailable</title></head>`
  + `<body><h1>data flow diagram unavailable</h1><p>${esc(msg)}</p><p>Status ${status}.</p></body></html>`;

/** Answer now, or when the pass does: `then` only when `load` returned a Promise. */
const settle = (got, answer) => (typeof got?.then === 'function' ? got.then(answer) : answer(got));

function page(ctx) {
  return settle(load(ctx.req.url), (got) => answerPage(ctx, got));
}

function answerPage(ctx, got) {
  const max = got.opts?.max ?? DEFAULT_MAX;
  if (got.status === 200 && got.drawn > max) {
    got.status = 422;
    got.error = `${got.drawn} elements is more than max ${max}: narrow it with prefix or focus, collapse groups, or raise max`;
  }
  if (got.status !== 200) return ctx.send(got.status, errorPage(got.status, got.error), 'text/html; charset=utf-8', { 'cache-control': 'no-store' });
  const { html, csp } = renderHtml(got.model, { fonts: 'served', collapse: got.collapse, orientation: got.opts.orientation || 'auto' });
  return ctx.send(200, html, 'text/html; charset=utf-8', {
    'content-security-policy': csp,
    'content-security-policy-report-only': csp,
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  });
}

function api(ctx) {
  return settle(load(ctx.req.url, process.env, { drawing: false }), (got) => answerApi(ctx, got));
}

function answerApi(ctx, got) {
  if (got.status !== 200) return ctx.send(got.status, { ok: false, error: got.error });
  return ctx.send(200, got.model, 'application/json', { 'cache-control': 'no-store' });
}

export const routes = [
  { method: 'GET', path: '/dfd/', handle: page },
  { method: 'GET', path: '/dfd', handle: page },
  { method: 'GET', path: '/api/dfd', handle: api },
];
