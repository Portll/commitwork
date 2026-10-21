// manifests/semgrep-classes/ holds pattern rules the free engine evaluates, keyed on the shape of a
// vulnerability class rather than on a library. The fixtures carry semgrep-style annotations: a
// `ruleid:` line says the next code line must match, an `ok:` line says it must not. Both
// directions are asserted, because a rule that stops firing reads exactly like clean code.
//
// This test SHELLS OUT to semgrep and is skipped, by name and with its reason, when it is absent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RULES = () => process.env.CW_SEMGREP_CLASSES || join(ROOT, 'manifests', 'semgrep-classes');
const FIXTURES = () => process.env.CW_SEMGREP_CLASSES_FIXTURES || join(ROOT, 'fixtures', 'semgrep-classes');

const semgrepPresent = () => spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0;
const ruleFiles = () => readdirSync(RULES()).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(RULES(), f));
const ruleIds = (src) => [...src.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1]);

/** {want, deny}: `file:line:rule` keys from the annotations, each bound to the next code line. */
export function annotations(dir) {
  const want = new Set(); const deny = new Set();
  for (const f of readdirSync(dir)) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/(?:\/\/|#)\s*(ruleid|ok):\s*(.+)$/);
      if (!m) return;
      let t = i + 1;
      while (t < lines.length && /^\s*(?:\/\/|#)/.test(lines[t])) t++;
      for (const id of m[2].split(',').map((s) => s.trim()).filter(Boolean)) (m[1] === 'ruleid' ? want : deny).add(`${f}:${t + 1}:${id}`);
    });
  }
  return { want, deny };
}

describe('semgrep class rules', () => {
  test('every rule is a pattern rule with a class and a CWE, and every rule has a fixture case both ways', () => {
    assert.ok(existsSync(RULES()), `${RULES()} is missing; the sast lane points at it`);
    const { want, deny } = annotations(FIXTURES());
    const ids = [];
    for (const f of ruleFiles()) {
      const src = readFileSync(f, 'utf8');
      assert.doesNotMatch(src, /^\s*mode:\s*taint/m, `${basename(f)}: taint rules that need the Pro engine belong in manifests/semgrep-taint/`);
      const own = ruleIds(src);
      assert.equal([...src.matchAll(/^\s*class:\s*\S+/gm)].length, own.length, `${basename(f)}: every rule names the class it covers`);
      assert.equal([...src.matchAll(/^\s*cwe:\s*\[/gm)].length, own.length, `${basename(f)}: every rule names its CWE`);
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
      t.skip('SKIPPED (not a silent pass): semgrep is not installed on this machine, so the class rules were NOT exercised here');
      return;
    }
    const out = join(mkdtempSync(join(tmpdir(), 'cw-classes-')), 'out.json');
    const r = spawnSync('semgrep', ['scan', '--metrics=off', '--quiet', '--json', '--output', out, '--config', RULES(), FIXTURES()],
      { encoding: 'utf8', timeout: 600000 });
    assert.ok(existsSync(out), `semgrep wrote no output (exit ${r.status}): ${(r.stderr || '').slice(0, 400)}`);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual((j.errors || []).map((e) => e.message), [], 'semgrep reported errors over the fixtures');
    const got = new Set(j.results.map((x) => `${basename(x.path)}:${x.start.line}:${x.check_id.split('.').pop()}`));
    const { want, deny } = annotations(FIXTURES());
    assert.deepEqual([...want].filter((k) => !got.has(k)), [], 'annotated ruleid cases the rules missed');
    assert.deepEqual([...deny].filter((k) => got.has(k)), [], 'annotated ok cases the rules matched');
    assert.deepEqual([...got].filter((k) => !want.has(k) && !deny.has(k)), [], 'matches with no annotation either way');
  });
});
