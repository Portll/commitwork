// bin/exit-codes.mjs — the header forms it reads, the forms it refuses to read, the real tree, and
// docs/EXIT-CODES.md being current. The fixture repo runs the script as a process (env-pointed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeader, collect, render } from '../exit-codes.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(CW, 'bin', 'exit-codes.mjs');
const codes = (p) => p.entries.map((e) => [e.code, e.meaning]);

// One fixture per form the extractor reads; the tree test below holds the tree to this set.
const FORMS = {
  labelled: ['#!/usr/bin/env node\n// tool — x\n// exit: 0 clean · 1 findings (gate) ·\n//       2 bad usage / unreadable input\nimport x from "y";\n',
    [[0, 'clean'], [1, 'findings (gate)'], [2, 'bad usage / unreadable input']]],
  block: ['/**\n * tool\n * exit codes:\n *   0  pass · 1 FINDINGS\n *   3  NOT SEEDED (ENOENT)\n */\n',
    [[0, 'pass'], [1, 'FINDINGS'], [3, 'NOT SEEDED (ENOENT)']]],
  leading: ['// Exit 0: chain ok.\n// Exit 1: chain broken.\n', [[0, 'chain ok.'], [1, 'chain broken.']]],
  sentence: ['// Emits JSON on stdout. Exit 0 always (a void is not a failure); exit 2 only on usage.\n',
    [[0, 'always (a void is not a failure)'], [2, 'only on usage.']]],
  usage: ['//   node monitor/t.mjs [--json]   diff vs baseline; exit 0 ok, 1 findings,\n//     2 grey (no baseline)\n//   node monitor/t.mjs --accept   pin it\n',
    [[0, 'ok'], [1, 'findings'], [2, 'grey (no baseline)']]],
  always: ['// EXIT CODE IS ALWAYS 0, DELIBERATELY. It reports.\n', [[0, 'always']]],
};
const FILE = { usage: 'monitor/t.mjs' };

for (const [form, [src, want]] of Object.entries(FORMS)) {
  test(`form ${form}: every code and meaning read`, () => {
    const p = parseHeader(src, FILE[form] || 'bin/t.mjs');
    assert.equal(p.status, 'declared');
    assert.equal(p.form, form);
    assert.deepEqual(codes(p), want);
    assert.equal(p.unparsed, 0);
  });
}

test('separators: equals signs, commas, semicolons and wide gaps; a year is not a code', () => {
  const p = parseHeader('// Exit codes:  0 = pass (ship)   1 = fail; 3 = GREY, measured 2026-10-07\n', 'bin/t.mjs');
  assert.deepEqual(codes(p), [[0, 'pass (ship)'], [1, 'fail'], [3, 'GREY, measured 2026-10-07']]);
});

test('`(exit …)` after a modeless invocation keeps its inner parens and drops the outer one', () => {
  const p = parseHeader('// usage: t.mjs [root]   (exit 0 when one extracted (or more), 1 when none)\n', 'bin/t.mjs');
  assert.deepEqual(codes(p), [[0, 'when one extracted (or more)'], [1, 'when none']]);
});

test('a labelled declaration outranks an unlabelled one in the same header', () => {
  const p = parseHeader('// EXIT 1 IS OVERLOADED upstream.\n//\n// Exit: 0 clean, 1 advisories found\n', 'bin/t.mjs');
  assert.equal(p.form, 'labelled');
  assert.deepEqual(codes(p), [[0, 'clean'], [1, 'advisories found']]);
});

test('an exit clause on one mode, or mid-sentence, is prose or nothing — never a table', () => {
  assert.equal(parseHeader('//   node bin/t.mjs --check   # diff, exit 1 on drift\n', 'bin/t.mjs').status, 'prose');
  assert.equal(parseHeader('//   --check  exit 3 if stale\n', 'bin/t.mjs').status, 'prose');
  assert.equal(parseHeader('// Exit code is 0 for every verdict. It is 2 only for --apply.\n', 'bin/t.mjs').status, 'prose');
  assert.equal(parseHeader('// the roster chain (exit 1 broken) and a tool that exits 3\n', 'bin/t.mjs').status, 'undeclared');
  assert.equal(parseHeader('// nothing here\nconst x = 1; // exit: 0 ok\n', 'bin/t.mjs').status, 'undeclared');
});

// The real tree. The witness is a raw line scan that shares no code with headerLines(): every
// comment line in a file's leading block that opens `exit:` / `exit codes:` with a code must come
// out as a declared table holding that code.
test('the tree: every labelled header line parses, codes are unique, forms are all fixture-covered', () => {
  const { cli, commands } = collect(CW);
  const all = [...cli, ...commands];
  assert.ok(all.length > 0, 'no commands collected');
  const declared = all.filter((c) => c.status === 'declared');
  assert.ok(declared.length > 0, 'no declared commands');
  for (const c of declared) {
    const seen = c.entries.map((e) => e.code);
    assert.equal(new Set(seen).size, seen.length, `${c.name}: duplicate code in ${seen}`);
    for (const e of c.entries) assert.ok(e.meaning, `${c.name}: code ${e.code} has no meaning`);
    assert.equal(c.unparsed, 0, `${c.name}: a declaration yielded no codes`);
    for (const f of c.form.split('+')) assert.ok(f in FORMS, `${c.name}: form ${f} has no fixture`);
  }
  for (const c of commands) {
    const raw = readFileSync(join(CW, c.source), 'utf8').split('\n');
    for (const line of raw) {
      if (line.startsWith('#!')) continue;
      if (!/^\s*(\/\/|\/\*|\*|$)/.test(line)) break;
      const m = line.replace(/^\s*(\/\/|\/\*+|\*)\s?/, '').trim().match(/^exit(?:\s+codes?)?\s*:\s*(\d{1,3})\b/i);
      if (!m) continue;
      assert.equal(c.status, 'declared', `${c.source}: header line not read: ${line.trim()}`);
      assert.ok(c.entries.some((e) => e.code === Number(m[1])), `${c.source}: code ${m[1]} missing`);
    }
  }
});

test('render is deterministic', () => {
  const r = collect(CW);
  assert.equal(render(r), render(r));
});

test('docs/EXIT-CODES.md is current (node bin/exit-codes.mjs regenerates it)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, CW_EXIT_CODES_ROOT: '' } });
  assert.equal(r.status, 0, r.stderr);
});

test('fixture repo: absent → 20, write, byte-identical rerun, stale → 20, usage → 22, no git → 21', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-exit-codes-'));
  try {
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'monitor'));
    writeFileSync(join(root, 'bin', 'a.mjs'), '#!/usr/bin/env node\n// exit: 0 ok · 20 refused\n');
    writeFileSync(join(root, 'bin', 'b.mjs'), '#!/usr/bin/env node\n// does things\n');
    writeFileSync(join(root, 'bin', 'lib.mjs'), '// bin/lib.mjs — a module, not a command\n');
    writeFileSync(join(root, 'bin', 'init.mjs'), '// exit: 0 ready · 2 usage\nexport function runInit() { return 0; }\n');
    writeFileSync(join(root, 'bin', 'commitwork.mjs'), [
      "#!/usr/bin/env node", "import { runInit } from './init.mjs';",
      'function usage() {', '  console.log(`', '  commitwork list    list', '  commitwork init    init', '`);', '}',
      "  if (cmd === 'init') { process.exitCode = runInit(); return; }", '',
    ].join('\n'));
    writeFileSync(join(root, 'monitor', 'm.mjs'), '//   node monitor/m.mjs [--json]   exit 0 ok, 1 findings, 2 grey\n');
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '.']);
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8', env: { ...process.env, CW_EXIT_CODES_ROOT: root } });
    assert.equal(run('--check').status, 20);
    assert.equal(run().status, 0);
    const out = join(root, 'docs', 'EXIT-CODES.md');
    const first = readFileSync(out, 'utf8');
    assert.match(first, /Generated by bin\/exit-codes\.mjs/);
    assert.match(first, /### `commitwork init`\n\nDeclared in `bin\/init\.mjs` \(`runInit`\)/);
    assert.match(first, /Undeclared: `list`\./);
    assert.match(first, /### `bin\/a\.mjs`[\s\S]*\| 20 \| refused \|/);
    assert.match(first, /### `monitor\/m\.mjs`[\s\S]*\| 2 \| grey \|/);
    assert.match(first, /Undeclared: `b\.mjs`\./);
    assert.doesNotMatch(first, /lib\.mjs/);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(out, 'utf8'), first);
    assert.equal(run('--check').status, 0);
    writeFileSync(join(root, 'bin', 'b.mjs'), '#!/usr/bin/env node\n// exit: 0 ok · 2 usage\n');
    assert.equal(run('--check').status, 20);
    assert.equal(run('--nope').status, 22);
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const noGit = run('--check');
    assert.equal(noGit.status, 21, noGit.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a backslash before a pipe in a meaning stays inside its table cell', () => {
  const md = render({ cli: [{ name: 'commitwork x', status: 'declared', entries: [{ code: 2, meaning: 'match a\\|b literally' }] }], commands: [] });
  const row = md.split('\n').find((l) => l.startsWith('| 2 |'));
  assert.equal(row, '| 2 | match a\\\\\\|b literally |');
  // Every pipe left in the row is a cell boundary: three of them, so two cells.
  assert.equal(row.replace(/\\\\/g, '').replace(/\\\|/g, '').split('|').length - 1, 3);
});
