// bin/reference.mjs — the env header forms it reads, known samples from the real tree, a raw-scan
// witness for the env population, docs/REFERENCE.md being current, and the exit contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envDescriptions, collectAll, render, cliDoc } from '../reference.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(CW, 'bin', 'reference.mjs');

test('env header forms: parenthetical, dash, wide gap, =value; bare names and call-time notes give nothing', () => {
  const d = envDescriptions([
    '#!/usr/bin/env node',
    '// tool — x',
    '// env, read at call time: CW_A (the a path), CW_B, CW_C=1 (audit hooks),',
    '//   CW_D (read at call time) — the d store',
    '// output: ignored CW_Z (not env)',
    '// Env:',
    '//   CW_E   seconds to wait. More prose here.',
    'import x from "y";',
  ].join('\n'));
  assert.deepEqual([...d].sort(), [
    ['CW_A', 'the a path'], ['CW_C', 'audit hooks'], ['CW_D', 'the d store'], ['CW_E', 'seconds to wait.'],
  ]);
  assert.equal(d.size, 4);
});

test('the real tree: CW_NOW, the scan subcommand and a known manifest key are found', () => {
  const r = collectAll(CW);
  const now = r.env.find((e) => e.name === 'CW_NOW');
  assert.ok(now && now.how === 'direct' && now.readers.length > 0, 'CW_NOW not found as a direct read');
  assert.ok(r.cli.doc.commands.some((c) => /^commitwork scan\b(?!-)/.test(c.usage) && c.desc), '`commitwork scan` not documented');
  assert.ok(r.cli.doc.options.some((o) => o.usage.startsWith('--manifest')), '--manifest option missing');
  assert.ok(r.cli.exits.some((c) => c.name === 'commitwork scan'), 'scan missing from exit population');
  const id = r.manifest.checkKeys.find((k) => k.key === 'id');
  assert.ok(id && id.uses === r.manifest.checkCount && id.description, 'check key `id` not counted on every check');
  const tools = r.manifest.checkKeys.find((k) => k.key === 'requires.tools');
  assert.ok(tools && tools.uses > 0 && tools.description, 'nested key requires.tools missing');
  const self = r.commands.find((c) => c.name === 'bin/reference.mjs');
  assert.ok(self && self.status === 'declared' && self.usage.length, 'bin/reference.mjs does not document itself');
  assert.equal(render(r), render(r));
});

// A second witness sharing no regex with the collector: split on the literal access prefix.
test('every `process.env.CW_*` in a tracked bin/ or monitor/ module is in the env table', () => {
  const names = new Set(collectAll(CW).env.map((e) => e.name));
  const files = execFileSync('git', ['-C', CW, 'ls-files', '--', 'bin/*.mjs', 'monitor/*.mjs'], { encoding: 'utf8' })
    .split('\n').filter((f) => f && !/(^|\/)test\//.test(f));
  let seen = 0;
  for (const f of files) {
    let src;
    try { src = readFileSync(join(CW, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const piece of src.split('process.env.CW_').slice(1)) {
      let n = 'CW_';
      for (const ch of piece) { if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_') n += ch; else break; }
      while (n.endsWith('_')) n = n.slice(0, -1);
      if (n === 'CW') continue;
      seen++;
      assert.ok(names.has(n), `${f}: ${n} missing from the reference`);
    }
  }
  assert.ok(seen > 100, `witness examined only ${seen} reads`);
});

test('usage(): a start line running into the description column splits at the column', () => {
  const src = [
    "const EXPERIMENTAL_HELP = { 'x': [ '  commitwork x [--f s] does x', '                       more' ] };",
    'function usage() {',
    "  console.log(`${bold('usage')}",
    '  commitwork a [--b <c>] [--d <e>]',
    '                       the a command',
    "${helpInPlace('x')}  commitwork help",
    '',
    "${bold('options')}",
    '  --b <c>      b option',
    '               continued',
    '`);',
    '}',
  ].join('\n');
  const d = cliDoc(src);
  assert.deepEqual(d.commands, [
    { usage: 'commitwork a [--b <c>] [--d <e>]', desc: 'the a command' },
    { usage: 'commitwork x [--f s]', desc: 'does x more' },
    { usage: 'commitwork help', desc: '' },
  ]);
  assert.deepEqual(d.options, [{ usage: '--b <c>', desc: 'b option continued' }]);
});

test('docs/REFERENCE.md is current (node bin/reference.mjs regenerates it)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, CW_REFERENCE_ROOT: '' } });
  assert.equal(r.status, 0, r.stderr);
});

test('fixture repo: absent → 20, write, byte-identical rerun, stale → 20, usage → 22, bad manifest → 21', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-reference-'));
  try {
    for (const d of ['bin', 'manifests', 'schema', 'lib']) mkdirSync(join(root, d));
    writeFileSync(join(root, 'bin', 'a.mjs'), '#!/usr/bin/env node\n// a — does a.\n// usage: node bin/a.mjs [--x]\n// exit: 0 ok · 20 refused\n// env: CW_A_ROOT (the root)\nconst r = process.env.CW_A_ROOT;\n');
    writeFileSync(join(root, 'lib', 'b.mjs'), "const n = 'CW_B_FLAG';\nexport const f = () => process.env[n] || process.env['CW_B_LIMIT'];\n");
    writeFileSync(join(root, 'bin', 'commitwork.mjs'), '#!/usr/bin/env node\nfunction usage() {\n  console.log(`usage\n  commitwork list    list checks\n`);\n}\n');
    writeFileSync(join(root, 'schema', 'manifest.schema.json'), JSON.stringify({ properties: { checks: { items: { properties: { id: { description: 'The id.' }, unused: {} } } } } }));
    writeFileSync(join(root, 'manifests', 'lane.json'), JSON.stringify({ $schema: '../schema/manifest.schema.json', checks: [{ id: 'a', report: { file: 'x' } }, { id: 'b' }] }));
    writeFileSync(join(root, 'manifests', 'other.json'), JSON.stringify({ checks: [{ notALane: 1 }] }));
    execFileSync('git', ['-C', root, 'init', '-q']);
    execFileSync('git', ['-C', root, 'add', '.']);
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8', env: { ...process.env, CW_REFERENCE_ROOT: root } });
    assert.equal(run('--check').status, 20);
    assert.equal(run().status, 0);
    const out = join(root, 'docs', 'REFERENCE.md');
    const first = readFileSync(out, 'utf8');
    assert.match(first, /Generated by bin\/reference\.mjs/);
    assert.match(first, /\| `commitwork list` \| list checks \|/);
    assert.match(first, /### `bin\/a\.mjs`\n\na — does a\.\n\n- Usage: `node bin\/a\.mjs \[--x\]`\n- Exit: 0 ok · 20 refused/);
    assert.match(first, /\| `CW_A_ROOT` \| direct \| `bin\/a\.mjs` \| the root \|/);
    assert.match(first, /\| `CW_B_FLAG` \| indirect \| `lib\/b\.mjs` \| undocumented \|/);
    assert.match(first, /\| `CW_B_LIMIT` \| direct \|/);
    assert.match(first, /\| `id` \| 2 \| The id\. \|/);
    assert.match(first, /\| `report\.file` \| 1 \| undocumented \|/);
    assert.match(first, /\| `unused` \| 0 \| undocumented \|/);
    assert.doesNotMatch(first, /notALane/);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(out, 'utf8'), first);
    assert.equal(run('--check').status, 0);
    writeFileSync(join(root, 'bin', 'a.mjs'), '#!/usr/bin/env node\n// exit: 0 ok\n');
    assert.equal(run('--check').status, 20);
    assert.equal(run('--nope').status, 22);
    writeFileSync(join(root, 'manifests', 'lane.json'), '{ not json');
    const bad = run('--check');
    assert.equal(bad.status, 21, bad.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
