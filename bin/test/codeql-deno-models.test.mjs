// manifests/codeql-models/javascript/deno.model.yml, and the shipped-models half of
// bin/codeql-model-pack.mjs. The structural checks always run. The CodeQL run — which proves the
// rows bind and produce paths a model-less run does not — is SKIPPED by name when codeql is absent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { shippedModelFiles, mergedModelFiles, buildPack } from '../codeql-model-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MODEL = join(ROOT, 'manifests', 'codeql-models', 'javascript', 'deno.model.yml');

// The kinds the JavaScript queries read from models (ModelOutput::sinkNode/sourceNode call sites
// in codeql/javascript-all at github/codeql 94cb719). A row with a kind outside this set binds and
// is read by nothing — a model that looks like coverage and is not.
const SINK_KINDS = new Set(['code-injection', 'command-injection', 'cors-origin', 'html-injection', 'log-injection', 'nosql-injection', 'path-injection', 'request-forgery', 'sql-injection', 'unsafe-deserialization', 'url-redirection']);
const SOURCE_KINDS = new Set(['remote', 'environment', 'commandargs', 'stdin', 'file', 'database', 'local']);

/** The `data:` rows of each extension block, without a YAML dependency: rows are one-line arrays. */
function blocks(text) {
  const out = [];
  for (const part of text.split(/^\s*-\s*addsTo:/m).slice(1)) {
    const ext = part.match(/extensible:\s*(\w+)/)[1];
    const rows = [...part.matchAll(/^\s*-\s*(\[.*\])\s*$/gm)].map((m) => JSON.parse(m[1]));
    out.push({ ext, rows });
  }
  return out;
}

describe('the Deno model file', () => {
  const bs = blocks(readFileSync(MODEL, 'utf8'));
  test('every row has the column count its predicate takes, and every kind is one a query reads', () => {
    assert.ok(bs.length >= 3);
    for (const { ext, rows } of bs) {
      assert.ok(rows.length > 0, `${ext} block is empty`);
      for (const r of rows) {
        if (ext === 'sinkModel') { assert.equal(r.length, 3); assert.ok(SINK_KINDS.has(r[2]), `sink kind ${r[2]}`); }
        else if (ext === 'sourceModel') { assert.equal(r.length, 3); assert.ok(SOURCE_KINDS.has(r[2]), `source kind ${r[2]}`); }
        else if (ext === 'summaryModel') { assert.equal(r.length, 5); assert.ok(['taint', 'value'].includes(r[4])); }
        else assert.fail(`unexpected extensible ${ext}`);
      }
    }
  });

  test('the Deno global is modelled as a source and as a sink', () => {
    const rows = bs.flatMap((b) => b.rows.map((r) => [b.ext, ...r]));
    assert.ok(rows.some(([e, t, p]) => e === 'sourceModel' && t === 'global' && p.startsWith('Member[Deno].Member[serve]')));
    assert.ok(rows.some(([e, t, p, k]) => e === 'sinkModel' && t === 'global' && p === 'Member[Deno].Member[Command].Argument[0]' && k === 'command-injection'));
  });
});

describe('shipped models join the pack', () => {
  test('shipped files are prefixed, target the language library, and lose a name clash to the repository', () => {
    const shipped = shippedModelFiles('javascript-typescript');
    assert.deepEqual(shipped.map((f) => f.name), ['shipped-deno.model.yml']);
    assert.deepEqual(shippedModelFiles('python'), [], 'a JavaScript model never reaches another language');
    const repo = [{ name: 'shipped-deno.model.yml', text: 'override' }, { name: 'own.yml', text: 'x' }];
    const merged = mergedModelFiles(repo, shipped);
    assert.equal(merged.find((f) => f.name === 'shipped-deno.model.yml').text, 'override');
    assert.equal(merged.length, 2);
    const out = mkdtempSync(join(tmpdir(), 'cw-cq-pack-'));
    const pack = buildPack(shipped, 'repo', 'javascript-typescript', out);
    assert.deepEqual(readdirSync(join(pack.dir, 'models')), ['shipped-deno.model.yml']);
  });
});

describe('CodeQL binds the rows and finds what it could not', () => {
  test('a Deno server: zero results without the models, paths with them', (t) => {
    if (spawnSync('codeql', ['version'], { encoding: 'utf8' }).status !== 0) {
      t.skip('SKIPPED (not a silent pass): codeql is not installed, so the Deno models were NOT exercised against the engine here');
      return;
    }
    const work = mkdtempSync(join(tmpdir(), 'cw-cq-deno-'));
    const src = join(work, 'src'); mkdirSync(src);
    writeFileSync(join(src, 'server.ts'), [
      'Deno.serve(async (req) => {',
      '  const tool = new URL(req.url).searchParams.get("tool") ?? "true";',
      '  await new Deno.Command(tool).output();',
      '  const f = req.headers.get("x-file") ?? "";',
      '  return new Response(await Deno.readTextFile(f));',
      '});', ''].join('\n'));
    const db = join(work, 'db');
    assert.equal(spawnSync('codeql', ['database', 'create', db, '--language=javascript-typescript', `--source-root=${src}`, '--overwrite'], { encoding: 'utf8', timeout: 900000 }).status, 0);
    const analyze = (extra, out) => {
      const r = spawnSync('codeql', ['database', 'analyze', db, ...extra, '--format=sarif-latest', `--output=${out}`, '--rerun'], { encoding: 'utf8', timeout: 1800000 });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(readFileSync(out, 'utf8')).runs[0].results.map((x) => x.ruleId).sort();
    };
    const before = analyze([], join(work, 'before.sarif'));
    const packs = join(work, 'packs');
    const pack = buildPack(shippedModelFiles('javascript-typescript'), 'src', 'javascript-typescript', packs);
    const after = analyze(['--additional-packs', packs, '--model-packs', pack.name], join(work, 'after.sarif'));
    assert.deepEqual(before, [], 'CodeQL alone knows no Deno API');
    assert.ok(after.includes('js/command-line-injection'), `with models: ${after.join(', ')}`);
    assert.ok(after.includes('js/path-injection'), `with models: ${after.join(', ')}`);
  });
});
