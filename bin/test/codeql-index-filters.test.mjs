// bin/codeql-index-filters.mjs, and the fragment every sast-codeql* lane builds LGTM_INDEX_FILTERS with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFilterText } from '../codeql-index-filters.mjs';
import { withUnreadable, ignoresPermissions } from '../../lib/fs-unreadable.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'codeql-index-filters.mjs');
const FILTERS = '# header\n\n  # indented comment\n   \nexclude:reports\ninclude:reports/keep\n';
const RULES = ['exclude:reports', 'include:reports/keep'];
const SH = process.platform === 'win32' ? null : '/bin/sh';
const FRAGMENT = /(?:^|[;\s])(LGTM_INDEX_FILTERS="\$\(node "\$CW_ROOT\/bin\/codeql-index-filters\.mjs" "\$CW_ROOT\/manifests\/codeql-filters\.txt"\)" \|\| \{ echo "([^"]*)" >&2; exit 1; \}; export LGTM_INDEX_FILTERS;)/g;

const scratch = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cqif-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
};
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const lanes = () => JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'))
  .checks.filter((c) => /^sast-codeql/.test(c.id));
const fragmentOf = (c) => [...(c.local || []).join('\n').matchAll(FRAGMENT)];

function root(t, filters) {
  const d = scratch(t);
  mkdirSync(join(d, 'bin')); mkdirSync(join(d, 'lib')); mkdirSync(join(d, 'manifests'));
  copyFileSync(CLI, join(d, 'bin', 'codeql-index-filters.mjs'));
  copyFileSync(join(CW, 'lib', 'is-main.mjs'), join(d, 'lib', 'is-main.mjs'));
  if (filters !== null) writeFileSync(join(d, 'manifests', 'codeql-filters.txt'), filters);
  return d;
}
const sh = (fragment, cwRoot, PATH) => spawnSync(SH, ['-c', `${fragment} printf 'REACHED:%s' "$LGTM_INDEX_FILTERS"`],
  { encoding: 'utf8', env: { PATH, CW_ROOT: cwRoot } });
const withNode = `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`;

test('parseFilterText: comments and blank lines go, rules stay verbatim, every \\r is stripped', () => {
  assert.deepEqual(parseFilterText(FILTERS), RULES);
  const out = parseFilterText(FILTERS.replace(/\n/g, '\r\n'));
  assert.deepEqual(out, RULES, 'a CRLF checkout must yield the same rules');
  assert.ok(out.every((l) => !l.includes('\r')), 'no rule may carry a \\r, which the extractor rejects');
  assert.deepEqual(parseFilterText(''), []);
});

test('the CLI prints the rules of a CRLF file with no \\r and exits 0', (t) => {
  const d = scratch(t);
  writeFileSync(join(d, 'filters.txt'), FILTERS.replace(/\n/g, '\r\n'));
  const r = run([join(d, 'filters.txt')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, RULES.join('\n') + '\n');
  assert.ok(!r.stdout.includes('\r'));
});

test('an absent filter file exits 1 with NOTHING on stdout; no argument is usage, exit 2', (t) => {
  const d = scratch(t);
  const r = run([join(d, 'absent.txt')]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '', 'an empty filter would index unbounded; the lane must see a failure, not a value');
  assert.match(r.stderr, /cannot read .*absent\.txt: ENOENT/);
  assert.equal(run([]).status, 2);
});

test('an unreadable filter file exits 1 with NOTHING on stdout', (t) => {
  if (ignoresPermissions()) return t.skip('elevated process ignores read permissions');
  const d = scratch(t);
  const f = join(d, 'filters.txt');
  writeFileSync(f, FILTERS);
  const res = withUnreadable(f, () => run([f]));
  if (!res.ran) return t.skip(res.why);
  assert.equal(res.value.status, 1);
  assert.equal(res.value.stdout, '');
  assert.match(res.value.stderr, /cannot read .*filters\.txt: (EACCES|EPERM)/);
});

test('every sast-codeql* lane assigns from the tool, refuses on its failure, then exports', () => {
  const cs = lanes();
  assert.equal(cs.length, 9, 'nine CodeQL lanes');
  for (const c of cs) {
    const cmd = (c.local || []).join('\n');
    const m = fragmentOf(c);
    assert.equal(m.length, 1, `${c.id}: exactly one LGTM_INDEX_FILTERS fragment of the refusing shape`);
    assert.match(m[0][2], new RegExp(`^${c.id}: REFUSED to index unbounded `), `${c.id}: the refusal names its own lane`);
    assert.doesNotMatch(cmd, /export LGTM_INDEX_FILTERS=/, `${c.id}: export must not wrap the substitution, it hides the status`);
    assert.doesNotMatch(cmd, /sed [^;]*codeql-filters\.txt/, `${c.id}: sed keeps the \\r of a CRLF checkout`);
  }
});

test('each lane fragment exports the CRLF file\'s rules with no \\r', (t) => {
  if (!SH || !existsSync(SH)) return t.skip('the lane fragment is POSIX sh');
  const d = root(t, FILTERS.replace(/\n/g, '\r\n'));
  for (const c of lanes()) {
    const r = sh(fragmentOf(c)[0][1], d, withNode);
    assert.equal(r.status, 0, `${c.id}: ${r.stderr}`);
    assert.equal(r.stdout, `REACHED:${RULES.join('\n')}`, `${c.id} exported value`);
  }
});

test('each lane fragment exits 1 before indexing when node is absent or the filter file is', (t) => {
  if (!SH || !existsSync(SH)) return t.skip('the lane fragment is POSIX sh');
  const noNode = scratch(t);
  const present = root(t, FILTERS);
  const absent = root(t, null);
  for (const c of lanes()) {
    const frag = fragmentOf(c)[0][1];
    for (const [why, cwRoot, PATH] of [['node absent from PATH', present, noNode], ['filter file absent', absent, withNode]]) {
      const r = sh(frag, cwRoot, PATH);
      assert.equal(r.status, 1, `${c.id}, ${why}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /REACHED/, `${c.id}, ${why}: the lane went on to index`);
      assert.match(r.stderr, new RegExp(`${c.id}: REFUSED to index unbounded`), `${c.id}, ${why}: the refusal is said`);
    }
  }
});

test('a filter file with no rule exits 1 with NOTHING on stdout, and each lane fragment refuses before indexing', (t) => {
  const commentOnly = '# one\n\n  # two\n   \n';
  const d = scratch(t);
  for (const [name, text] of [['comments', commentOnly], ['crlf', commentOnly.replace(/\n/g, '\r\n')], ['empty', '']]) {
    const f = join(d, `${name}.txt`);
    writeFileSync(f, text);
    const r = run([f]);
    assert.equal(r.status, 1, `${name}: ${r.stderr}`);
    assert.equal(r.stdout, '', `${name}: an empty filter would index unbounded`);
    assert.match(r.stderr, /REFUSED: .* holds no rule/, name);
  }
  if (!SH || !existsSync(SH)) return t.skip('the lane fragment is POSIX sh');
  const cwRoot = root(t, commentOnly);
  for (const c of lanes()) {
    const r = sh(fragmentOf(c)[0][1], cwRoot, withNode);
    assert.equal(r.status, 1, `${c.id}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /REACHED/, `${c.id}: the lane went on to index`);
    assert.match(r.stderr, /REFUSED: .*codeql-filters\.txt holds no rule/, `${c.id}: the tool names the cause`);
    assert.match(r.stderr, new RegExp(`${c.id}: REFUSED to index unbounded`), `${c.id}: the refusal is said`);
  }
});
