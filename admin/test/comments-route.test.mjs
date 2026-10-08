// fact: every test plants the failure it names / a route tested only on the happy path passes when it stops refusing (expiry: never, prev: unknown)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routes, collect, acceptOne, sweep, readHistory } from '../routes/comments.mjs';
import { suggestFile, applyTo } from '../../bin/comment-suggest.mjs';
import { MAX_RUN } from '../../bin/comment-schema.mjs';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');

const LONG = (tag) => Array.from({ length: MAX_RUN + 4 },
  (_, i) => `// ${tag} narrative line ${i}, because the reason matters here`).join('\n');

function repo(files) {
  const d = mkdtempSync(join(tmpdir(), 'cw-slop-'));
  execFileSync('git', ['-C', d, 'init', '-q']);
  for (const [name, body] of Object.entries(files)) {
    const p = join(d, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  execFileSync('git', ['-C', d, 'add', '-A']);
  return d;
}
const withRoot = (d, fn) => {
  const prev = process.env.CW_COMMENT_ROOT;
  process.env.CW_COMMENT_ROOT = d;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.CW_COMMENT_ROOT; else process.env.CW_COMMENT_ROOT = prev;
  }
};

// ---- registration: the four places a view must appear

// fact: the client set is read from NATIVE, the router's own map, not from a list kept here / the first version of this test asserted five sites I knew about, passed, and the repo's own gate failed on the sixth — a guard written from its author's list certifies its author's blind spot (expiry: if the router stops using NATIVE, prev: broken)
test('the view is registered everywhere the panel derives a view set from', () => {
  const serve = serverSource();
  const html = panelSource('index.html');

  const panelViews = serve.match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(panelViews, 'serve.mjs no longer declares PANEL_VIEWS — update this extractor with it');
  assert.ok(panelViews[1].includes("'comments'"), 'comments must be in PANEL_VIEWS');

  const native = html.match(/const NATIVE=\{([^}]*)\}/);
  assert.ok(native, 'index.html no longer declares const NATIVE={...} — update this extractor with the router');
  assert.ok(/(^|,)comments:/.test(native[1]),
    'comments must be in NATIVE — TAB_GROUPS without it is a dangling reference and the repo gate refuses it');

  assert.match(serve, /commentRoutes/, 'the route module must be imported and spread');
  assert.match(html, /comments:'quality'/, 'TAB_GROUPS must file it under quality');
  assert.match(html, /data-v="comments"/, 'a nav tab must exist');
  assert.match(html, /id="view-comments"/, 'a view section must exist');
  assert.match(html, /if\(v==='comments'\)loadComments\(\);/, 'the loader must be dispatched');
});

test('the route module exposes exactly the three endpoints', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`),
    ['GET /api/comments', 'POST /api/comments/accept', 'POST /api/comments/sweep']);
});

// ---- collect

test('collect finds a long block and reports what it would save', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const r = withRoot(d, collect);
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.items[0].file, 'a.mjs');
  assert.ok(r.items[0].saved > 0);
  assert.ok(r.items[0].diff.includes('--- a/a.mjs'));
});

test('a block within the limit produces no suggestion', () => {
  const short = Array.from({ length: MAX_RUN }, (_, i) => `// line ${i}`).join('\n');
  const d = repo({ 'a.mjs': `${short}\nconst x = 1;\n` });
  assert.equal(withRoot(d, collect).total, 0);
});

test('a reference block is CLASSIFIED, not hidden', () => {
  const ref = ['// usage: thing [--flag]', '// exit: 0 ok', '// env: CW_X', '// options:',
    '// returns: nothing', '// output: a file', '// artifacts: none'].join('\n');
  const d = repo({ 'a.mjs': `${ref}\nconst x = 1;\n` });
  const r = withRoot(d, collect);
  assert.equal(r.total, 1, 'still listed');
  assert.equal(r.items[0].kind, 'reference', 'and labelled so the operator can skip it');
});

// ---- accept

test('accepting applies exactly the block named, and nothing else', () => {
  const d = repo({ 'a.mjs': `${LONG('first')}\n\nconst x = 1;\n\n${LONG('second')}\nconst y = 2;\n` });
  const before = withRoot(d, collect);
  assert.equal(before.total, 2);

  const target = before.items.find((i) => i.ordinal === 1);
  const res = withRoot(d, () => acceptOne(target.id, '// fact: kept / consequence (expiry: never, prev: unknown)'));
  assert.equal(res.ok, true, res.error);

  const after = readFileSync(join(d, 'a.mjs'), 'utf8');
  assert.match(after, /fact: kept/, 'the accepted block was replaced');
  assert.match(after, /first narrative line 0/, 'the block NOT selected is untouched');
  assert.match(after, /const x = 1;/);
  assert.match(after, /const y = 2;/);
});

test('THE STALE REFUSAL: a block that moved under the suggestion is refused, not applied by position', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const sug = suggestFile('a.mjs', readFileSync(join(d, 'a.mjs'), 'utf8'))[0];
  const moved = `// an unrelated line someone else added\n${LONG('a')}\nconst x = 1;\n`;
  const r = applyTo(moved, sug, '// fact: x / y (expiry: never, prev: unknown)');
  assert.equal(r.ok, false);
  assert.match(r.error, /not the one this suggestion was drafted from/);
});

test('an id whose path escapes the repo is refused', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const r = withRoot(d, () => acceptOne('../../../etc/passwd#0', '// x'));
  assert.equal(r.ok, false);
  assert.match(r.error, /escapes the repository/);
});

test('an unknown block ordinal is refused rather than silently doing nothing', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const r = withRoot(d, () => acceptOne('a.mjs#99', '// x'));
  assert.equal(r.ok, false);
  assert.match(r.error, /no such block/);
});

test('AN EDIT THAT BREAKS THE FILE IS ROLLED BACK, and says so', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const original = readFileSync(join(d, 'a.mjs'), 'utf8');
  const r = withRoot(d, () => acceptOne('a.mjs#0', '/* unterminated block comment'));
  assert.equal(r.ok, false);
  assert.match(r.error, /stopped the file parsing/);
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), original, 'the file must be byte-identical after a rollback');
});

test('accepting a subset of many applies exactly that subset', () => {
  const d = repo({
    'a.mjs': `${LONG('a')}\nconst a = 1;\n`,
    'b.mjs': `${LONG('b')}\nconst b = 2;\n`,
    'c.mjs': `${LONG('c')}\nconst c = 3;\n`,
  });
  const items = withRoot(d, collect).items;
  assert.equal(items.length, 3);
  const pick = items.filter((i) => i.file !== 'b.mjs');
  const results = withRoot(d, () => pick.map((i) => acceptOne(i.id, `// fact: ${i.file} done / x (expiry: never, prev: unknown)`)));
  assert.equal(results.filter((r) => r.ok).length, 2);

  assert.match(readFileSync(join(d, 'a.mjs'), 'utf8'), /fact: a\.mjs done/);
  assert.match(readFileSync(join(d, 'c.mjs'), 'utf8'), /fact: c\.mjs done/);
  assert.match(readFileSync(join(d, 'b.mjs'), 'utf8'), /b narrative line 0/, 'the unselected file must be untouched');
  assert.equal(withRoot(d, collect).total, 1, 'only b.mjs still has a long block');
});

// ---- the void: a block a heuristic cannot fix must say so, never gut it

test('a VOID block (no counterfactual) is listed with no draft and refuses an empty accept', () => {
  const prose = Array.from({ length: MAX_RUN + 2 },
    (_, i) => `// the panel stores entry ${i} beside its label and its index`).join('\n');
  const d = repo({ 'a.mjs': `${prose}\nconst x = 1;\n` });
  const items = withRoot(d, collect).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].void, true, 'no counterfactual ⇒ no machine draft');
  assert.equal(items[0].saved, 0, 'a void must not report lines saved');
  assert.deepEqual(items[0].after, [], 'no <placeholder> line');

  const original = readFileSync(join(d, 'a.mjs'), 'utf8');
  const r = withRoot(d, () => acceptOne(items[0].id));
  assert.equal(r.ok, false);
  assert.match(r.error, /no machine draft/);
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), original, 'a refused accept must not touch the file');
});

test('accept refuses a replacement that is not schema-clean — a draft still carrying expiry: TODO', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const id = withRoot(d, collect).items[0].id;
  const original = readFileSync(join(d, 'a.mjs'), 'utf8');
  const r = withRoot(d, () => acceptOne(id, '// fact: something / else (expiry: TODO, prev: unknown)'));
  assert.equal(r.ok, false);
  assert.match(r.error, /schema-clean|unresolved expiry/);
  assert.equal(readFileSync(join(d, 'a.mjs'), 'utf8'), original, 'a refused accept must not touch the file');
});

// ---- sweep: the durable, dated re-runner

const withEnv = (vars, fn) => {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
};

test('sweep records a durable dated line, returns the list + summary + history, and appends (never overwrites)', () => {
  const d = repo({
    'a.mjs': `${LONG('a')}\nconst x = 1;\n`,
    'b.mjs': `${Array.from({ length: MAX_RUN + 2 }, (_, i) => `// the store holds row ${i} beside its label and its index`).join('\n')}\nconst y = 1;\n`,
  });
  const log = join(mkdtempSync(join(tmpdir(), 'cw-sloplog-')), 'sweeps.jsonl');
  withEnv({ CW_COMMENT_ROOT: d, CW_NOW: '2026-01-02T03:04:05Z', CW_SLOP_SWEEP_LOG: log }, () => {
    const j = sweep();
    assert.equal(j.summary.at, '2026-01-02T03:04:05Z', 'the record honours CW_NOW');
    assert.ok(j.summary.blocks >= 2);
    assert.ok(j.summary.voids >= 1, 'the no-counterfactual block is a void in the summary');
    assert.ok(Array.isArray(j.items), 'the response carries the list too, so the panel needs no second fetch');
    assert.equal(j.history.length, 1, 'one sweep, one record');

    const j2 = sweep();
    assert.equal(j2.history.length, 2, 'a second sweep appends rather than overwriting the trend');
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2, 'one JSONL line per sweep');
    assert.equal(JSON.parse(lines[0]).at, '2026-01-02T03:04:05Z');
  });
});

test('sweep history fails closed on an unreadable ledger — never reports "no history"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sloplog-')); // a directory where a file is expected → EISDIR, not ENOENT
  withEnv({ CW_SLOP_SWEEP_LOG: dir }, () => {
    assert.throws(() => readHistory(), /unreadable/);
  });
});

test('an absent ledger is legitimately empty — ENOENT alone reads as no sweep yet', () => {
  const log = join(mkdtempSync(join(tmpdir(), 'cw-sloplog-')), 'never-written.jsonl');
  withEnv({ CW_SLOP_SWEEP_LOG: log }, () => {
    assert.deepEqual(readHistory(), []);
  });
});

// ---- projects: one bucket, two roots

// fact: the spine view is registered in the same places the commitwork one is / a tab whose id is missing from NATIVE or TAB_GROUPS is a dangling reference the repo gate refuses (expiry: never, prev: not built)
test('the spine view is registered everywhere the commitwork view is', () => {
  const serve = serverSource();
  const html = panelSource('index.html');
  const panelViews = serve.match(/const PANEL_VIEWS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(panelViews[1].includes("'spinecomments'"), 'spinecomments must be in PANEL_VIEWS');
  const native = html.match(/const NATIVE=\{([^}]*)\}/);
  assert.ok(/(^|,)spinecomments:'view-comments'/.test(native[1]), 'spinecomments must map onto the same section');
  assert.match(html, /spinecomments:'quality'/, 'TAB_GROUPS must file it under quality');
  assert.match(html, /data-v="spinecomments"/, 'a nav tab must exist');
  assert.match(html, /if\(v==='spinecomments'\)loadComments\('spine'\);/, 'the loader must be dispatched with the project');
});

// fact: a project names a root from a closed map / a root taken from the query is an arbitrary-directory read (expiry: never, prev: not built)
test('an unknown project falls back to commitwork instead of reading elsewhere', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const r = withRoot(d, () => collect('../../etc'));
  assert.equal(r.project, 'commitwork');
  assert.equal(r.items[0].file, 'a.mjs');
});

// fact: the spine root is scanned as itself and reports its own name / a result that did not say which repository it came from would be accepted into the other one (expiry: never, prev: not built)
test('the spine project scans its own root and says so', () => {
  const d = repo({ 'b.mjs': `${LONG('b')}\nconst y = 2;\n` });
  const prev = process.env.CW_SLOP_SPINE_ROOT;
  process.env.CW_SLOP_SPINE_ROOT = d;
  try {
    const r = collect('spine');
    assert.equal(r.project, 'spine');
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].file, 'b.mjs');
  } finally {
    if (prev === undefined) delete process.env.CW_SLOP_SPINE_ROOT; else process.env.CW_SLOP_SPINE_ROOT = prev;
  }
});

// fact: each project keeps its own sweep ledger, and the test writes only to temp ledgers / an unisolated run appended fixture sweeps to the live spine ledger (expiry: never, prev: broken)
test('a spine sweep writes its own ledger, not the commitwork one', () => {
  const d = repo({ 'c.mjs': `${LONG('c')}\nconst z = 3;\n` });
  const dir = mkdtempSync(join(tmpdir(), 'cw-slop-log-'));
  const log = join(dir, 'slop-sweeps.jsonl');
  const spineLog = join(dir, 'slop-sweeps-spine.jsonl');
  const keys = ['CW_SLOP_SPINE_ROOT', 'CW_SLOP_SWEEP_LOG', 'CW_SLOP_SPINE_SWEEP_LOG'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.CW_SLOP_SPINE_ROOT = d;
  process.env.CW_SLOP_SWEEP_LOG = log;
  process.env.CW_SLOP_SPINE_SWEEP_LOG = spineLog;
  try {
    const r = sweep('spine');
    assert.equal(r.project, 'spine');
    assert.equal(readFileSync(spineLog, 'utf8').trim().split('\n').length, 1, 'the spine ledger gains exactly one line');
    assert.throws(() => readFileSync(log, 'utf8'), /ENOENT/, 'the commitwork ledger must be untouched');
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});

test('accept writes a replacement with no trailer — a comment needs no expiry', () => {
  const d = repo({ 'a.mjs': `${LONG('a')}\nconst x = 1;\n` });
  const id = withRoot(d, collect).items[0].id;
  const r = withRoot(d, () => acceptOne(id, '// fact: something / else'));
  assert.equal(r.ok, true, r.error);
  assert.match(readFileSync(join(d, 'a.mjs'), 'utf8'), /^\/\/ fact: something \/ else\nconst x = 1;\n$/);
});
