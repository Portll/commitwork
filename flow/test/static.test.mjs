// C1, including the two directions of its own floor.
//
// vm.SourceTextModule needs --experimental-vm-modules. Rather than skip when the flag is absent —
// a skipped guard is a guard that reports nothing and looks green — this file re-runs ITSELF in a
// child that has the flag, and fails loudly if the child could not run at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// EXPECTED_TESTS is asserted against the child's own summary. Without it this delegation is a false
// clean: the first version used stdio:'inherit', the node:test runner swallowed the nested TAP, and
// the parent passed in 0.9ms on a child whose output nobody saw. A delegating guard has to prove
// the delegate ran, not that it exited 0.
const EXPECTED_TESTS = 17;

if (typeof vm.SourceTextModule !== 'function') {
  // NODE_TEST_CONTEXT must be cleared or the child sees itself as a nested run and refuses:
  // "run() is being called recursively within a test file. skipping running files." — which exits 0
  // and prints no summary, i.e. a silent skip wearing a pass.
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  // spec, named: Node 22 writes TAP to a pipe, and the summary below is read in spec form.
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=spec', SELF],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  test('the V8-backed static tests ran in a child carrying --experimental-vm-modules', () => {
    assert.notEqual(r.status, null,
      `the child could not START (${r.signal || r.error}) — not the same as a test failing`);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const pass = Number((/^ℹ pass (\d+)$/m.exec(out) || [])[1] ?? -1);
    const fail = Number((/^ℹ fail (\d+)$/m.exec(out) || [])[1] ?? -1);
    assert.ok(pass >= 0 && fail >= 0, `the child produced no test summary — it ran nothing:\n${out.slice(-2000)}`);
    assert.equal(fail, 0, `child failures:\n${out.slice(-4000)}`);
    assert.ok(pass >= EXPECTED_TESTS,
      `child reported only ${pass} passing tests, expected >= ${EXPECTED_TESTS} — the delegation is hollow`);
    assert.equal(r.status, 0, out.slice(-2000));
  });
} else {
  const { analyseSource, analyseRepo, looksLikePath, verbBefore } = await import('../static.mjs');
  const { maskFrom, maskConsistent, specifierCoverage, parseModule } = await import('../verify.mjs');
  const { classify } = await import('../lexer.mjs');
  const { orphans } = await import('../orphans.mjs');

  test('NEGATIVE CONTROL — a known read, write and spawn are each found', () => {
    // First, because every other assertion here is satisfied by an extractor that returns nothing.
    const src = 'import { readFileSync, writeFileSync } from "node:fs";\n'
      + 'import { spawnSync } from "node:child_process";\n'
      + 'readFileSync("reports/in.json", "utf8");\n'
      + 'writeFileSync("reports/out.json", "{}");\n'
      + 'spawnSync("git", ["status"]);\n';
    return analyseSource('bin/x.mjs', src).then((r) => {
      assert.equal(r.state, 'analysed');
      const got = r.edges.map((e) => `${e.kind} ${e.target}`);
      assert.ok(got.includes('reads reports/in.json'), got.join(' | '));
      assert.ok(got.includes('writes reports/out.json'), got.join(' | '));
      assert.ok(got.includes('spawns git'), got.join(' | '));
    });
  });

  test('NEGATIVE CONTROL — a module that touches nothing produces NO edges', async () => {
    const r = await analyseSource('bin/pure.mjs', 'export const add = (a, b) => a + b;\n');
    assert.equal(r.state, 'analysed');
    assert.deepEqual(r.edges, []);
  });

  test('UNPARSEABLE IS ITS OWN STATE — not clean, not a finding', async () => {
    const r = await analyseSource('bin/broken.mjs', 'return 1;\n');   // illegal at module top level
    assert.equal(r.state, 'unparseable');
    assert.ok(r.reason);
    assert.deepEqual(r.edges, [], 'a file nobody could read contributes no claims in either direction');
  });

  test('a lexer bail is its own state too', async () => {
    const r = await analyseSource('bin/bail.mjs', 'const a = 1;\n');
    assert.equal(r.state, 'analysed');
    // The bail path is exercised through classify() directly; here we only assert the states differ.
    assert.equal(classify("const a = 'x\n").ok, false);
  });

  test('THE FALSE-POSITIVE FLOOR CAN FAIL — a wrong span set is REJECTED by V8', async () => {
    // The floor must be able to refuse. A mask check that accepts anything is the streak the repaired
    // import guard had: right all along, with no reason it had to be.
    const src = 'function f() { return 1; }\n';
    const good = classify(src).spans;
    assert.equal((await maskConsistent(src, good, 't.mjs')).ok, true, 'the true classification must pass');

    // Claim the signature is a string interior. The rewrite becomes `function fxxxxxxxxxxxx1; }`.
    const wrong = [{ kind: 'string', start: 10, end: 22, innerStart: 10, innerEnd: 22, quote: "'", value: null }];
    assert.equal((await maskConsistent(src, wrong, 't.mjs')).ok, false,
      'claiming real code is a string interior must be refused by V8');
  });

  test('THE KNOWN LIMIT: a wrong span that stays PARSEABLE is not caught', async () => {
    // Stated rather than left implicit. The mask check is a floor, not a ceiling: it refuses a
    // classification V8 cannot parse, and a misclassification that happens to remain valid passes.
    // This is why W3 (the dumb scan) and W4 (the runtime) exist — if this ever starts failing, the
    // floor has become a ceiling and the comment above it is wrong.
    const src = 'const a = 1;\nconst b = 2;\n';
    const wrong = [{ kind: 'string', start: 0, end: 12, innerStart: 0, innerEnd: 12, quote: "'", value: null }];
    assert.equal((await maskConsistent(src, wrong, 't.mjs')).ok, true,
      'masking `const a = 1;` to `xxxxxxxxxxxx` yields a valid expression statement — undetectable here');
  });

  test('the mask preserves length and newlines', () => {
    const src = 'const a = 1 /*\n*/ ;\nconst p = "reports/x.json";\n';
    const m = maskFrom(src, classify(src).spans);
    assert.equal(m.ok, true);
    assert.equal(m.masked.length, src.length, 'offsets must survive the rewrite');
    assert.equal((m.masked.match(/\n/g) || []).length, (src.match(/\n/g) || []).length,
      'a newline inside a block comment is a line terminator for ASI — losing it invents a parse failure');
  });

  test('THE FALSE-NEGATIVE TEST CAN FAIL — a specifier V8 sees and the lexer missed is reported', async () => {
    const src = 'import x from "./real.mjs";\n';
    const { specifiers } = await parseModule(src, 't.mjs');
    assert.deepEqual(specifierCoverage(specifiers, classify(src).spans).missing, [],
      'the true span set covers it');
    assert.deepEqual(specifierCoverage(specifiers, []).missing, ['./real.mjs'],
      'and an empty span set must be reported as a hole, not as agreement');
  });

  test('COVERAGE IS OVER THE FILE SET — analysed + unanalysable accounts for every input', async () => {
    const d = fixtureRepo({ 'bin/ok.mjs': 'export const a = 1;\n', 'bin/bad.mjs': 'return 1;\n' });
    try {
      const g = await analyseRepo({ root: d, files: ['bin/ok.mjs', 'bin/bad.mjs'] });
      assert.equal(g.summary.filesInput, 2);
      assert.equal(g.summary.analysed + g.summary.unanalysable, 2);
      assert.equal(g.summary.coverageAccountsForAll, true);
      assert.deepEqual(g.summary.unanalysableByReason, { unparseable: 1 });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('END TO END — a planted orphan is found in a fixture repo', async () => {
    const d = fixtureRepo({
      'bin/writer.mjs': 'import { writeFileSync } from "node:fs";\nwriteFileSync("reports/orphan.json", "{}");\n',
      'bin/reader.mjs': 'import { readFileSync } from "node:fs";\nreadFileSync("reports/never-written.json", "utf8");\n',
    });
    try {
      const g = await analyseRepo({ root: d, files: ['bin/writer.mjs', 'bin/reader.mjs'] });
      const o = orphans(g);
      assert.deepEqual(o.writtenNeverRead.map((x) => x.path), ['reports/orphan.json']);
      assert.deepEqual(o.readNeverWritten.map((x) => x.path), ['reports/never-written.json']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('END TO END — a repo with NO orphan stays quiet', async () => {
    const d = fixtureRepo({
      'bin/writer.mjs': 'import { writeFileSync } from "node:fs";\nwriteFileSync("reports/paired.json", "{}");\n',
      'bin/reader.mjs': 'import { readFileSync } from "node:fs";\nreadFileSync("reports/paired.json", "utf8");\n',
    });
    try {
      const o = orphans(await analyseRepo({ root: d, files: ['bin/writer.mjs', 'bin/reader.mjs'] }));
      assert.deepEqual(o.writtenNeverRead, []);
      assert.deepEqual(o.readNeverWritten, []);
      assert.deepEqual(o.readNeverWrittenWithFallback, []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a fallback at the read site is recorded as a DIFFERENT finding', async () => {
    const d = fixtureRepo({
      'bin/guarded.mjs': 'import { readFileSync } from "node:fs";\n'
        + 'let v; try { v = readFileSync("reports/maybe.json", "utf8"); } catch { v = "{}"; }\nexport default v;\n',
    });
    try {
      const o = orphans(await analyseRepo({ root: d, files: ['bin/guarded.mjs'] }));
      assert.deepEqual(o.readNeverWrittenWithFallback.map((x) => x.path), ['reports/maybe.json']);
      assert.deepEqual(o.readNeverWritten, [], 'the guarded read must not ALSO appear as a plain one');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('CW_* env keys are edges, and a load-time read is flagged', async () => {
    const r = await analyseSource('bin/e.mjs',
      'const AT_LOAD = process.env.CW_ROOT || "x";\nexport const f = () => process.env.CW_LATE;\n');
    const keys = Object.fromEntries(r.envKeys.map((k) => [k.key, k.suspectedLoadTime]));
    assert.equal(keys.CW_ROOT, true, 'a module-load env read defeats every test that sets the override');
    assert.equal(keys.CW_LATE, false);
  });

  test('a path named only in a comment is not a read', async () => {
    // Quoted, because W3 scans quoted runs only — an unquoted path in prose is invisible to both
    // witnesses and therefore claimed by neither.
    const r = await analyseSource('bin/c.mjs', "// writes 'reports/ghost.json' when asked\nexport const a = 1;\n");
    assert.deepEqual(r.edges, []);
    assert.equal(r.witness.pathsInComments, 1, 'it is explained, not silently dropped');
    assert.deepEqual(r.witness.unaccounted, [], 'and it is not reported as a hole in the extractor');
  });

  test('looksLikePath refuses the things that are not paths', () => {
    for (const yes of ['reports/x.json', 'rollup.json', 'monitor/projects.json', 'docs/TRAPS.md']) {
      assert.equal(looksLikePath(yes), true, yes);
    }
    for (const no of ['utf8', 'application/json', 'text/html', 'node:fs', 'https://x.test/a.json',
      '*/node_modules/*', '', 'a b.json', 'reports/${area}/x.json']) {
      assert.equal(looksLikePath(no), false, no);
    }
  });

  test('the verb lookback reads the MASKED source, so prose cannot supply a verb', () => {
    assert.equal(verbBefore('readFileSync(', 13).role, 'reads');
    assert.equal(verbBefore('writeFileSync(', 14).role, 'writes');
    assert.equal(verbBefore('spawnSync(', 10).role, 'spawn-target');
    assert.equal(verbBefore('const p = ', 10).role, 'unknown', 'no verb means UNKNOWN, never a guess');
  });

  test('CW_HARNESS_STORE is read at CALL time', async () => {
    const { storePath } = await import('../store.mjs');
    const a = storePath('flow.json', { CW_HARNESS_STORE: '/tmp/one' });
    const b = storePath('flow.json', { CW_HARNESS_STORE: '/tmp/two' });
    assert.notEqual(a, b, 'a module-load const would make these identical and the test would prove nothing');
    assert.match(storePath('flow.json', {}), /reports\/harness\/flow\.json$/);
  });
}

function fixtureRepo(files) {
  const d = mkdtempSync(join(tmpdir(), 'flow-st-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  return d;
}
