// The Deno rule packs (manifests/semgrep-deno-*/) against their annotated fixtures, through the
// lane's own scan path — bin/deno-sast.mjs, so type-argument erasure and the engine flags are the
// ones the lane uses, not a test-only invocation. `ruleid:` means the next code line must match,
// `ok:` that it must not; both directions are asserted, because a rule that stops firing reads
// exactly like clean code.
//
// The engine runs are SKIPPED, by name and with the reason, when opengrep is absent. The structural
// checks (every rule names a class and a CWE where required, and has a fixture both ways) need no
// engine and always run.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PACK = (p) => join(ROOT, 'manifests', `semgrep-deno-${p}`);
const FIX = (p) => join(ROOT, 'fixtures', 'semgrep-deno', p);
const opengrep = () => process.env.CW_OPENGREP || 'opengrep';
const enginePresent = () => spawnSync(opengrep(), ['--version'], { encoding: 'utf8' }).status === 0;
const ruleIds = (src) => [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);

export function annotations(dir) {
  const want = new Set(); const deny = new Set();
  for (const f of readdirSync(dir)) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/\/\/\s*(ruleid|ok):\s*(.+)$/);
      if (!m) return;
      let t = i + 1;
      while (t < lines.length && /^\s*\/\//.test(lines[t])) t++;
      for (const id of m[2].split(',').map((s) => s.trim()).filter(Boolean)) (m[1] === 'ruleid' ? want : deny).add(`${f}:${t + 1}:${id}`);
    });
  }
  return { want, deny };
}

function scan(pack, extra = []) {
  const out = join(mkdtempSync(join(tmpdir(), 'cw-deno-test-')), 'out.sarif');
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'deno-sast.mjs'), FIX(pack), '--pack', pack, '--sarif', out, ...extra],
    { encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, `deno-sast exited ${r.status}: ${r.stderr}`);
  return { doc: JSON.parse(readFileSync(out, 'utf8')), dir: dirname(out) };
}

const keyOf = (res) => {
  const l = res.locations[0].physicalLocation;
  return `${basename(l.artifactLocation.uri)}:${l.region.startLine}:${String(res.ruleId).split('.').pop()}`;
};

for (const pack of ['security', 'reliability']) {
  describe(`semgrep-deno-${pack}`, () => {
    test('every rule is documented, classed, CWE-tagged, and has a fixture case both ways', () => {
      const { want, deny } = annotations(FIX(pack));
      const ids = [];
      for (const f of readdirSync(PACK(pack)).filter((n) => /\.ya?ml$/.test(n))) {
        const src = readFileSync(join(PACK(pack), f), 'utf8');
        const own = ruleIds(src);
        assert.equal([...src.matchAll(/^\s+class:\s*\S+/gm)].length, own.length, `${f}: every rule names its class`);
        assert.equal([...src.matchAll(/^\s+cwe:\s*\[/gm)].length, own.length, `${f}: every rule names its CWE`);
        assert.doesNotMatch(src, /^\s*interfile:\s*true/m, `${f}: interfile taint is not evaluated by the lane's engine`);
        ids.push(...own);
      }
      assert.ok(ids.length > 0);
      for (const id of ids) {
        assert.ok([...want].some((k) => k.endsWith(`:${id}`)), `${id} has no ruleid fixture, so nothing proves it fires`);
        assert.ok([...deny].some((k) => k.endsWith(`:${id}`)), `${id} has no ok fixture, so nothing proves it stays quiet`);
      }
    });

    test('the fixtures match exactly through bin/deno-sast.mjs', (t) => {
      if (!enginePresent()) { t.skip('SKIPPED (not a silent pass): opengrep is not installed, so the Deno packs were NOT exercised here'); return; }
      const { doc } = scan(pack);
      const run = doc.runs[0];
      assert.equal(run.properties.cwEngine.name, 'opengrep');
      assert.equal(run.properties.cwPack, pack);
      const got = new Set(run.results.map(keyOf));
      const { want, deny } = annotations(FIX(pack));
      assert.deepEqual([...want].filter((k) => !got.has(k)), [], 'annotated ruleid cases the rules missed');
      assert.deepEqual([...deny].filter((k) => got.has(k)), [], 'annotated ok cases the rules matched');
      assert.deepEqual([...got].filter((k) => !want.has(k) && !deny.has(k)), [], 'matches with no annotation either way');
      assert.equal(run.results.length, got.size, 'one result per annotated case — a rule reporting one line twice is a duplicate');
    });
  });
}

describe('type-argument erasure is load-bearing', () => {
  test('a typed kv.get<T>() read-modify-write is found only because the mirror erased <T>', (t) => {
    if (!enginePresent()) { t.skip('SKIPPED (not a silent pass): opengrep is not installed'); return; }
    const { doc } = scan('security');
    const props = doc.runs[0].properties.cwMirror;
    assert.ok(props.typeArgsErased.sites >= 1, 'the fixture has typed calls; the mirror must have erased them');
    assert.ok(doc.runs[0].results.some((r) => keyOf(r) === 'races-constructs.ts:13:cw-deno-kv-read-modify-write'),
      'the typed read-modify-write (kv.get<number>) must be reported — both engines drop typed calls from the AST without erasure');
  });
});

describe('the DFD pass: one path per sender-control class', () => {
  test('bounded.ts paths are graded exactly as annotated', (t) => {
    if (!enginePresent()) { t.skip('SKIPPED (not a silent pass): opengrep is not installed'); return; }
    const outPrefix = join(mkdtempSync(join(tmpdir(), 'cw-deno-dfd-')), 'dfd');
    const out = `${outPrefix}.sarif`;
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'deno-sast.mjs'), FIX('dfd'), '--pack', 'security', '--sarif', out, '--dfd', outPrefix], { encoding: 'utf8', timeout: 600000 });
    assert.equal(r.status, 0, r.stderr);
    const lines = readFileSync(join(FIX('dfd'), 'bounded.ts'), 'utf8').split('\n');
    const want = new Map();
    lines.forEach((l, i) => { const m = l.match(/^\s*\/\/\s*control:\s*([\w-]+)\s*$/); if (m) want.set(i + 2, m[1]); });
    assert.ok(want.size >= 7, 'the fixture names one path per class');
    const report = JSON.parse(readFileSync(`${outPrefix}.json`, 'utf8'));
    const got = new Map(report.findings.map((f) => [f.line, f.evaluation.control]));
    for (const [line, cls] of want) assert.equal(got.get(line), cls, `bounded.ts:${line}`);
    assert.ok(existsSync(`${outPrefix}.md`));
    // The SARIF result carries the same verdict, so it reaches the lane's rows.
    const sarif = JSON.parse(readFileSync(out, 'utf8'));
    for (const res of sarif.runs[0].results.filter((x) => x.codeFlows)) {
      assert.ok(res.properties && res.properties.cwMutability && res.properties.cwMutability.control, `${keyOf(res)} carries cwMutability`);
    }
  });
});
