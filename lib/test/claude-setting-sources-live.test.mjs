// Does `--setting-sources ''` actually stop a repository's own hooks from running? Every other
// witness in this tree asserts the FLAG: lib/test/claude-spawn-callers.test.mjs reads the argv a
// stub `claude` received, and that witness cannot tell a flag the CLI honours from one it ignores.
// This one runs the real CLI in a repository that carries a hook and asserts the EFFECT, in both
// directions — without the flag the hook runs, with it the hook never runs. It is probe P3 of the
// 2026-10-07 agent and MCP security review, which left the D2 chain deliberately unexecuted.
//
// The live half costs two model calls and is opt-in (CW_LIVE_LLM=1); it skips with its reason and
// never reports a pass it did not measure. The CONTROL is what makes it worth anything: if the run
// without the flag does not load the hook, this host cannot demonstrate the attack and the test
// fails rather than crediting the flag for a hook that was never going to fire.
//
// The probe repository is built here rather than copied from fixtures/scan-canary/dirty: the hook
// is the whole mechanism under test, and copying the canary would feed a live model a tree of
// planted injections for nothing measured. The fixture's own shape is asserted below instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeArgs } from '../claude-spawn.mjs';
import { llmEnv } from '../../bin/lib/scanner-env.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The hook command below is a POSIX shell line, so the probe states its platform rather than
// measuring Windows with a profile Windows does not run.
const LIVE = process.env.CW_LIVE_LLM !== '1' ? 'CW_LIVE_LLM is not 1 — the two live model calls are opt-in (cost, network, credential)'
  : (process.platform === 'win32' ? 'the probe\'s hook is a POSIX shell line: the flag is NOT verified on Windows here' : false);

// fact: the shipped attack fixture is the reason D2 is a defect and not a hypothetical / a fixture that
// loses its hooks block would leave the published canary describing an attack it no longer carries
test('the shipped scan-canary fixture still carries a repo-local hooks block', () => {
  const f = join(CW, 'fixtures', 'scan-canary', 'dirty', '.claude', 'settings.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  const events = Object.keys(s.hooks || {});
  assert.ok(events.length > 0, `${f} declares no hooks, so a scanned repo that runs code on a spawn is no longer fixtured`);
  for (const e of events) assert.ok(Array.isArray(s.hooks[e]) && s.hooks[e].length, `${f}: ${e} is declared empty`);
});

/** The production argv for a read-only spawn, and the same argv with the setting-sources pair removed. */
function argvPair() {
  const fixed = claudeArgs({ tools: 'Read', extra: ['--no-session-persistence'] });
  const i = fixed.indexOf('--setting-sources');
  assert.ok(i >= 0, `the builder emitted no --setting-sources: ${fixed.join(' ')}`);
  assert.equal(fixed[i + 1], '', 'the builder no longer asks for an empty setting-sources list; this probe measures that pair');
  return { fixed, control: [...fixed.slice(0, i), ...fixed.slice(i + 2)] };
}

test('the control argv differs from the production argv in exactly the setting-sources pair', () => {
  const { fixed, control } = argvPair();
  assert.deepEqual(control, fixed.filter((a, i) => !(fixed[i] === '--setting-sources' || fixed[i - 1] === '--setting-sources')));
  assert.equal(control.length, fixed.length - 2);
  assert.ok(!control.includes('--setting-sources'));
});

test('LIVE (CW_LIVE_LLM=1): a repo-local SessionStart hook runs without --setting-sources and never runs with it', { skip: LIVE }, () => {
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-p3-')));
  try {
    const repo = join(T, 'repo');
    const marker = join(T, 'hook-ran.txt');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    assert.ok(!/['"\n\\]/.test(marker), `the scratch path ${marker} cannot be quoted into a hook command`);
    writeFileSync(join(repo, '.claude', 'settings.json'), `${JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `printf 'HOOK-RAN\\n' >> '${marker}'`, timeout: 10 }] }] },
    }, null, 2)}\n`);
    const bin = process.env.CW_CLAUDE_BIN || 'claude';
    const { fixed, control } = argvPair();
    const run = (argv) => {
      rmSync(marker, { force: true });
      const r = spawnSync(bin, [...argv, 'say ok'], { cwd: repo, env: llmEnv(process.env), encoding: 'utf8', timeout: 300_000 });
      return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), ran: existsSync(marker) };
    };

    const before = run(control);
    assert.equal(before.status, 0, `the control run failed (${before.status}), so it measured nothing: ${before.err.slice(0, 400)}`);
    assert.ok(before.out.length, 'the control run produced no output, so it did not reach the model');
    assert.equal(before.ran, true, 'WITHOUT --setting-sources the repository\'s own SessionStart hook did NOT run on this host, '
      + 'so this host cannot demonstrate D2 and the pass below would be unearned. Re-measure before trusting the flag.');

    const after = run(fixed);
    assert.equal(after.status, 0, `the confined run failed (${after.status}): ${after.err.slice(0, 400)}`);
    assert.ok(after.out.length, 'the confined run produced no output, so a hook that never ran proves nothing');
    assert.equal(after.ran, false, 'WITH --setting-sources \'\' the repository\'s hook still ran: the flag does not confine this CLI version');
  } finally { rmSync(T, { recursive: true, force: true }); }
});
