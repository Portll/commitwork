// Every lane command in every bundled manifest, parsed by the shell that will run it.
//
// A manifest `local` entry is an intentional POSIX shell one-liner living inside a JSON string, so
// nothing checks it until a lane runs — and a lane only runs where its tool, its language gate and
// its platform all line up. A quoting slip in a lane nobody on this box can trigger ships, and the
// first person to meet it is a user on another platform with a different toolchain, who sees the
// shell's complaint and not the manifest. The 114 bundled commands are checked here instead, in
// one pass, with no tool installed and nothing executed: `-n` parses and exits.
//
// This parses; it does not run. A command that parses can still be wrong — an unquoted `$(…)`
// whose word-splitting is load-bearing parses exactly as well as one where it is a mistake — so
// this is a floor under the lane commands and not a proof of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellPlan } from '../../lib/posix-shell.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFESTS = join(CW, 'manifests');

/** Every { manifest, id, key, index, cmd } a bundled manifest declares as a shell command. */
function laneCommands() {
  const out = [];
  for (const name of readdirSync(MANIFESTS).filter((n) => n.endsWith('.json')).sort()) {
    let doc;
    // A manifest this cannot parse is a failure of its own, reported by name — never skipped,
    // which would quietly shrink the population this test is about.
    try { doc = JSON.parse(readFileSync(join(MANIFESTS, name), 'utf8')); }
    catch (e) { out.push({ manifest: name, id: '(whole file)', key: 'json', index: 0, cmd: null, parseError: e.message }); continue; }
    for (const check of Array.isArray(doc.checks) ? doc.checks : []) {
      (Array.isArray(check.local) ? check.local : []).forEach((cmd, index) => {
        if (typeof cmd === 'string') out.push({ manifest: name, id: check.id || '(unnamed)', key: 'local', index, cmd });
      });
    }
  }
  return out;
}

/** The shell's own verdict on one command, or null when it parses. Uses the lane's spawn plan, so
 *  this asks the shell that would RUN the command rather than one chosen here. */
function syntaxError(cmd) {
  const plan = shellPlan(cmd);
  if (plan.kind === 'argv') return null;             // argv-direct: no shell parses it
  if (plan.kind === 'no-shell') return null;         // no shell on this box; the runner says so already
  const r = spawnSync(plan.shell.path, ['-n'], { input: cmd, encoding: 'utf8', timeout: 30_000 });
  if (r.error) return `could not run ${plan.shell.path} -n: ${r.error.message}`;
  return r.status === 0 ? null : String(r.stderr || '').trim() || `exited ${r.status}`;
}

test('the checker rejects a command the shell cannot parse, in each shape that has shipped', () => {
  // Asserted FIRST and separately: a checker that returns null for everything would report every
  // manifest clean, which is the same output as a correct one over a correct tree.
  for (const broken of [
    'echo "unterminated',                                      // an unbalanced quote
    'test -r x || { echo nope >&2; exit 1 ',                    // a brace group left open
    'for f in a b; do echo $f',                                 // an unterminated loop
    'codeql database analyze "$DB" $(node pack.mjs python --format=sarif-latest',  // an unclosed substitution
  ]) {
    assert.ok(syntaxError(broken), `the checker passed ${JSON.stringify(broken)}`);
  }
  assert.equal(syntaxError('echo "ok"; exit 0'), null, 'and it passes a command that is fine');
});

test('every bundled lane command parses', () => {
  const cmds = laneCommands();
  // The population, asserted before the verdicts: an enumerator that found nothing would pass the
  // loop below over an empty list.
  assert.ok(cmds.length >= 100, `only ${cmds.length} lane commands found — the enumerator is not reading the manifests`);
  const names = new Set(cmds.map((c) => c.manifest));
  assert.ok(names.has('security-baseline.json') && names.has('runtime.json'),
    `the two manifests the CLI ships with are missing from ${[...names].join(', ')}`);
  const bad = [];
  for (const c of cmds) {
    if (c.parseError) { bad.push(`${c.manifest}: not valid JSON — ${c.parseError}`); continue; }
    const why = syntaxError(c.cmd);
    if (why) bad.push(`${c.manifest} ${c.id} ${c.key}[${c.index}]: ${why}`);
  }
  assert.deepEqual(bad, [], `a lane command the shell cannot parse fails only where that lane runs:\n${bad.join('\n')}`);
});
