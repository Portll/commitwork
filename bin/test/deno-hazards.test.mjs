// bin/deno-hazards.mjs — every rule fires on fixtures/deno-hazards/dirty, its safe counterpart in
// fixtures/deno-hazards/clean yields ZERO, levels follow context, and adjudication is honoured.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scan, toSarif, RULES, denoInvocations, invocationFindings, specifierFinding, parseJsonc } from '../deno-hazards.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DIRTY = join(ROOT, 'fixtures', 'deno-hazards', 'dirty');
const CLEAN = join(ROOT, 'fixtures', 'deno-hazards', 'clean');

describe('fixture trees', () => {
  test('the clean tree — every safe counterpart — yields ZERO', () => {
    const r = scan(CLEAN);
    assert.deepEqual(r.findings, []);
    assert.ok(r.invocations > 0, 'the clean tree must exercise the command parser, or zero proves nothing');
  });

  test('the dirty tree fires every rule except no-lockfile (lock disabled outranks it there)', () => {
    const r = scan(DIRTY);
    const fired = new Set(r.findings.map((f) => f.ruleId));
    const expected = Object.keys(RULES).filter((id) => id !== 'deno/no-lockfile');
    assert.deepEqual(expected.filter((id) => !fired.has(id)), [], 'rules the dirty tree did not fire');
  });

  test('levels follow context: -A is an error in production, a warning in CI, a note on deno test', () => {
    const r = scan(DIRTY);
    const allAll = r.findings.filter((f) => f.ruleId === 'deno/allow-all');
    const at = (path, line) => allAll.find((f) => f.path === path && f.line === line)?.level;
    assert.equal(at('Dockerfile', 3), 'error');
    assert.equal(at('main.ts', 1), 'error', 'a -A shebang is the production entrypoint');
    assert.equal(at('.github/workflows/ci.yml', 7), 'warning');
    assert.equal(at('.github/workflows/ci.yml', 8), 'note', 'deno test -A is how most suites run');
    assert.equal(at('deploy/site.service', 3), 'error', 'a systemd ExecStart is a production entrypoint');
    assert.equal(at('deno.jsonc', 10), 'note', 'a watching dev server is development');
  });

  test('cw-hazards-ignore in the comment block above suppresses, and is counted rather than dropped', () => {
    const r = scan(DIRTY);
    assert.equal(r.findings.some((f) => f.path === '.github/workflows/ci.yml' && f.line === 10), false);
    assert.equal(r.suppressed.length, 1);
    assert.match(r.suppressed[0].justification, /release smoke test/);
    assert.equal(toSarif(r).runs[0].properties.suppressedCount, 1);
  });

  test('remote imports with no deno.lock are named; adding one downgrades unpinned specifiers to notes', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-deno-haz-'));
    writeFileSync(join(d, 'deno.json'), JSON.stringify({ imports: { oak: 'https://deno.land/x/oak/mod.ts' } }));
    let r = scan(d);
    assert.ok(r.findings.some((f) => f.ruleId === 'deno/no-lockfile'));
    assert.equal(r.findings.find((f) => f.ruleId === 'deno/unpinned-import').level, 'warning');
    writeFileSync(join(d, 'deno.lock'), '{"version":"4"}');
    r = scan(d);
    assert.equal(r.findings.some((f) => f.ruleId === 'deno/no-lockfile'), false);
    assert.equal(r.findings.find((f) => f.ruleId === 'deno/unpinned-import').level, 'note');
  });

  test('a tree with no Deno at all writes NO sarif, so the lane reads not-scanned rather than clean', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-deno-none-'));
    mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src', 'a.js'), 'console.log(1)\n');
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'deno-hazards.mjs'), d, '--sarif'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /writing NO sarif/);
  });
});

describe('parsers', () => {
  test('deno invocations are read out of compound shell lines and exec-form arrays', () => {
    const inv = denoInvocations('cd app && deno run --allow-net=:8000 -A main.ts && echo done');
    assert.equal(inv.length, 1);
    assert.equal(inv[0].sub, 'run');
    assert.equal(inv[0].target, 'main.ts');
    assert.deepEqual(inv[0].flags.map((f) => f.name), ['--allow-net', '-A']);
    assert.equal(denoInvocations('deno fmt && deno lint').length, 0, 'fmt/lint run no program');
  });

  test('a scoped grant is quiet; the same grant unscoped, or naming a shell, is not', () => {
    const f = (cmd) => invocationFindings(denoInvocations(cmd)[0], 'prod').map((x) => x.ruleId);
    assert.deepEqual(f('deno run --allow-run=git main.ts'), []);
    assert.deepEqual(f('deno run --allow-run main.ts'), ['deno/allow-run-unscoped']);
    assert.deepEqual(f('deno run --allow-run=/usr/bin/bash main.ts'), ['deno/allow-run-shell']);
    assert.deepEqual(f('deno run --inspect=127.0.0.1:9229 main.ts'), []);
    assert.deepEqual(f('deno run --inspect=0.0.0.0:9229 main.ts'), ['deno/inspector-exposed']);
  });

  test('a TLS bypass scoped to loopback is a note; scoped elsewhere or unscoped it keeps its level and says which hosts', () => {
    const g = (cmd) => invocationFindings(denoInvocations(cmd)[0], 'prod').map((x) => `${x.ruleId} ${x.level} ${x.detail}`);
    assert.deepEqual(g('deno run --allow-net=127.0.0.1:54331 --unsafely-ignore-certificate-errors=127.0.0.1,localhost main.ts'),
      ['deno/ignore-certificate-errors note deno run, only for 127.0.0.1, localhost (loopback)']);
    assert.deepEqual(g('deno run --allow-net=db.internal --unsafely-ignore-certificate-errors=127.0.0.1,db.internal main.ts'),
      ['deno/ignore-certificate-errors error deno run, for 127.0.0.1, db.internal']);
    assert.deepEqual(g('deno run --allow-net=db.internal --unsafely-ignore-certificate-errors main.ts'),
      ['deno/ignore-certificate-errors error deno run, every host']);
  });

  test('-A with --deny-* keeps its level but names what the denies took back', () => {
    const [x] = invocationFindings(denoInvocations('deno run -A --deny-run --deny-ffi --deny-write main.ts')[0], 'prod');
    assert.equal(x.ruleId, 'deno/allow-all');
    assert.equal(x.level, 'error');
    assert.equal(x.detail, 'deno run main.ts; taken back: --deny-run --deny-ffi --deny-write');
  });

  test('specifiers: pinned forms are quiet, every floating form is named', () => {
    for (const s of ['jsr:@std/path@^1.0.8', 'npm:chalk@5.4.1', 'https://deno.land/x/oak@v17.1.4/mod.ts', 'https://esm.sh/react@19.0.0', 'https://deno.land/std@0.224.0/path/mod.ts', 'http://localhost:8000/dev.ts']) {
      assert.equal(specifierFinding(s, false), null, s);
    }
    for (const s of ['jsr:@std/path', 'npm:chalk', 'https://deno.land/x/oak/mod.ts', 'https://deno.land/std/path/mod.ts', 'https://esm.sh/react', 'https://raw.githubusercontent.com/o/r/main/mod.ts']) {
      assert.equal(specifierFinding(s, false)?.ruleId, 'deno/unpinned-import', s);
    }
    assert.equal(specifierFinding('http://cdn.example.com/x.ts', true).ruleId, 'deno/cleartext-import');
  });

  test('JSONC: comments and trailing commas go, strings containing // and /* stay', () => {
    const j = parseJsonc('{\n // c\n "a": "http://x/*y*/", /* b */ "b": [1,2,],\n}');
    assert.deepEqual(j, { a: 'http://x/*y*/', b: [1, 2] });
  });
});
