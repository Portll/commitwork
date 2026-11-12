// `commitwork dfd --repo` and `--codeql`: the static pass over ANOTHER repository's JS/TS sources,
// a scanned repository's CodeQL code flows, and the two merged. The repository is built per test in
// a temp dir (dfd-fixture-repo.mjs); nothing here reads a real project.
//
// vm.SourceTextModule needs --experimental-vm-modules. As in static.test.mjs, this file re-runs
// ITSELF in a child carrying the flag rather than skipping, and asserts the child's own count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const EXPECTED_TESTS = 29;

if (typeof vm.SourceTextModule !== 'function') {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=spec', SELF],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  test('the scanned-repository tests ran in a child carrying --experimental-vm-modules', () => {
    assert.notEqual(r.status, null, `the child could not START (${r.signal || r.error})`);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const pass = Number((/^ℹ pass (\d+)$/m.exec(out) || [])[1] ?? -1);
    const fail = Number((/^ℹ fail (\d+)$/m.exec(out) || [])[1] ?? -1);
    assert.ok(pass >= 0 && fail >= 0, `the child produced no test summary:\n${out.slice(-2000)}`);
    assert.equal(fail, 0, `child failures:\n${out.slice(-4000)}`);
    assert.ok(pass >= EXPECTED_TESTS, `the child ran ${pass} tests, expected at least ${EXPECTED_TESTS}`);
  });
} else {
  const { fixtureRepo } = await import('./dfd-fixture-repo.mjs');
  const S = await import('../static.mjs');
  const { parseModule, maskConsistent } = await import('../verify.mjs');
  const { analyseTriggers, LAUNCHD_GENERATOR } = await import('../triggers.mjs');
  const CLI = await import('../dfd-cli.mjs');
  const { validateDfd } = await import('../../lib/dfd.mjs');

  const io = () => {
    const out = [];
    const err = [];
    return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } };
  };
  const sarif = (results) => JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [] } }, invocations: [{ executionSuccessful: true }], results }] });
  const loc = (uri, line, text) => ({ location: { physicalLocation: { artifactLocation: { uri }, region: { startLine: line } }, message: { text } } });
  const traced = (rule, from, to) => ({ ruleId: rule, locations: [{ physicalLocation: { artifactLocation: { uri: to[0] } } }],
    codeFlows: [{ threadFlows: [{ locations: [loc(...from), loc('src/mid.ts', 3, 'x'), loc(...to)] }] }] });

  // ── languages and TypeScript ─────────────────────────────────────────────────────────────────

  test('every JS/TS extension is a source, and other languages are named, not read', () => {
    // arrange
    const paths = ['a.mjs', 'a.cjs', 'a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.py', 'a.go', 'a.md'];

    // act
    const got = paths.map((p) => [S.isSourcePath(p), S.languageOf(p)]);

    // assert
    assert.deepEqual(got, [
      [true, 'javascript'], [true, 'javascript'], [true, 'javascript'], [true, 'javascript'],
      [true, 'typescript'], [true, 'typescript'], [true, 'typescript'], [true, 'typescript'],
      [false, 'python'], [false, 'go'], [false, null],
    ]);
  });

  test('stripTypes keeps every offset: annotations become whitespace of the same length', () => {
    // arrange
    const src = 'const a: number = 1;\ninterface X { y: string }\nexport const f = (x: string): void => {};\n';

    // act
    const r = S.stripTypes(src, 'a.ts');

    // assert
    assert.equal(r.ok, true);
    assert.equal(r.code.length, src.length);
    assert.equal(r.code.split('\n').length, src.split('\n').length);
    assert.match(r.code, /^const a {9}= 1;/);
  });

  test('stripTypes refuses with a reason: no function, a transform-only feature, JSX, a syntax error, a length change', () => {
    // arrange
    const cases = [
      ['enum E { A }', 'a.ts', undefined],
      ['const C = () => <div/>;', 'a.tsx', undefined],
      ['const = ;', 'a.ts', undefined],
      ['let a = 1', 'a.ts', null],
      ['let a = 1', 'a.ts', () => 'let'],
    ];

    // act
    const got = cases.map(([src, p, strip]) => S.stripTypes(src, p, strip === undefined ? undefined : (strip || 'absent')));

    // assert
    assert.deepEqual(got.map((r) => [r.ok, r.state]), [
      [false, 'unsupported-language'], [false, 'unsupported-language'], [false, 'unparseable'],
      [false, 'unsupported-language'], [false, 'unparseable'],
    ]);
    assert.match(got[0].reason, /enum is not supported in strip-only mode/);
    assert.match(got[3].reason, /stripTypeScriptTypes is not available on Node/);
    assert.match(got[4].reason, /changed the length/);
  });

  test('stripTypes passes through every warning that is not its own', () => {
    // arrange
    const seen = [];
    const original = process.emitWarning;
    process.emitWarning = (w) => seen.push(String(w?.message ?? w));
    const strip = (code) => { process.emitWarning('stripTypeScriptTypes is experimental'); process.emitWarning('something else'); return code; };

    // act
    let r;
    try { r = S.stripTypes('let a = 1', 'a.ts', strip); } finally { process.emitWarning = original; }

    // assert
    assert.equal(r.ok, true);
    assert.deepEqual(seen, ['something else']);
  });

  // ── parse goals ──────────────────────────────────────────────────────────────────────────────

  test('a CommonJS body parses under the module wrapper, hashbang and top-level return included, and names no specifiers', async () => {
    // arrange
    const src = "#!/usr/bin/env node\nconst x = require('./x');\nreturn;\n";

    // act
    const asModule = await parseModule(src, 'a.cjs');
    const asScript = await parseModule(src, 'a.cjs', { goal: 'commonjs' });
    const bad = await parseModule('const = ;', 'b.cjs', { goal: 'commonjs' });

    // assert
    assert.equal(asModule.ok, false);
    assert.deepEqual(asScript, { ok: true, error: null, specifiers: [] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /SyntaxError/);
  });

  test('the mask witness parses under the same goal as the source', async () => {
    // arrange
    const src = "return require('./x');\n";
    const spans = [{ kind: 'string', start: 15, end: 20, innerStart: 16, innerEnd: 19, value: './x' }];

    // act
    const commonjs = await maskConsistent(src, spans, 'a.cjs', { goal: 'commonjs' });
    const module = await maskConsistent(src, spans, 'a.cjs');

    // assert
    assert.equal(commonjs.ok, true);
    assert.equal(module.ok, false);
  });

  test('analyseSource reads TypeScript through the strip, with the source\'s own line numbers', async () => {
    // arrange
    const src = "import { writeFileSync } from 'node:fs';\ntype T = { a: string };\nexport function w(t: T): void {\n  writeFileSync('out/x.json', JSON.stringify(t));\n}\n";

    // act
    const r = await S.analyseSource('src/w.ts', src);

    // assert
    assert.equal(r.state, 'analysed');
    assert.equal(r.lang, 'typescript');
    assert.equal(r.goal, undefined);
    assert.deepEqual(r.edges.map((e) => [e.kind, e.target, e.evidence]), [['writes', 'out/x.json', 'src/w.ts:4 writeFileSync']]);
  });

  test('analyseSource takes a .js file as a module first and as CommonJS when only that parses; require is an import there', async () => {
    // arrange
    const esm = "import { readFileSync } from 'node:fs';\nreadFileSync('a/b.json');\n";
    const cjs = "const fs = require('fs');\nconst h = require('./h');\nfs.readFileSync('a/c.json');\nreturn;\n";

    // act
    const m = await S.analyseSource('x.js', esm);
    const c = await S.analyseSource('y.js', cjs);

    // assert
    assert.equal(m.goal, undefined);
    assert.equal(c.goal, 'commonjs');
    assert.equal(c.lang, 'javascript');
    assert.deepEqual(c.edges.map((e) => [e.kind, e.target, e.evidence.split(' ')[1]]), [['reads', 'h.mjs', 'require'], ['reads', 'a/c.json', 'readFileSync']]);
  });

  test('analyseSource counts what it cannot read: JSX, a transform-only TypeScript feature, a syntax error', async () => {
    // arrange
    const files = [['v.jsx', 'export const C = () => <div/>;\n'], ['e.ts', 'enum E { A }\n'], ['b.js', 'const = ;\n']];

    // act
    const got = await Promise.all(files.map(([p, s]) => S.analyseSource(p, s)));

    // assert
    assert.deepEqual(got.map((r) => r.state), ['unsupported-language', 'unsupported-language', 'unparseable']);
    assert.match(got[0].reason, /^JSX: V8 parses no JSX/);
    assert.deepEqual(got.map((r) => r.edges.length), [0, 0, 0]);
  });

  test('resolveTracked maps TypeScript\'s ./x.js, an extensionless specifier and a directory index onto tracked files', () => {
    // arrange
    const tracked = new Set(['src/a.ts', 'src/lib/index.ts', 'src/c.mjs']);

    // act
    const got = ['src/a.js', 'src/lib.mjs', 'src/c.mjs', 'src/missing.mjs'].map((t) => S.resolveTracked(t, tracked));

    // assert
    assert.deepEqual(got, ['src/a.ts', 'src/lib/index.ts', 'src/c.mjs', 'src/missing.mjs']);
  });

  // ── the repository ───────────────────────────────────────────────────────────────────────────

  test('targetSources lists the tracked JS/TS files and counts other languages, vendored trees left out', () => {
    // arrange
    const { root } = fixtureRepo({ extra: { 'node_modules/dep/index.js': 'module.exports = 0;\n' } });

    // act
    const got = S.targetSources(root);

    // assert
    assert.deepEqual(got.sources.sort(), ['lib/helper.js', 'lib/job.js', 'lib/old.cjs', 'src/api.ts', 'src/broken.js', 'src/enum.ts', 'src/store.ts', 'src/view.tsx']);
    assert.deepEqual(got.unsupported, { python: 1 });
  });

  test('isSelf is true for this checkout only', () => {
    // arrange
    const { root } = fixtureRepo();

    // act
    const got = [S.isSelf(S.repoRoot()), S.isSelf(root), S.isSelf(join(root, 'no-such-dir'))];

    // assert
    assert.deepEqual(got, [true, false, false]);
  });

  test('analyseRepo over another repository: every file accounted for, flows found, nothing executed', async () => {
    // arrange
    const { root, marker } = fixtureRepo({ plantGenerator: true });
    const { sources, unsupported } = S.targetSources(root);

    // act
    const g = await S.analyseRepo({ root, files: sources, unsupported, env: { CW_NOW: '2026-11-12T00:00:00Z' } });

    // assert
    assert.equal(existsSync(marker), false, 'the target\'s launchd generator was imported');
    const s = g.summary;
    assert.equal(s.coverageAccountsForAll, true);
    assert.equal(s.self, false);
    assert.deepEqual(s.unanalysableByReason, { 'unsupported-language': 2, unparseable: 1 });
    assert.deepEqual(s.unsupportedLanguages, { python: 1 });
    assert.deepEqual(s.byLanguage, { typescript: 4, javascript: 5 });
    const edges = g.edges.map((e) => `${e.from} ${e.kind} ${e.to}`);
    for (const want of [
      'node:module:src/api.ts connects node:endpoint:https://api.example.com',
      'node:module:src/api.ts writes node:database:data/app.db',
      'node:module:src/store.ts writes node:artifact:out/rows.json',
      'node:module:src/api.ts reads node:module:src/store.ts',
      'node:module:lib/old.cjs reads node:module:lib/helper.js',
      'node:scheduler:timer:src/api.ts triggers node:module:src/api.ts',
      'node:scheduler:workflow:.github/workflows/nightly.yml#schedule triggers node:module:lib/job.js',
    ]) assert.ok(edges.includes(want), `missing ${want}`);
    assert.ok(s.sites.some((x) => x.startsWith(`${LAUNCHD_GENERATOR}:1 launchd: not read`)));
  });

  test('analyseRepo defaults to the target\'s own source list and counts an oversized file instead of reading it', async () => {
    // arrange
    const { root } = fixtureRepo({ extra: { 'dist/bundle.js': `// ${'x'.repeat(S.MAX_SOURCE_BYTES)}\n` } });

    // act
    const g = await S.analyseRepo({ root, env: {} });

    // assert
    const big = g.modules.find((m) => m.path === 'dist/bundle.js');
    assert.equal(big.state, 'too-large');
    assert.equal(g.summary.filesInput, 9);
    assert.deepEqual(g.summary.unsupportedLanguages, {});
  });

  test('analyseTriggers reads the launchd generator only for this checkout or an injected table', () => {
    // arrange
    const files = [LAUNCHD_GENERATOR];
    const opts = { root: '/nonexistent', files, workflows: [], crontabs: [] };

    // act
    const other = analyseTriggers(opts);
    const injected = analyseTriggers({ ...opts, launchd: { agents: [] } });

    // assert
    assert.equal(other.schedulers.length, 0);
    assert.equal(other.sites.length, 1);
    assert.match(other.sites[0].reason, /not commitwork's own checkout/);
    assert.deepEqual(injected.sites, []);
  });

  // ── the command ──────────────────────────────────────────────────────────────────────────────

  test('parseArgs takes --repo and --codeql as one source, together or apart, and refuses them beside another', () => {
    // arrange
    const cases = [['--repo', 'r'], ['--codeql', 'c'], ['--repo', 'r', '--codeql', 'c'], ['--repo', 'r', '--graph'], ['--codeql', 'c', '--from', 'f']];

    // act
    const got = cases.map((a) => CLI.parseArgs(a));

    // assert
    assert.deepEqual(got.slice(0, 3).map((g) => g.opts), [{ repo: 'r' }, { codeql: 'c' }, { repo: 'r', codeql: 'c' }]);
    for (const g of got.slice(3)) assert.match(g.error, /exactly one source/);
  });

  test('--repo emits a valid model whose source names what was not read', async () => {
    // arrange
    const { root } = fixtureRepo();
    const s = io();

    // act
    const code = await CLI.main(['--repo', root, '--emit', 'model'], { env: {}, ...s });

    // assert
    assert.equal(code, 0, s.err.join(''));
    const model = JSON.parse(s.out.join(''));
    assert.equal(validateDfd(model).ok, true);
    const u = model.source.unknown;
    assert.equal(u.files, 8);
    assert.equal(u.unanalysable, 3);
    assert.deepEqual(u.unsupportedLanguages, { python: 1 });
    assert.deepEqual(u.filesUnread.map((f) => f.split(':')[0]).sort(), ['src/broken.js', 'src/enum.ts', 'src/view.tsx']);
    assert.match(model.title, /^data flows of cw-dfd-scanned-/);
  });

  test('--repo --out draws the page with the unknown counts in its banner and its summary line', async () => {
    // arrange
    const { root } = fixtureRepo();
    const out = join(mkdtempSync(join(tmpdir(), 'cw-dfd-out-')), 'r.html');
    const s = io();

    // act
    const code = await CLI.main(['--repo', root, '--out', out], { env: {}, ...s });

    // assert
    assert.equal(code, 0, s.err.join(''));
    assert.match(s.out.join(''), /unknown: 3 of 8 file\(s\) not analysed, 1 in other languages, 0 computed site\(s\)/);
    const html = readFileSync(out, 'utf8');
    assert.match(html, /<strong>Unknown, not clean:<\/strong> 3 of 8 source file\(s\) not analysed/);
    assert.match(html, /python 1/);
  });

  test('--repo refuses a directory that is not a git checkout, exit 21', async () => {
    // arrange
    const dir = mkdtempSync(join(tmpdir(), 'cw-dfd-nogit-'));
    const s = io();

    // act
    const code = await CLI.main(['--repo', dir], { env: {}, ...s });

    // assert
    assert.equal(code, CLI.EXIT.INPUT);
    assert.match(s.err.join(''), /is not a git checkout/);
    assert.equal(s.out.join(''), '');
  });

  test('--repo of this checkout reads its own tracked .mjs set; a pass that finds no flow is nothing to draw (the pass injected)', async () => {
    // arrange
    let seen = null;
    const pass = async (a) => { seen = a; return { v: 1, nodes: [], edges: [], modules: [], summary: { filesInput: a.files.length, analysed: a.files.length, unanalysable: 0 } }; };

    // act
    const r = await CLI.scannedModel({ repo: S.repoRoot() }, { analyse: pass });

    // assert
    assert.equal(seen.self, true);
    assert.ok(seen.files.length > 100 && seen.files.every((f) => f.endsWith('.mjs')));
    assert.equal(r.code, CLI.EXIT.SIZE);
    assert.match(r.error, new RegExp(`^nothing to draw: no flow was found \\(left out: none; not analysed: 0 of ${seen.files.length} file\\(s\\)\\)$`));
  });

  test('--codeql whose records hold no path is nothing to draw, exit 22, the omitted counted', async () => {
    // arrange
    const file = join(mkdtempSync(join(tmpdir(), 'cw-dfd-codeql-')), 'codeql.sarif');
    writeFileSync(file, sarif([{ ruleId: 'js/bad-tag-filter', locations: [] }]));
    const s = io();

    // act
    const code = await CLI.main(['--codeql', file], { env: {}, ...s });

    // assert
    assert.equal(code, CLI.EXIT.SIZE);
    assert.match(s.err.join(''), /nothing to draw: no flow was found \(left out: noPath 1\)/);
  });

  test('without vm modules --repo runs itself again in a child that has them, and passes its output through', async () => {
    // arrange
    const { root } = fixtureRepo();
    const s = io();

    // act
    const code = await CLI.main(['--repo', root, '--emit', 'analysis'], { env: process.env, ...s, vmModules: false });
    const usage = CLI.rerunWithVmModules(['--repo'], { env: process.env, ...io() });

    // assert
    assert.equal(code, 0, s.err.join(''));
    assert.equal(JSON.parse(s.out.join('')).v, 1);
    assert.equal(usage, CLI.EXIT.USAGE);
  });

  test('rerunWithVmModules reports a child that could not run as an input failure, never as a pass', () => {
    // arrange
    const s = io();
    const run = () => ({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' });

    // act
    const code = CLI.rerunWithVmModules(['--repo', '.'], { env: {}, ...s, run });

    // assert
    assert.equal(code, CLI.EXIT.INPUT);
    assert.match(s.err.join(''), /could not run \(SIGKILL\)/);
  });

  // ── CodeQL ───────────────────────────────────────────────────────────────────────────────────

  test('readCodeFlows reads SARIF through the one reader, records as an array or under records, and refuses the rest', () => {
    // arrange
    const dir = mkdtempSync(join(tmpdir(), 'cw-dfd-codeql-'));
    const files = {
      sarif: sarif([traced('js/sql-injection', ['src/api.ts', 5, 'req.query'], ['src/store.ts', 2, 'query(…)']), { ruleId: 'js/bad-tag-filter', locations: [] }]),
      array: JSON.stringify([{ repo: 'x', rule: 'r', reachability: 'reachability_unknown', path: null }]),
      records: JSON.stringify({ records: [] }),
      notsarif: JSON.stringify({ hello: 1 }),
      broken: '{',
    };
    for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);

    // act
    const got = Object.fromEntries(Object.keys(files).map((k) => [k, CLI.readCodeFlows(join(dir, k), 'repo1')]));
    const absent = CLI.readCodeFlows(join(dir, 'none'), 'repo1');

    // assert
    assert.deepEqual(got.sarif.records.map((r) => [r.repo, r.rule, r.reachability]), [['repo1', 'js/sql-injection', 'reachable'], ['repo1', 'js/bad-tag-filter', 'reachability_unknown']]);
    assert.equal(got.array.records.length, 1);
    assert.deepEqual(got.records.records, []);
    assert.match(got.notsarif.error, /SARIF state: never-ran/);
    assert.match(got.broken.error, /SARIF state: unparseable/);
    assert.match(absent.error, /ENOENT/);
  });

  test('--codeql alone draws the code flows, attributed to the SARIF\'s directory', async () => {
    // arrange
    const dir = mkdtempSync(join(tmpdir(), 'cw-dfd-codeql-'));
    const file = join(dir, 'codeql.sarif');
    writeFileSync(file, sarif([traced('js/sql-injection', ['src/api.ts', 5, 'req.query'], ['src/store.ts', 2, 'query(…)'])]));
    const s = io();

    // act
    const code = await CLI.main(['--codeql', file, '--emit', 'model'], { env: {}, ...s });

    // assert
    assert.equal(code, 0, s.err.join(''));
    const model = JSON.parse(s.out.join(''));
    assert.equal(model.source.producer, 'codeql-code-flows');
    assert.ok(model.nodes.some((n) => n.id === `code:${dirname(file).split('/').pop()}:src/api.ts`));
  });

  test('--codeql refuses an unreadable file, exit 21', async () => {
    // arrange
    const s = io();

    // act
    const code = await CLI.main(['--codeql', join(tmpdir(), 'cw-none', 'x.sarif')], { env: {}, ...s });

    // assert
    assert.equal(code, CLI.EXIT.INPUT);
    assert.match(s.err.join(''), /--codeql .*ENOENT/);
  });

  test('--repo with --codeql merges by repository-relative path: a traced file is the module\'s own element', async () => {
    // arrange
    const { root } = fixtureRepo();
    const file = join(mkdtempSync(join(tmpdir(), 'cw-dfd-codeql-')), 'codeql.sarif');
    writeFileSync(file, sarif([traced('js/sql-injection', [`file://${root}/src/api.ts`, 5, 'req.query'], ['./src/store.ts', 2, 'query(…)']),
      traced('js/xss', ['src/elsewhere.ts', 1, 'location'], ['src/elsewhere.ts', 9, 'innerHTML'])]));
    const s = io();

    // act
    const code = await CLI.main(['--repo', root, '--codeql', file, '--emit', 'model'], { env: {}, ...s });

    // assert
    assert.equal(code, 0, s.err.join(''));
    const model = JSON.parse(s.out.join(''));
    assert.equal(validateDfd(model).ok, true);
    assert.equal(model.source.producer, 'flow-graph+codeql-code-flows');
    assert.deepEqual([model.source.options.merged.codeqlProcessesMatched, model.source.options.merged.codeqlProcessesUnmatched], [2, 1]);
    assert.ok(model.flows.some((f) => f.from === 'node:module:src/api.ts' && f.to === 'node:module:src/store.ts' && /sql-injection/.test(f.label)));
    assert.ok(model.nodes.some((n) => n.label === 'src/elsewhere.ts' && n.id.startsWith('code:')));
    assert.ok(model.source.unknown, 'the merged model keeps what the static pass could not read');
  });

  test('--repo filters, collapses and refuses through the same prepare as every source', async () => {
    // arrange
    const { root } = fixtureRepo();
    const s = io();

    // act
    const none = await CLI.main(['--repo', root, '--focus', 'no/such/node'], { env: {}, ...s });
    const some = await CLI.main(['--repo', root, '--focus', 'src/api.ts', '--emit', 'model'], { env: {}, ...io() });

    // assert
    assert.equal(none, CLI.EXIT.SIZE);
    assert.equal(some, 0);
  });

  test('needsPass is true only for --repo', () => {
    // arrange
    const cases = [{ repo: 'r' }, { codeql: 'c' }, { from: 'f' }];

    // act
    const got = cases.map(CLI.needsPass);

    // assert
    assert.deepEqual(got, [true, false, false]);
  });
}
