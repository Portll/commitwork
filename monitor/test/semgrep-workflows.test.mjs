// manifests/semgrep-workflows/ holds rules that only apply under .github/workflows/. They live
// apart from manifests/semgrep-classes/ because their paths.include binds them to that layout, and
// the class fixtures are a flat directory.
// The fixtures carry the same annotations: a `ruleid:` line says the next code line must match,
// an `ok:` line says it must not. Both directions are asserted.
//
// This test SHELLS OUT to semgrep and is skipped, by name and with its reason, when it is absent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RULES = () => process.env.CW_SEMGREP_WORKFLOWS || join(ROOT, 'manifests', 'semgrep-workflows');
const FIXTURES = () => process.env.CW_SEMGREP_WORKFLOWS_FIXTURES || join(ROOT, 'fixtures', 'semgrep-workflows');

const semgrepPresent = () => spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0;
const ruleFiles = () => readdirSync(RULES()).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(RULES(), f));
const ruleIds = (src) => [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);
const posix = (p) => p.split(sep).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** {want, deny}: `relpath:line:rule` keys from the annotations, each bound to the next code line. */
function annotations(dir) {
  const want = new Set(); const deny = new Set();
  for (const f of walk(dir)) {
    const rel = posix(relative(dir, f));
    // A CRLF checkout (core.autocrlf on Windows) leaves \r on each line, and `.` never matches it.
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      const m = l.match(/#\s*(ruleid|ok):\s*(.+)$/);
      if (!m) return;
      let t = i + 1;
      while (t < lines.length && /^\s*#/.test(lines[t])) t++;
      for (const id of m[2].split(',').map((s) => s.trim()).filter(Boolean)) (m[1] === 'ruleid' ? want : deny).add(`${rel}:${t + 1}:${id}`);
    });
  }
  return { want, deny };
}

describe('semgrep workflow rules', () => {
  test('every rule names its CWE and its class, and has a fixture case both ways', () => {
    assert.ok(existsSync(RULES()), `${RULES()} is missing; the sast lane points at it`);
    const { want, deny } = annotations(FIXTURES());
    const ids = [];
    for (const f of ruleFiles()) {
      const src = readFileSync(f, 'utf8');
      const own = ruleIds(src);
      assert.equal([...src.matchAll(/^\s*cwe:\s*\[/gm)].length, own.length, `${f}: every rule names its CWE`);
      assert.equal([...src.matchAll(/^\s*class:\s*\S+/gm)].length, own.length, `${f}: every rule names the class it covers`);
      ids.push(...own);
    }
    assert.ok(ids.length > 0, 'no rules declared');
    for (const id of ids) {
      assert.ok([...want].some((k) => k.endsWith(`:${id}`)), `${id} has no ruleid fixture, so nothing proves it fires`);
      assert.ok([...deny].some((k) => k.endsWith(`:${id}`)), `${id} has no ok fixture, so nothing proves it stays quiet`);
    }
  });

  test('the fixtures match exactly: no annotated case missed, none matched against its annotation, nothing unannotated', (t) => {
    if (!semgrepPresent()) {
      t.skip('SKIPPED (not a silent pass): semgrep is not installed on this machine, so the workflow rules were NOT exercised here');
      return;
    }
    const scratch = mkdtempSync(join(tmpdir(), 'cw-workflows-'));
    const out = join(scratch, 'out.json');
    // Scanned as its own root, as the sast lane scans a repository root: paths.include is relative
    // to the scan target. A copy outside this repository, because semgrep reads .semgrepignore at
    // the git root, and that file excludes fixtures/semgrep-workflows/ from the self-scan.
    const root = join(scratch, 'tree');
    cpSync(FIXTURES(), root, { recursive: true });
    const r = spawnSync('semgrep', ['scan', '--metrics=off', '--quiet', '--json', '--output', out, '--config', RULES(), '.'],
      { cwd: root, encoding: 'utf8', timeout: 600000 });
    assert.ok(existsSync(out), `semgrep wrote no output (exit ${r.status}): ${(r.stderr || '').slice(0, 400)}`);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual((j.errors || []).map((e) => e.message), [], 'semgrep reported errors over the fixtures');
    assert.ok(j.paths.scanned.length > 0, 'semgrep scanned no files: paths.include did not reach the fixtures');
    const got = new Set(j.results.map((x) => `${posix(x.path)}:${x.start.line}:${x.check_id.split('.').pop()}`));
    const { want, deny } = annotations(FIXTURES());
    assert.deepEqual([...want].filter((k) => !got.has(k)), [], 'annotated ruleid cases the rules missed');
    assert.deepEqual([...deny].filter((k) => got.has(k)), [], 'annotated ok cases the rules matched');
    assert.deepEqual([...got].filter((k) => !want.has(k) && !deny.has(k)), [], 'matches with no annotation either way');
  });
});
