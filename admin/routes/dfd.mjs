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
// Dispatched below the login gate (admin/serve.mjs MODULAR_ROUTES), so every route here already
// has a session.

import { parseArgs, prepare, EXIT, DEFAULT_MAX } from '../../flow/dfd-cli.mjs';
import { renderHtml } from '../../lib/dfd-render.mjs';
import { MARK_ICON } from '../../lib/brand-tokens.mjs';
import { esc } from '../../lib/html-escape.mjs';

const FILTER_PARAMS = ['prefix', 'focus', 'hops', 'direction'];
const DRAWING_PARAMS = ['collapse', 'collapse-all-groups-over', 'orientation', 'max'];
const BOOL_PARAMS = ['tests', 'imports'];
const STATUS = { [EXIT.USAGE]: 400, [EXIT.INVALID]: 422, [EXIT.INPUT]: 404, [EXIT.SIZE]: 422 };

/** The request's query -> the command's argv, its source fixed by the environment. */
export function argvFor(url, env = process.env, { drawing = true } = {}) {
  const q = new URL(url, 'http://panel.invalid').searchParams;
  const argv = env.CW_DFD_FILE ? ['--from', env.CW_DFD_FILE] : ['--graph'];
  for (const k of [...FILTER_PARAMS, ...(drawing ? DRAWING_PARAMS : [])]) if (q.has(k)) argv.push(`--${k}`, q.get(k));
  for (const k of BOOL_PARAMS) if (q.get(k) === '1' || q.get(k) === 'true') argv.push(`--${k}`);
  return argv;
}

/** -> { status, opts, model, collapse, drawn } or { status, error }. `drawing: false` ignores the drawing keys. */
export function load(url, env = process.env, { drawing = true } = {}) {
  // a value flag always takes the next argument as its value, so a query value cannot become a flag
  const { opts, error } = parseArgs(argvFor(url, env, { drawing }));
  if (error) return { status: 400, error };
  const got = prepare(opts, { env });
  if (got.error) return { status: STATUS[got.code], error: got.error };
  return { status: 200, opts, ...got };
}

const errorPage = (status, msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8">${MARK_ICON}<title>data flow diagram unavailable</title></head>`
  + `<body><h1>data flow diagram unavailable</h1><p>${esc(msg)}</p><p>Status ${status}.</p></body></html>`;

function page(ctx) {
  const got = load(ctx.req.url);
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
  const got = load(ctx.req.url, process.env, { drawing: false });
  if (got.status !== 200) return ctx.send(got.status, { ok: false, error: got.error });
  return ctx.send(200, got.model, 'application/json', { 'cache-control': 'no-store' });
}

export const routes = [
  { method: 'GET', path: '/dfd/', handle: page },
  { method: 'GET', path: '/dfd', handle: page },
  { method: 'GET', path: '/api/dfd', handle: api },
];
