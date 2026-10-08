// W2, and the claim the whole design rests on: LINKING IS NOT EVALUATION.
//
// vm.SourceTextModule needs --experimental-vm-modules. Rather than skip when the flag is absent —
// a skipped guard reports nothing and looks exactly like a passing one — this file re-runs ITSELF
// in a child that has the flag, and fails loudly if the child could not run at all. The pattern is
// flow/test/static.test.mjs's, including the reason it asserts the child's own summary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const EXPECTED_TESTS = 15;

if (typeof vm.SourceTextModule !== 'function') {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  // spec, named: Node 22 writes TAP to a pipe, and the summary below is read in spec form.
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=spec', SELF],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  test('the V8-backed witness tests ran in a child carrying --experimental-vm-modules', () => {
    assert.notEqual(r.status, null,
      `the child could not START (${r.signal || r.error}) — not the same as a test failing`);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const pass = Number((/^ℹ pass (\d+)$/m.exec(out) || [])[1] ?? -1);
    const fail = Number((/^ℹ fail (\d+)$/m.exec(out) || [])[1] ?? -1);
    assert.ok(pass >= 0 && fail >= 0, `the child produced no test summary — it ran nothing:\n${out.slice(-2000)}`);
    assert.equal(fail, 0, `child failures:\n${out.slice(-4000)}`);
    assert.ok(pass >= EXPECTED_TESTS,
      `child reported only ${pass} passing tests, expected >= ${EXPECTED_TESTS} — the delegation is hollow`);
  });
} else {
  const { surfaceOf, STAR_PROBE } = await import('../v8-surface.mjs');
  const { analyse } = await import('../build.mjs');
  const { deadExports, blastRadius, importers } = await import('../query.mjs');

  const fixture = (map) => ({
    files: Object.keys(map),
    readFile: (p) => {
      const v = map[p];
      if (v === undefined) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (v instanceof Error) throw v;
      return v;
    },
  });

  test('NOTHING RUNS — a module with a top-level side effect leaves no trace', async () => {
    delete globalThis.__cw_codegraph_ran;
    const src = [
      'globalThis.__cw_codegraph_ran = true;',
      'throw new Error("this module throws the moment it is evaluated");',
      'export const after = 1;',
    ].join('\n');
    const r = await surfaceOf(src, 'sideeffect.mjs');
    assert.equal(r.ok, true, 'it must still read the surface of a module it refuses to run');
    assert.deepEqual(r.exports, ['after']);
    assert.equal(globalThis.__cw_codegraph_ran, undefined,
      'the module body executed — the entire safety claim of this witness is that it does not');
  });

  test('the export surface is V8s, aliases and destructuring included', async () => {
    const r = await surfaceOf([
      'const beta = 1;',
      'export { beta as bee };',
      'export function alpha() {}',
      'export class Gamma {}',
      'export const { p, q } = { p: 1, q: 2 };',
      'export default function () {}',
    ].join('\n'), 'surface.mjs');
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.exports, ['Gamma', 'alpha', 'bee', 'default', 'p', 'q']);
    assert.equal(r.surfaceComplete, true);
  });

  test('imported names are learned FROM V8, one refusal at a time', async () => {
    const r = await surfaceOf("import { alpha, beta as b } from './x.mjs';\nimport d from './y.mjs';\nexport const use = [alpha, b, d];\n", 'imports.mjs');
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.imports, [
      { specifier: './x.mjs', names: ['alpha', 'beta'] },
      { specifier: './y.mjs', names: ['default'] },
    ], 'the names are the EXPORTED ones — V8 has no opinion about the local alias `b`');
    assert.ok(r.attempts > 1, 'each refusal taught it one name; a single attempt would mean it guessed');
  });

  test('a star re-export marks the surface INCOMPLETE, and the probe never leaks into it', async () => {
    const r = await surfaceOf("export * from './other.mjs';\nexport const own = 1;\n", 'star.mjs');
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.surfaceComplete, false, 'a surface with names in another file is not whole');
    assert.deepEqual(r.starReexports, ['./other.mjs']);
    assert.deepEqual(r.exports, ['own']);
    assert.ok(!r.exports.includes(STAR_PROBE), 'the sentinel must never appear in a reported surface');

    const plain = await surfaceOf("import './other.mjs';\nexport const own = 1;\n", 'plain.mjs');
    assert.equal(plain.surfaceComplete, true,
      'a side-effect import of the same specifier is NOT a star re-export — the probe tells them apart');
  });

  test('an unparseable module is UNKNOWN, not a module with no exports', async () => {
    const r = await surfaceOf('export function ( {{{ \n', 'broken.mjs');
    assert.equal(r.ok, false);
    assert.match(r.reason, /parse failed/);
    assert.deepEqual(r.exports, [], 'and it reports no surface rather than an empty one it believes');
    assert.equal(r.surfaceComplete, false);
  });

  test('divergence is caught in the FALSE NEGATIVE direction', async () => {
    // `export let x;` has no initialiser, so W1's binding regex never sees it and V8 does.
    const g = await analyse(fixture({ 'a.mjs': 'export let uninitialised;\nexport const seen = 1;\n' }));
    assert.deepEqual(g.summary.divergence.falseNegative, [{ path: 'a.mjs', names: ['uninitialised'] }]);
    assert.deepEqual(g.summary.divergence.falsePositive, []);
    assert.ok(g.nodes.some((n) => n.id === 'sym:a.mjs#uninitialised' && n.witness === 'v8'),
      'the symbol W1 missed still exists in the graph, carrying the witness that found it');
  });

  test('a file W1 cannot read is UNREADABLE — no nodes, and every answer says so', async () => {
    const g = await analyse(fixture({
      'good.mjs': 'export const alpha = 1;\n',
      'bad.mjs': 'const s = "unterminated\nexport const beta = 2;\n',
    }));
    assert.equal(g.summary.analysed, 1);
    assert.equal(g.summary.unreadable, 1);
    assert.deepEqual(g.files.unreadable.map((u) => u.path), ['bad.mjs']);
    assert.ok(!g.nodes.some((n) => n.path === 'bad.mjs'), 'an unreadable file contributes nothing');

    const dead = deadExports(g);
    assert.deepEqual(dead.dead, [], 'nothing may be called dead while a file could not be read');
    assert.equal(dead.undetermined.length, 1);
    assert.match(dead.undetermined[0].why, /could not be analysed/);
  });

  test('a file V8 refuses is PARTIAL — its references still protect other modules', async () => {
    const g = await analyse(fixture({
      'lib.mjs': 'export function used() {}\n',
      'script.mjs': "import { used } from './lib.mjs';\nreturn used();\n",   // top-level return: not a module
    }));
    assert.equal(g.summary.partial, 1, 'the illegal top-level return makes it partial, not unreadable');
    assert.equal(g.summary.unreadable, 0);
    const dead = deadExports(g);
    assert.deepEqual(dead.dead, [],
      'the partial file imports `used`, so `used` is not dead — this is the whole reason partial exists');
    assert.deepEqual(dead.undetermined, []);
  });

  test('dead exports are found when the population has no holes at all', async () => {
    const g = await analyse(fixture({
      'lib.mjs': 'export function used() {}\nexport function unused() {}\n',
      'app.mjs': "import { used } from './lib.mjs';\nused();\n",
    }));
    assert.equal(g.summary.unreadable + g.summary.partial, 0);
    const dead = deadExports(g);
    assert.deepEqual(dead.dead.map((d) => d.name), ['unused']);
    assert.deepEqual(dead.undetermined, []);
  });

  test('a dynamic import protects the whole surface it reaches', async () => {
    const g = await analyse(fixture({
      'lib.mjs': 'export function maybeUsed() {}\n',
      // Composed, not written literally: bin/lib/tracked-imports.mjs matches `import('…')` ANYWHERE
      // by design, so a dynamic import spelled out inside a fixture string trips that guard on a
      // path this file never imports. Its false-positive history is why it scans that way.
      'app.mjs': `const m = await import(${JSON.stringify('./lib.mjs')});\n`,
    }));
    const dead = deadExports(g);
    assert.deepEqual(dead.dead, [], 'a dynamic import names no bindings, so nothing behind it is dead');
    assert.match(dead.undetermined[0].why, /dynamic import/);
  });

  test('two export * statements are both seen, not cancelled out', async () => {
    // One shared probe name was ambiguous across two stars, V8 dropped it, and the module read back
    // as starring nothing with a complete surface.
    const r = await surfaceOf("export * from './a.mjs';\nexport * from './b.mjs';\nexport const own = 1;\n", 'stars.mjs');
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.starReexports, ['./a.mjs', './b.mjs']);
    assert.equal(r.surfaceComplete, false);
    assert.deepEqual(r.exports, ['own'], 'and no probe leaks onto the surface');
  });

  test('every re-export shape is an edge both witnesses agree on', async () => {
    const g = await analyse(fixture({
      'lib/roots.mjs': 'export function withRoot() {}\nexport const draftRoot = 1;\nexport default 0;\n',
      'lib/space.mjs': 'export const s = 1;\n',
      'lib/star.mjs': 'export const t = 1;\n',
      'lib/manifest.mjs': [
        "export { withRoot, draftRoot as draft, default as base } from './roots.mjs';",
        "export * from './star.mjs';",
        "export * as space from './space.mjs';",
        "import * as whole from './space.mjs';",
        "import { t } from './star.mjs';",
        'export { whole, t as tee };',
      ].join('\n'),
    }));
    assert.deepEqual(g.summary.divergence.reexports, { falsePositive: [], falseNegative: [] });
    const re = g.edges.filter((e) => e.kind === 'reexports')
      .map((e) => `${e.from} -> ${e.to}${e.star ? ' *' : ''}${e.namespace ? ' ns' : ''} ${e.witness} ${e.existence}`);
    assert.deepEqual(re, [
      'mod:lib/manifest.mjs -> mod:lib/star.mjs * both confirmed',
      'sym:lib/manifest.mjs#base -> sym:lib/roots.mjs#default both confirmed',
      'sym:lib/manifest.mjs#draft -> sym:lib/roots.mjs#draftRoot both confirmed',
      'sym:lib/manifest.mjs#space -> mod:lib/space.mjs ns both confirmed',
      'sym:lib/manifest.mjs#t -> sym:lib/star.mjs#t both confirmed',
      'sym:lib/manifest.mjs#tee -> sym:lib/star.mjs#t both confirmed',
      'sym:lib/manifest.mjs#whole -> mod:lib/space.mjs ns both confirmed',
      'sym:lib/manifest.mjs#withRoot -> sym:lib/roots.mjs#withRoot both confirmed',
    ], 'named, renamed, default, star, star-as, namespace and import-then-export, plus the name the star carries');
    const node = g.nodes.find((n) => n.id === 'sym:lib/manifest.mjs#withRoot');
    assert.deepEqual([node.symbolKind, node.witness, node.line], ['reexport', 'both', 1]);
  });

  test('a symbol used only through re-exports is not dead; one re-exported to nobody still is', async () => {
    // The measured case: lib/docsite-roots.mjs#withRoot, imported by name through lib/docsite-manifest.mjs.
    const g = await analyse(fixture({
      'lib/roots.mjs': 'export function withRoot() {}\nexport function draftRoot() {}\nexport function unused() {}\n',
      'lib/manifest.mjs': "export { withRoot, draftRoot } from './roots.mjs';\n",
      'lib/index.mjs': "export { withRoot as root } from './manifest.mjs';\n",
      'app.mjs': "import { root } from './lib/index.mjs';\nroot();\n",
    }));
    const dead = deadExports(g);
    assert.deepEqual(dead.dead.map((d) => `${d.path}#${d.name}`).sort(), [
      'lib/manifest.mjs#draftRoot', 'lib/roots.mjs#draftRoot', 'lib/roots.mjs#unused',
    ], 'withRoot is reached two hops away; draftRoot is re-exported and nobody binds the re-export');
    assert.deepEqual(dead.undetermined, []);

    // Reachability already held: a re-export is a module request, so it has always been an imports
    // edge. Asserted so that stays true, not because this change moved it.
    assert.deepEqual(blastRadius(g, 'lib/roots.mjs').reached.map((r) => `${r.path}@${r.depth}`),
      ['lib/manifest.mjs@1', 'lib/index.mjs@2', 'app.mjs@3']);
    assert.deepEqual(importers(g, 'lib/roots.mjs').static, ['lib/manifest.mjs']);
  });

  test('a dynamic import of a re-exporting module leaves what it re-exports undetermined', async () => {
    const g = await analyse(fixture({
      'lib/roots.mjs': 'export function hidden() {}\n',
      'lib/manifest.mjs': "export { hidden } from './roots.mjs';\n",
      'app.mjs': `const m = await import(${JSON.stringify('./lib/manifest.mjs')});\n`,
    }));
    const dead = deadExports(g);
    assert.deepEqual(dead.dead, [], 'm.hidden is a member access no binding records');
    assert.deepEqual(dead.undetermined.map((d) => d.id).sort(), ['sym:lib/manifest.mjs#hidden', 'sym:lib/roots.mjs#hidden']);
    assert.match(dead.undetermined.find((d) => d.path === 'lib/roots.mjs').why, /reached through a re-export: .*dynamic import/);
  });

  test('same input, byte-identical output', async () => {
    const files = {
      'a.mjs': "import { b } from './b.mjs';\nexport function a() { return b(); }\n",
      'b.mjs': 'export function b() { return 1; }\n',
    };
    const env = { CW_NOW: '2026-09-04T00:00:00.000Z' };
    const one = await analyse({ ...fixture(files), env });
    const two = await analyse({ ...fixture(files), env });
    assert.equal(JSON.stringify(one), JSON.stringify(two));
    assert.equal(one.generatedAt, '2026-09-04T00:00:00.000Z', 'CW_NOW is honoured, so a re-run is comparable');
  });
}
