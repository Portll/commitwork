// No secret may reach a child process's argv — argv is world-readable to every local user via
// `ps`. The correct pattern is pass-by-name (`-e VAR` with VAR exported; the env object for a
// spawn). This pins the RULE over the whole tree, so the next disguise fails here before shipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'tmp', '.npm-cache', 'evaluations', 'map']);
function walk(dir, exts, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e.startsWith('.') && e !== '.github') continue;
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.endsWith(x))) out.push(p);
  }
  return out;
}

// A secret NAME — catches the shape at the call site, before any value exists.
const SECRET_NAME = '(?:master[-_]?key|api[-_]?key|secret[-_]?key|secret|token|password|passwd|'
  + 'auth[-_]?token|access[-_]?key|private[-_]?key|client[-_]?secret|credential)';

// `-e NAME=<something>` — docker's pass-by-VALUE form. The `=` is the defect.
const DOCKER_E_ASSIGN = new RegExp(`-e\\s+[A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=`, 'i');
// `--token <interpolation>` / `--password=$X` on any command line.
const FLAG_WITH_VALUE = new RegExp(`--?${SECRET_NAME}[= ]+["']?[$\`]`, 'i');

const stripComments = (text, kind) => text.split('\n').map((l) => {
  const t = l.trimStart();
  if (kind === 'sh' && t.startsWith('#')) return '';
  if (kind === 'js' && (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) return '';
  return l;
});

test('no shell script passes a secret by VALUE on a command line', () => {
  const offenders = [];
  for (const f of walk(REPO, ['.sh'])) {
    const lines = stripComments(readFileSync(f, 'utf8'), 'sh');
    lines.forEach((line, i) => {
      if (DOCKER_E_ASSIGN.test(line) || FLAG_WITH_VALUE.test(line)) {
        offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 110)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'a secret is being passed by value on a command line — argv is world-readable via `ps`.\n'
    + 'For docker use pass-by-name (`-e VAR`, no `=`, with VAR exported) as bin/renovate-run.sh does.\n'
    + 'For anything else, hand it to the child\'s ENVIRONMENT or its stdin, never its args.\n'
    + offenders.map((o) => '  ' + o).join('\n'));
});

test('no .mjs pushes a secret-bearing FLAG into a spawn args array', () => {
  // The node-side shape of the same defect: args.push('--token', token).
  const PUSH = new RegExp(`['"\`]--?${SECRET_NAME}['"\`]\\s*,`, 'i');
  const offenders = [];
  for (const f of walk(REPO, ['.mjs'])) {
    if (f.includes(`${'test'}${'/'}`) || f.endsWith('.test.mjs')) continue;
    const lines = stripComments(readFileSync(f, 'utf8'), 'js');
    lines.forEach((line, i) => {
      if (PUSH.test(line)) offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [],
    'a secret flag is being placed in an argv array; pass it via the child\'s env instead:\n'
    + offenders.map((o) => '  ' + o).join('\n'));
});

test('no .mjs interpolates a secret into a SHELL string', () => {
  // execSync(`… ${TOKEN} …`) is the same exposure with an extra layer: the shell sees it too.
  const INTERP = new RegExp(
    `(?:execSync|exec|spawnSync|spawn)\\([^)]*\\$\\{[^}]*${SECRET_NAME}[^}]*\\}`, 'i');
  const offenders = [];
  for (const f of walk(REPO, ['.mjs'])) {
    if (f.endsWith('.test.mjs')) continue;
    const lines = stripComments(readFileSync(f, 'utf8'), 'js');
    lines.forEach((line, i) => {
      if (INTERP.test(line)) offenders.push(`${relative(REPO, f)}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [], 'a secret is interpolated into a shell command string:\n'
    + offenders.map((o) => '  ' + o).join('\n'));
});

// ── the detectors must actually detect ───────────────────────────────────────────────────────
// Each detector is proven against the real pre-fix line it was written for.

test('CONTROL: the detectors catch the real lines they were written for', () => {
  // ci/run-ci.sh, before the fix.
  assert.ok(DOCKER_E_ASSIGN.test('  -e SPRING_DATASOURCE_USERNAME=$CI_DB_USER -e SPRING_DATASOURCE_PASSWORD=$CI_DB_PASS \\'),
    'must catch docker pass-by-value');
  // bin/bola-tokens.sh, before the fix.
  assert.ok(FLAG_WITH_VALUE.test('curl -X POST --password="$2" https://kc/token'),
    'must catch a flag carrying an interpolated value');
  // The stripe process found live on this box.
  assert.ok(FLAG_WITH_VALUE.test('stripe listen --api-key "$STRIPE_KEY"'),
    'must catch --api-key with an interpolation');
  // And the CORRECT forms must NOT trip it, or the rule is unusable.
  assert.equal(DOCKER_E_ASSIGN.test('    -e RENOVATE_TOKEN \\'), false,
    'docker pass-by-NAME is the fix, not the defect — it must not be flagged');
  assert.equal(DOCKER_E_ASSIGN.test('  -e SPRING_DATASOURCE_PASSWORD \\'), false,
    'the post-fix line must not be flagged');
  assert.equal(FLAG_WITH_VALUE.test('  -e TESTCONTAINERS_RYUK_DISABLED=true \\'), false,
    'a non-secret configuration value must not be flagged');
});

test('the two known-good patterns are still in place (so the fix cannot silently regress)', () => {
  // comments are stripped first — a raw-text scan cannot tell code from prose about code
  const codeOf = (p) => stripComments(readFileSync(p, 'utf8'), 'sh').join('\n');

  const rr = join(REPO, 'bin', 'renovate-run.sh');
  if (existsSync(rr)) {
    assert.match(codeOf(rr), /-e\s+RENOVATE_TOKEN\s*\\?\s*$/m,
      'bin/renovate-run.sh must keep passing RENOVATE_TOKEN by NAME (bare -e, no =value)');
  }
  const ci = join(REPO, 'ci', 'run-ci.sh');
  if (existsSync(ci)) {
    const code = codeOf(ci);
    assert.match(code, /-e SPRING_DATASOURCE_PASSWORD\s*\\/,
      'ci/run-ci.sh must keep passing the datasource password by name');
    // report the offending LINE, not the whole file
    const bad = code.split('\n').filter((l) => /-e SPRING_(DATASOURCE|RABBITMQ)_PASSWORD=/.test(l));
    assert.deepEqual(bad, [], `the pass-by-value form came back:\n  ${bad.join('\n  ')}`);
  }
});
