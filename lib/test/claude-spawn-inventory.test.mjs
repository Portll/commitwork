// Is the spawn inventory COMPLETE? lib/test/claude-spawn-callers.test.mjs asserts what each known
// spawn sends a stub `claude`, which is the right witness for the spawns it was told about and
// blind to the one nobody declared. This reads the tracked sources and requires every file that can
// start a `claude` either to build its argv through lib/claude-spawn.mjs or to be declared below
// with the reason it is not that kind of file.
//
// TWO DETECTORS, UNIONED, so a file that defeats one still has to defeat the other: the binary NAME
// as a bare string literal (or an env seam naming the command), and claude-CLI-only FLAG vocabulary.
// Comments are NOT stripped: the stripper is the part that has been wrong in this tree before, and a
// comment can only ADD a candidate, never hide one.
//
// WHAT IT STILL CANNOT SEE, stated rather than implied: a spawn whose binary arrives in a variable
// from another module and whose flags are built there too. This is a floor under the inventory, not
// a proof that there are no others. Test files are out of scope because a test's own spawn is the
// measurement, not a production call site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BY_NAME = /(['"`])(?:[^'"`\n]*\/)?claude\1|CLAUDE_BIN|CLAUDE_CMD/;
const BY_FLAG = /--setting-sources|--strict-mcp-config|--permission-prompts|--dangerously-skip-permissions|--allowedTools|--max-turns/;
const BUILDER = /claude-spawn\.mjs/;

/** Files that build a claude argv and must do it through lib/claude-spawn.mjs. */
const VIA_BUILDER = [
  'admin/routes/codeql-remediation.mjs',
  'admin/routes/remediation.mjs',
  'bin/daily-run.mjs',
  'bin/issue-loop.mjs',
  'lib/claude-spawn.mjs',
  'lib/cobolwork-remediation-engines.mjs',
  'lib/judge.mjs',
  'monitor/divergence-review.mjs',
  'monitor/envelope-witness.mjs',
  'monitor/settings.mjs',
];

/** A candidate that names the binary or a flag without starting one, and why. */
const NOT_A_SPAWN = new Map([
  ['admin/routes/issue-detail.mjs', 'the literal is the route path /api/issue/claude; the spawn it reaches is launchClaudeSession in admin/routes/remediation.mjs'],
  ['bin/hooks/guard-destructive.mjs', 'the header records what was measured about an answered ask and names the flags that decide it; a hook spawns no agent'],
  ['bin/disclosure-review.mjs', 'the literal is the default value of --backend, a judge backend name passed to judge(); the spawn it reaches is runClaude in lib/judge.mjs'],
  ['bin/judge.mjs', 'the literal is the default value of --backend, a judge backend name passed to judge(); the spawn it reaches is runClaude in lib/judge.mjs'],
  ['bin/agent-config.mjs','the literal is a key in the harness config-path map (.mcp.json, .claude/settings.json); this file READS agent configuration'],
  ['monitor/agent-run-judge.mjs', 'the literal is an exe pattern and the flags are subjects it matches in RECORDED runs; it judges logs and starts nothing'],
  ['monitor/process-ancestry.mjs', 'the literal is a process name in the harness-process list; this file reads ps output'],
]);

// A real spawn that does NOT go through the builder. Declared so it is tracked rather than exempt:
// the assertions below fail when it is routed through the builder (move it to VIA_BUILDER) and
// equally when the deviations the reason names stop being true.
const KNOWN_GAP = new Map([
  ['bin/security-work-queue.mjs', {
    why: 'the local-draft worker builds its own claude argv: --setting-sources user rather than \'\', '
      + 'an inline --mcp-config JSON string (the form lib/claude-spawn.mjs uses a FILE for, because '
      + '""" is a cmd.exe metacharacter), and its own env rather than llmEnv. Its cwd is a mkdtemp '
      + 'scratch and its tool list is empty, so no scanned repository\'s settings are in reach and no '
      + 'tool authority rides on the user rules it loads.',
    stillTrue: [/'--setting-sources',\s*'user'/, /'--mcp-config',\s*'\{"mcpServers":\{\}\}'/],
  }],
]);

/** The tracked non-test sources. A list this cannot read is a refusal, never an empty scan. */
function trackedSources() {
  const r = spawnSync('git', ['ls-files', '--', '*.mjs'], { cwd: CW, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `git ls-files failed (${r.status}): ${(r.stderr || '').trim()} — an unread tree is not an empty one`);
  const files = r.stdout.split('\n').filter(Boolean).filter((p) => !p.includes('/test/') && !p.startsWith('fixtures/'));
  assert.ok(files.length > 100, `only ${files.length} tracked sources: the scan read nothing and would pass on anything`);
  assert.ok(files.includes('lib/claude-spawn.mjs'), 'the builder itself is not in the scanned set, so the scan proves nothing');
  return files;
}

const sourceOf = (p) => readFileSync(join(CW, p), 'utf8');

test('every tracked source that can start a `claude` is routed through the builder or declared', () => {
  const candidates = trackedSources().filter((p) => { const s = sourceOf(p); return BY_NAME.test(s) || BY_FLAG.test(s); });
  const declared = new Set([...VIA_BUILDER, ...NOT_A_SPAWN.keys(), ...KNOWN_GAP.keys()]);
  const undeclared = candidates.filter((p) => !declared.has(p));
  assert.deepEqual(undeclared, [], `undeclared claude-spawn candidate(s): ${undeclared.join(', ')}. `
    + 'Route the spawn through lib/claude-spawn.mjs and add it to VIA_BUILDER, or declare why it starts nothing.');
  // and the declaration cannot rot: a path that is no longer a candidate must be removed from it
  for (const p of declared) assert.ok(candidates.includes(p), `${p} is declared here but is no longer a claude-spawn candidate; drop the entry`);
});

test('each builder caller still imports the builder', () => {
  for (const p of VIA_BUILDER) {
    assert.match(sourceOf(p), BUILDER, `${p} no longer imports lib/claude-spawn.mjs, so nothing holds its confinement`);
  }
});

test('each not-a-spawn declaration carries a reason', () => {
  for (const [p, why] of NOT_A_SPAWN) assert.ok(why.length > 40, `${p}: a one-word exemption is not a reason`);
});

// fact: a gap record that cannot notice its own repair is a stale comment / this one fails the moment
// the file is routed through the builder, which is the only way the entry gets removed (expiry: never, prev: not built)
test('the declared gap is still exactly the gap, and fails when it is fixed', () => {
  for (const [p, { why, stillTrue }] of KNOWN_GAP) {
    const src = sourceOf(p);
    assert.ok(why.length > 40, `${p}: a gap needs its reason stated`);
    assert.doesNotMatch(src, BUILDER, `${p} now imports lib/claude-spawn.mjs — move it from KNOWN_GAP to VIA_BUILDER`);
    for (const re of stillTrue) assert.match(src, re, `${p} no longer matches ${re}; the recorded reason is out of date — re-read the spawn and rewrite or remove the entry`);
  }
});
