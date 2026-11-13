// Spawned node scripts and append/tail marks (flow/static.mjs nodeSpawns / streamMarks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';
import { valueContext, nodeSpawns, argUses, appendFlag, streamMarks, verbBefore } from '../static.mjs';

const ctxOf = (src, path = 'monitor/a.mjs') => {
  const lex = classify(src);
  return { ctx: valueContext(path, maskFrom(src, lex.spans).masked, lex.spans), line: lex.lineOf };
};

test('node and process.execPath spawns yield script candidates; flags are skipped', () => {
  // arrange
  const src = [
    "const HERE = dirname(fileURLToPath(import.meta.url));",
    "spawnSync('node', ['bin/x.mjs', '--json']);",
    "spawnSync(process.execPath, ['--experimental-vm-modules', join(HERE, 'rollup.mjs')]);",
    "cp.execFileSync(process.execPath, [join(REPO, 'bin', 'y.mjs')]);",
    "spawn('git', ['status']);",
    "other.spawn(process.execPath, ['z.mjs']);",
  ].join('\n');
  const { ctx, line } = ctxOf(src);
  // act
  const r = nodeSpawns(ctx, { cpNamespaces: new Set(['cp']), line });
  // assert
  assert.deepEqual([...r.byLiteral.values()].map((i) => i.candidates), [['bin/x.mjs', 'monitor/bin/x.mjs']]);
  assert.deepEqual(r.execPath.map((x) => [x.verb, x.info.candidates]), [
    ['spawnSync', ['monitor/rollup.mjs']],
    ['execFileSync', ['monitor/bin/y.mjs', 'bin/y.mjs']],
  ]);
  assert.deepEqual(r.sites, []);
});

test('an unresolvable script is a site with its reason', () => {
  // arrange
  const src = [
    'spawnSync(process.execPath, args);',
    'spawnSync(process.execPath, [...extra]);',
    "spawnSync(process.execPath, ['--flag']);",
    'spawnSync(process.execPath, [script]);',
    "spawnSync(process.execPath, ['../../../out.mjs']);",
    'spawnSync();',
  ].join('\n');
  const { ctx, line } = ctxOf(src);
  // act
  const r = nodeSpawns(ctx, { line });
  // assert
  assert.deepEqual(r.sites.map((s) => s.reason), ['argv not an array literal', 'script spread argv', 'no script argument', 'script unresolved script', 'script outside the repository']);
});

test('argUses records every verb(name call with its offset', () => {
  // arrange
  const masked = 'appendFileSync(LOG, x); createReadStream(LOG)';
  // act
  const u = argUses(masked);
  // assert
  assert.deepEqual(u.get('LOG').map((x) => x.verb), ['appendFileSync', 'createReadStream']);
});

test("appendFlag finds flags: 'a' / 'a+' inside the call and nowhere else", () => {
  // arrange
  const src = "createWriteStream(P, { flags: 'a' }); createWriteStream(Q, { flags: 'w' }); createWriteStream(R); const z = { flags: 'a' };";
  const { ctx } = ctxOf(src);
  const at = (n) => ctx.masked.indexOf(`createWriteStream(${n}`);
  // act
  const got = ['P', 'Q', 'R'].map((n) => appendFlag(ctx, at(n)));
  const unclosed = appendFlag(ctxOf('createWriteStream(P, ').ctx, 0);
  // assert
  assert.deepEqual(got, [true, false, false]);
  assert.equal(unclosed, false);
});

test('streamMarks: append writers, tailing readers, polling reads', () => {
  // arrange
  const src = "createWriteStream(P, { flags: 'a+' });";
  const { ctx } = ctxOf(src);
  const poll = [{ start: 100, end: 200 }];
  // act
  const got = [
    streamMarks(ctx, 'appendFileSync', 0, 'writes', poll),
    streamMarks(ctx, 'createWriteStream', 0, 'writes', poll),
    streamMarks(ctx, 'writeFileSync', 0, 'writes', poll),
    streamMarks(ctx, 'createReadStream', 0, 'reads', poll),
    streamMarks(ctx, 'watch', 0, 'reads', poll),
    streamMarks(ctx, 'readFileSync', 150, 'reads', poll),
    streamMarks(ctx, 'readFileSync', 50, 'reads', poll),
    streamMarks(ctx, 'readFileSync', 150, 'touches', poll),
  ];
  // assert
  assert.deepEqual(got, [{ append: true }, { append: true }, {}, { tail: true }, { tail: true }, { tail: true }, {}, {}]);
});

test('verbBefore: a method named exec is not a spawn unless its receiver is child_process', () => {
  // arrange
  const cases = ['db.exec(', 'RE.exec(', 'cp.exec(', 'exec(', 'cp.execSync('];
  // act
  const got = cases.map((t) => verbBefore(t, t.length, 260, { cpNamespaces: new Set(['cp']) }).role);
  // assert
  assert.deepEqual(got, ['not-spawn', 'not-spawn', 'spawn-target', 'spawn-target', 'spawn-target']);
});
