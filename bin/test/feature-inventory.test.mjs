// bin/test/feature-inventory.test.mjs — the inventory's FLOOR.
//
// The extractor in bin/feature-inventory.mjs reads route tables, dispatches and descriptor lists
// LEXICALLY. Lexical extraction over this tree has already been right for months and still had no
// reason it HAD to be right (see CLAUDE.md on the import guard that reported a clean tree it had
// never read). So every surface this file can enumerate a SECOND way is enumerated that way, and the
// two directions are asserted apart: a FALSE NEGATIVE (a real entry point the extractor missed) is
// the direction that lies to a reader, and it gets its own assertion from the false positives.
//
// The second witnesses, each unable to share the regex's failure mode:
//   HTTP   — import every admin/routes/*.mjs and read the live `routes` array (templates resolved).
//   MCP    — spawn mcp/server.mjs and ask it `tools/list` over the real JSON-RPC transport.
//   CLI    — run `commitwork help` and read the usage block the tool prints about itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildInventory, inventoryRoot, nowISO } from '../feature-inventory.mjs';
import { fragmentReason } from '../feature-census.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const NODE = process.execPath;

const names = (inv, surface) => inv.features.filter((f) => f.surface === surface).map((f) => f.name).sort();
/** Both directions, named apart. `missed` is the one that would flatter the census. */
function compare(witness, extracted) {
  const w = new Set(witness), e = new Set(extracted);
  return {
    missed: [...w].filter((x) => !e.has(x)).sort(),   // false negatives
    invented: [...e].filter((x) => !w.has(x)).sort(), // false positives
  };
}

test('the inventory is deterministic under a pinned CW_NOW', () => {
  const a = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  const b = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'two builds of the same tree must be byte-identical');
});

test('no feature identity is keyed on a line number', () => {
  const inv = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  const keyed = inv.features.filter((f) => f.line && String(f.id).includes(`:${f.line}`) && f.pathKind !== undefined);
  // The one deliberate exception is an UNREAD anchor, which has no name to key on; it is reported
  // as undetermined, so it can never be mistaken for a feature that moved.
  for (const f of keyed) assert.equal(f.undetermined, true, `${f.id} keys its identity on a line number`);
  assert.ok(inv.features.length > 0, 'an empty inventory is a failure, not a clean tree');
});

test('CW_FI_ROOT and CW_NOW are read at CALL time, not at module load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-fi-'));
  try {
    const prevRoot = process.env.CW_FI_ROOT, prevNow = process.env.CW_NOW;
    process.env.CW_FI_ROOT = dir;
    process.env.CW_NOW = '1999-12-31T23:59:59Z';
    try {
      assert.equal(inventoryRoot(), resolve(dir), 'CW_FI_ROOT set after import must win');
      assert.equal(nowISO(), '1999-12-31T23:59:59Z', 'CW_NOW set after import must win');
    } finally {
      if (prevRoot === undefined) delete process.env.CW_FI_ROOT; else process.env.CW_FI_ROOT = prevRoot;
      if (prevNow === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prevNow;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing required input THROWS — it is never an empty inventory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-fi-empty-'));
  try {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    assert.throws(() => buildInventory({ root: dir, now: '2026-01-01T00:00:00Z' }),
      /required input is absent|has no main/,
      'a tree with no bin/commitwork.mjs must fail closed, not report zero features');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SECOND WITNESS, HTTP: the live routes arrays agree with the lexical extractor', async () => {
  const dir = join(ROOT, 'admin', 'routes');
  const live = [];
  const unenumerable = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs')).sort()) {
    let mod;
    try { mod = await import(pathToFileURL(join(dir, f)).href); }
    catch (e) { unenumerable.push(`${f}: ${e.message.split('\n')[0]}`); continue; }
    if (!Array.isArray(mod.routes)) continue; // auth.mjs exports a handler, not a table
    for (const r of mod.routes) {
      live.push(`${r.method} ${r.path instanceof RegExp ? String(r.path) : r.path}`);
    }
  }
  assert.deepEqual(unenumerable, [], 'a route module that will not import makes this witness blind');
  const inv = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  const { missed, invented } = compare(live, names(inv, 'http-route'));
  assert.deepEqual(missed, [], 'routes the live tables serve and the inventory does not list');
  assert.deepEqual(invented, [], 'routes the inventory lists and no live table serves');
  assert.ok(live.length > 100, `the witness itself must have found a surface (found ${live.length})`);
});

test('SECOND WITNESS, MCP: the server\'s own tools/list agrees with the extractor', () => {
  const req = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ].join('\n') + '\n';
  const r = spawnSync(NODE, [join(ROOT, 'mcp', 'server.mjs')], { input: req, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.error, undefined, `the MCP server could not be spawned: ${r.error && r.error.message}`);
  const reply = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.id === 2);
  assert.ok(reply && reply.result && Array.isArray(reply.result.tools),
    `tools/list returned no tool array (stderr: ${(r.stderr || '').slice(0, 300)})`);
  const live = reply.result.tools.map((t) => t.name);
  const inv = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  const { missed, invented } = compare(live, names(inv, 'mcp-tool'));
  assert.deepEqual(missed, [], 'tools the server advertises and the inventory does not list');
  assert.deepEqual(invented, [], 'tools the inventory lists and the server does not advertise');
  assert.ok(live.length > 0, 'the witness must have found tools');
});

test('SECOND WITNESS, CLI: the usage block agrees with the dispatch the extractor read', () => {
  const r = spawnSync(NODE, [join(ROOT, 'bin', 'commitwork.mjs'), 'help'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.error, undefined, `commitwork help could not run: ${r.error && r.error.message}`);
  const usage = r.stdout.slice(r.stdout.indexOf('usage'));
  const live = [...usage.matchAll(/^ {2}commitwork ([a-z][a-z-]*)/gm)].map((m) => m[1]);
  const inv = buildInventory({ root: ROOT, now: '2026-01-01T00:00:00Z' });
  const { missed, invented } = compare(live, names(inv, 'cli-command'));
  // A command in the dispatch and NOT in usage is undocumented, which is a finding about the CLI —
  // it is asserted here so the gap cannot appear silently, in either direction.
  assert.deepEqual(missed, [], 'commands the usage block documents and the dispatch does not implement');
  assert.deepEqual(invented, [], 'commands the dispatch implements and the usage block does not document');
  assert.ok(live.length > 3, `the witness must have read a usage block (found ${live.length})`);
});

// ── the http-route test probe ─────────────────────────────────────────────────────────────────────
// Tests name a route as `'GET /api/x'` as often as they name its bare path; the probe missed that
// shape and reported 7 tested routes as fragments. The negatives are asserted apart, because a probe
// widened to substrings or comments would flatter the census instead.
const FX_ROUTES = [
  ['GET', '/api/fx'], ['GET', '/api/fx-a'], ['POST', '/api/fx-b'], ['GET', '/api/fx-c'],
  ['GET', '/api/fx-d'], ['GET', '/api/fx-e'], ['GET', '/api/fx-f'], ['GET', '/api/fx-g'], ['PUT', '/api/fx-h'],
];
const FX_TESTS = {
  'single.test.mjs': "test('GET /api/fx-a', () => {});\n",
  'double.test.mjs': 'describe("POST /api/fx-b", () => {});\n',
  'template.test.mjs': 'test(`GET /api/fx-c`, () => {});\n',
  'object.test.mjs': "const r = { method: 'GET', path: '/api/fx-d' };\n",
  'find.test.mjs': "const r = routes.find((r) => r.path === '/api/fx-e');\n",
  'substring.test.mjs': "test('GET /api/fx-fy', () => {});\ntest('GET /api/fx-f/sub', () => {});\n",
  'comment.test.mjs': "// see 'GET /api/fx-g'\n/* \"GET /api/fx-g\" */\n/**\n * `GET /api/fx-g`\n */\nconst x = 1;\n",
  'method.test.mjs': "test('GET /api/fx-h', () => {});\n",
};

function routeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-fi-route-'));
  const put = (rel, s) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), s); };
  put('bin/commitwork.mjs', 'async function main() {}\n');
  put('admin/serve.mjs', "import { routes as fxRoutes } from './routes/fx.mjs';\nconst MODULAR_ROUTES = [...fxRoutes];\n");
  put('admin/routes/fx.mjs', `export const routes = [\n${FX_ROUTES
    .map(([m, p]) => `  { method: '${m}', path: '${p}', handle: () => {} },\n`).join('')}];\n`);
  put('admin/static/panel-router.js', 'const NATIVE={};\nconst VALID_VIEWS=new Set([]);\n');
  put('admin/menus/navigation.js', '');
  put('mcp/tools.mjs', '');
  put('mcp/server.mjs', '');
  put('monitor/install-agents.mjs', '');
  put('package.json', '{}');
  for (const [name, body] of Object.entries(FX_TESTS)) put(`admin/test/${name}`, body);
  try {
    const inv = buildInventory({ root: dir, now: '2026-01-01T00:00:00Z' });
    return new Map(inv.features.filter((f) => f.surface === 'http-route').map((f) => [f.name, f]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a route named with its method, in any quote, is tested by that file', () => {
  const r = routeFixture();
  assert.deepEqual(r.get('GET /api/fx-a').tests, ['admin/test/single.test.mjs']);
  assert.deepEqual(r.get('POST /api/fx-b').tests, ['admin/test/double.test.mjs']);
  assert.deepEqual(r.get('GET /api/fx-c').tests, ['admin/test/template.test.mjs']);
});

test('a route named as an object or found by its path is tested by that file', () => {
  const r = routeFixture();
  assert.deepEqual(r.get('GET /api/fx-d').tests, ['admin/test/object.test.mjs']);
  assert.deepEqual(r.get('GET /api/fx-e').tests, ['admin/test/find.test.mjs']);
});

test('a longer path, a sub-path, a comment or another method does NOT name the route', () => {
  const r = routeFixture();
  assert.deepEqual(r.get('GET /api/fx-f').tests, [], '/api/fx-fy and /api/fx-f/sub are other routes');
  assert.deepEqual(r.get('GET /api/fx-g').tests, [], 'a comment mentioning a route is not a test of it');
  assert.deepEqual(r.get('PUT /api/fx-h').tests, [], 'GET /api/fx-h does not name PUT /api/fx-h');
});

test('a fixture route no test names stays a fragment', () => {
  const f = routeFixture().get('GET /api/fx');
  assert.equal(f.coverageMeasured, true);
  assert.deepEqual(f.tests, []);
  assert.equal(fragmentReason(f), 'no test in the tree names it');
});

test('the output parses, carries its generator, and writes atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-fi-out-'));
  try {
    const out = join(dir, 'nested', 'features.json');
    const r = spawnSync(NODE, [join(ROOT, 'bin', 'feature-inventory.mjs'), '--out', out],
      { encoding: 'utf8', env: { ...process.env, CW_NOW: '2026-01-01T00:00:00Z' }, timeout: 120_000 });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    const inv = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(inv.generatedBy, 'bin/feature-inventory.mjs');
    assert.equal(inv.generatedAt, '2026-01-01T00:00:00Z');
    assert.deepEqual(readdirSync(join(dir, 'nested')), ['features.json'], 'no .tmp- file may survive the rename');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
