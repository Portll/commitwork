import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { localImportClosure, localImports, markerName } from '../lib/lane-reuse.mjs';
import { runCheckLocal, validateManifest, runsRepoCode } from '../commitwork.mjs';
import { withUnreadable, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = (p) => mkdtempSync(join(tmpdir(), `cw-lane-reuse-run-${p}-`));
const withEnv = (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

describe('runCheckLocal with reuse', () => {
  const setup = (cmdFor) => {
    const repo = tmp('repo');
    writeFileSync(join(repo, 'src.txt'), 'input');
    const counter = join(tmp('counter'), 'n');
    writeFileSync(counter, '');
    const cmd = cmdFor && cmdFor(counter);
    const check = {
      id: 'fixture-pure', egress: 'none', requires: { tools: ['node'] }, report: { file: 'out.json' },
      reuse: { outputs: ['out.json', 'out.json.exit', 'out.log'] },
      local: [cmd || `node -e "const f=require('fs');f.appendFileSync(process.env.CW_TEST_COUNTER,'x');f.writeFileSync(process.env.CW_REPORT_DIR+'/out.json',JSON.stringify({src:f.readFileSync('src.txt','utf8')}))"; echo $? > "$CW_REPORT_DIR/out.json.exit"`],
    };
    return { repo, counter, check, cache: tmp('cache') };
  };
  const run = (s, mode, check = s.check) => {
    const dir = tmp('report');
    const r = withEnv({ CW_REPORT_DIR: dir, CW_LANE_REUSE: mode, CW_LANE_CACHE: s.cache, CW_TEST_COUNTER: s.counter, CW_SANDBOX: 'off' },
      () => runCheckLocal(check, s.repo));
    return { r, dir, runs: readFileSync(s.counter, 'utf8').length };
  };
  const entryDir = (s) => {
    const laneDir = join(s.cache, 'fixture-pure');
    return join(laneDir, readdirSync(laneDir).find((n) => !n.includes('.tmp-') && !n.includes('.old-')));
  };

  test('on: an unchanged tree restores instead of running, marked reused; a changed one runs', () => {
    const s = setup();
    const a = run(s, 'on');
    assert.equal(a.r.status, 'pass');
    assert.equal(a.runs, 1);
    assert.equal(a.r.reused, undefined);
    const b = run(s, 'on');
    assert.equal(b.runs, 1, 'the lane ran although nothing it reads changed');
    assert.equal(b.r.status, 'pass');
    assert.ok(b.r.reused && b.r.reused.from === a.dir, 'the restored result does not say where it came from');
    assert.ok(existsSync(join(b.dir, markerName(s.check))), 'no reuse marker beside the restored outputs');
    assert.equal(readFileSync(join(b.dir, 'out.json'), 'utf8'), readFileSync(join(a.dir, 'out.json'), 'utf8'));
    writeFileSync(join(s.repo, 'src.txt'), 'changed input');
    const c = run(s, 'on');
    assert.equal(c.runs, 2, 'a changed tree was served from the cache');
    assert.equal(c.r.reused, undefined);
    assert.match(readFileSync(join(c.dir, 'out.json'), 'utf8'), /changed input/);
  });

  test('on: an unreadable cached output runs the lane', (t) => {
    if (ignoresPermissions()) { t.skip('running elevated: permissions are not enforced'); return; }
    const s = setup();
    run(s, 'on');
    const w = withUnreadable(join(entryDir(s), 'out.json'), () => run(s, 'on'));
    if (!w.ran) { t.skip(w.why); return; }
    assert.equal(w.value.runs, 2, 'an unreadable cache entry was reused');
    assert.equal(w.value.r.reused, undefined);
  });

  test('on: an output edited in the cache after it was stored runs the lane', () => {
    const s = setup();
    const a = run(s, 'on');
    writeFileSync(join(a.dir, 'out.json'), '{"src":"tampered"}');
    const b = run(s, 'on');
    assert.equal(b.runs, 2, 'a cache entry whose bytes changed was reused');
    assert.match(readFileSync(join(b.dir, 'out.json'), 'utf8'), /"input"/);
  });

  test('an input that moves while the lane runs is not cached', () => {
    const s = setup(() => `node -e "const f=require('fs');f.appendFileSync(process.env.CW_TEST_COUNTER,'x');f.appendFileSync('src.txt','!');f.writeFileSync(process.env.CW_REPORT_DIR+'/out.json','{}')"; echo $? > "$CW_REPORT_DIR/out.json.exit"`);
    run(s, 'on');
    assert.equal(existsSync(join(s.cache, 'fixture-pure')), false, 'a run whose inputs moved was stored');
  });

  test('a lane that runs repository code never reuses', () => {
    // A repository-code lane gets an allowlisted env, so the counter path is in the command itself.
    const s = setup((counter) => `printf x >> '${counter}'; echo '{}' > "$CW_REPORT_DIR/out.json"; echo 0 > "$CW_REPORT_DIR/out.json.exit"`);
    const check = { ...s.check, executesRepoCode: true };
    run(s, 'on', check);
    run(s, 'on', check);
    assert.equal(readFileSync(s.counter, 'utf8').length, 2);
    assert.equal(existsSync(join(s.cache, 'fixture-pure')), false);
  });

  test('verify: every run executes and the match is journalled', () => {
    const s = setup();
    run(s, 'verify');
    const b = run(s, 'verify');
    assert.equal(b.runs, 2, 'verify mode skipped a run');
    assert.equal(b.r.reused, undefined);
    const rows = readFileSync(join(s.cache, 'verify.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].match, true);
    assert.equal(rows[0].check, 'fixture-pure');
  });

  test('off: nothing is cached', () => {
    const s = setup();
    run(s, 'off');
    run(s, 'off');
    assert.equal(existsSync(join(s.cache, 'fixture-pure')), false);
    assert.equal(readFileSync(s.counter, 'utf8').length, 2);
  });

  test('unset: nothing is cached', () => {
    const s = setup();
    run(s, null);
    run(s, null);
    assert.equal(existsSync(join(s.cache, 'fixture-pure')), false);
    assert.equal(readFileSync(s.counter, 'utf8').length, 2);
  });
});

describe('the bundled manifest', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
  const declared = m.checks.filter((c) => c.reuse);
  const ROOT_REF = /\$CW_ROOT\/([A-Za-z0-9._/-]+)/g;
  const OUT_REF = /\$\{?(?:CW_REPORT_DIR|rd)\}?\/([A-Za-z0-9._-]+)/g;
  const LIVE_FETCH = /pack download|--download\b|--updatedb\b|\bcurl\b|\bwget\b|\bnpx\b|git (?:fetch|pull|clone)|npm (?:install|ci)\b|pip install|--update\b|docker pull/;
  // The tool whose locally installed query packs a lane must key, and the store reader each may run.
  const TOOL_PACKS = { codeql: 'codeql', 'joern-scan': 'joern' };
  const STORE_READERS = { 'bin/codeql-model-pack.mjs': 'codeql' };
  const STORE_PATHS = join(ROOT, 'monitor', 'store-paths.mjs');

  test('the reference patterns find what they are for', () => {
    assert.match('codeql pack download codeql/python-queries > log', LIVE_FETCH);
    assert.match('codeql database analyze db --download', LIVE_FETCH);
    assert.match('joern-scan --updatedb', LIVE_FETCH);
    assert.doesNotMatch('codeql database analyze db --format=sarif-latest', LIVE_FETCH);
    const cmd = 'node "$CW_ROOT/bin/x.mjs" > "$CW_REPORT_DIR/a.sarif"; echo $? > "$rd/a.sarif.exit"';
    assert.deepEqual([...cmd.matchAll(ROOT_REF)].map((x) => x[1]), ['bin/x.mjs']);
    assert.deepEqual([...cmd.matchAll(OUT_REF)].map((x) => x[1]), ['a.sarif', 'a.sarif.exit']);
    assert.ok(localImports(join(ROOT, 'bin', 'codeql-model-pack.mjs')).includes(STORE_PATHS), 'the store reader is not seen importing the store');
  });

  test('some lanes declare reuse, and each passes validation', () => {
    assert.ok(declared.length >= 1);
    const v = validateManifest(m, 'security-baseline.json');
    assert.deepEqual(v.errors || [], []);
    assert.deepEqual((v.warnings || []).filter((w) => /reuse/.test(w)), []);
  });

  for (const c of declared) {
    test(`${c.id}: reads no live data, keys every file and pack it runs, keeps every report file`, () => {
      assert.ok(c.egress === 'none' || (c.egress === 'registry' && c.reuse.packs), `${c.id} has egress ${c.egress} with nothing that keys what it fetches`);
      assert.ok(!c.secrets && !(c.requires && c.requires.secrets), `${c.id} takes secrets`);
      assert.equal(runsRepoCode(c), false, `${c.id} runs repository code`);
      const cmd = (c.local || []).join('\n');
      assert.doesNotMatch(cmd, LIVE_FETCH, `${c.id} fetches at run time; reusing it would freeze what it fetches`);
      for (const [, rel] of cmd.matchAll(ROOT_REF)) {
        assert.ok((c.reuse.inputs || []).includes(rel), `${c.id} runs $CW_ROOT/${rel}, which is not a declared input`);
      }
      for (const rel of c.reuse.inputs || []) assert.ok(existsSync(join(ROOT, rel)), `${c.id} declares ${rel}, which does not exist`);
      for (const t of (c.requires && c.requires.tools) || []) {
        if (TOOL_PACKS[t]) assert.equal(c.reuse.packs, TOOL_PACKS[t], `${c.id} runs ${t} without keying its local query packs`);
      }
      // A script that reads a configured store reads content the key holds only through packs.
      const closure = (c.reuse.inputs || []).filter((r) => r.endsWith('.mjs')).flatMap((r) => localImportClosure(join(ROOT, r)));
      for (const f of new Set(closure)) {
        if (f === STORE_PATHS || !localImports(f).includes(STORE_PATHS)) continue;
        const rel = relative(ROOT, f);
        assert.ok(STORE_READERS[rel], `${c.id} runs ${rel}, which reads a configured store that no key covers`);
        assert.equal(c.reuse.packs, STORE_READERS[rel], `${c.id} runs ${rel} without packs ${STORE_READERS[rel]}`);
      }
      const patterns = c.reuse.outputs.map((p) => new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`));
      for (const [, name] of cmd.matchAll(OUT_REF)) {
        if (/-db$/.test(name)) continue;
        assert.ok(patterns.some((re) => re.test(name)), `${c.id} writes ${name} into the report dir, which is not a declared output`);
      }
      assert.ok(c.reuse.outputs.includes(c.report.file));
    });
  }
});
