// checkCorpusLinks — the 52 commands, 10 skills and the ONE directory link carrying the whole
// `@fn:` primitive tree.
//
// WHY IT EXISTS. `@fn:` resolution is a discipline the session maintains; there is no runtime
// resolver. A broken `_functions` link therefore removes every primitive from every command with
// nothing raising an error anywhere. Before this check, `functionsTreePath()` was consulted only
// inside checkHookTargets and only when ALREADY dangling — so a healthy tree was never counted, and
// "7 hook target(s) resolve" said nothing about whether the `@fn:` tree had been looked at. Healthy
// and unchecked rendered identically.
//
// WHAT IT IS FOR NOW. Under D18 this corpus moves out of sleight into the spine. The dangerous
// state during that move is not a broken link — it is a PART-DONE one, every entry resolving while
// half still answer to a checkout about to be deleted. So the check reports where links point even
// when nothing is wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCorpusLinks, linkHome, inspectEntry } from '../lib/spine-preconditions.mjs';

function fixture({ sleightCmds = 0, spineCmds = 0, skills = 0, fnHome = 'sleight', breakFn = false, breakCmd = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-corpus-'));
  const sleight = join(root, 'sleight', '.claude');
  const spine = join(root, 'substrate', '.claude');
  const home = join(root, 'home', '.claude');
  for (const d of [join(sleight, 'commands'), join(spine, 'commands'), join(sleight, 'skills'), join(sleight, '_functions'), join(home, 'commands'), join(home, 'skills')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(sleight, '_functions', 'edge_walk.md'), '# p0\n');

  const mk = (srcDir, i, prefix) => {
    const src = join(srcDir, `${prefix}${i}.md`);
    writeFileSync(src, '# body\n');
    symlinkSync(src, join(home, 'commands', `${prefix}${i}.md`));
  };
  for (let i = 0; i < sleightCmds; i++) mk(join(sleight, 'commands'), i, 'sl');
  for (let i = 0; i < spineCmds; i++) mk(join(spine, 'commands'), i, 'sp');
  for (let i = 0; i < skills; i++) {
    const d = join(sleight, 'skills', `sk${i}`); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), '# skill\n');
    symlinkSync(d, join(home, 'skills', `sk${i}`));
  }
  const fnTarget = fnHome === 'spine' ? join(spine, '_functions') : join(sleight, '_functions');
  if (fnHome === 'spine') mkdirSync(fnTarget, { recursive: true });
  const fnLink = join(home, '_functions');
  symlinkSync(breakFn ? join(root, 'gone', '_functions') : fnTarget, fnLink);
  if (breakCmd && sleightCmds) rmSync(join(sleight, 'commands', 'sl0.md'));

  const env = {
    CW_CLAUDE_FUNCTIONS: fnLink,
    CW_CLAUDE_COMMANDS: join(home, 'commands'),
    CW_CLAUDE_SKILLS: join(home, 'skills'),
  };
  return { root, env, home };
}

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('the harness is live — a healthy corpus is present and says where it points', () => {
  const { root, env } = fixture({ sleightCmds: 3, skills: 2 });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.state, 'present');
  assert.equal(c.entries, 6, '3 commands + 2 skills + the @fn: tree');
  assert.equal(c.homes.sleight, 6);
  assert.match(c.why, /6 user-scope corpus entries resolve/);
  rmSync(root, { recursive: true, force: true });
});

// ── the silent failure this check exists for ───────────────────────────────────────────────────
test('a DANGLING @fn: tree is misregistered, and the report says the loss is silent', () => {
  const { root, env } = fixture({ sleightCmds: 3, breakFn: true });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.state, 'misregistered');
  assert.match(c.why, /@fn: tree/);
  assert.match(c.why, /no runtime resolver/, 'the reader must be told nothing will error');
  assert.match(c.why, /silently loses its primitives/);
  rmSync(root, { recursive: true, force: true });
});

test('the @fn: tree is named FIRST even when other entries are broken too — one link, silent loss', () => {
  const { root, env } = fixture({ sleightCmds: 3, breakFn: true, breakCmd: true });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.state, 'misregistered');
  assert.equal(c.broken.length, 2);
  assert.match(c.why, /@fn: tree/, 'a broken command must not push the @fn: tree out of the message');
  rmSync(root, { recursive: true, force: true });
});

test('a healthy @fn: tree is COUNTED, not merely un-flagged — the defect that prompted this', () => {
  // The old behaviour added the tree to the checked set only when it was already dangling, so a
  // healthy tree and an unchecked one produced the same output. It must appear in the total.
  const { root, env } = fixture({ sleightCmds: 0, skills: 0 });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.entries, 1, 'the @fn: tree alone is one checked entry');
  assert.equal(c.homes.sleight, 1);
  rmSync(root, { recursive: true, force: true });
});

// ── the migration state that matters ───────────────────────────────────────────────────────────
test('a PART-DONE migration is named even though every link resolves', () => {
  const { root, env } = fixture({ sleightCmds: 2, spineCmds: 3, fnHome: 'spine' });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.state, 'present', 'nothing is broken — which is exactly why this state is dangerous');
  assert.deepEqual([c.homes.sleight, c.homes.spine], [2, 4]);
  assert.match(c.why, /SPLIT across both checkouts/);
  assert.match(c.why, /deleting either breaks the half/);
  rmSync(root, { recursive: true, force: true });
});

test('a completed migration reports spine only, with no split warning', () => {
  const { root, env } = fixture({ sleightCmds: 0, spineCmds: 4, fnHome: 'spine' });
  const c = withEnv(env, checkCorpusLinks);
  assert.equal(c.state, 'present');
  assert.equal(c.homes.spine, 5);
  assert.equal(c.homes.sleight, undefined);
  assert.doesNotMatch(c.why, /SPLIT/);
  rmSync(root, { recursive: true, force: true });
});

test('an EMPTY corpus is absent, never a pass — nothing installed is not the same as everything fine', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-corpus-empty-'));
  const c = withEnv({ CW_CLAUDE_FUNCTIONS: join(root, 'nope'), CW_CLAUDE_COMMANDS: join(root, 'nope'), CW_CLAUDE_SKILLS: join(root, 'nope') }, checkCorpusLinks);
  assert.equal(c.state, 'absent');
  assert.match(c.why, /nothing is installed at user scope/);
  rmSync(root, { recursive: true, force: true });
});

// ── the classifier ─────────────────────────────────────────────────────────────────────────────
test('linkHome buckets by checkout, and a copy that was never a link is `unlinked` rather than broken', () => {
  assert.equal(linkHome('/x/Repositories/Portll/sleight/.claude/commands/a.md'), 'sleight');
  assert.equal(linkHome('/x/Repositories/Portll/substrate/.claude/commands/a.md'), 'spine');
  assert.equal(linkHome('/x/elsewhere/a.md'), 'other');
  assert.equal(linkHome(null), 'unlinked');
  const root = mkdtempSync(join(tmpdir(), 'cw-corpus-plain-'));
  const f = join(root, 'real.md'); writeFileSync(f, '# not a link\n');
  const e = inspectEntry(f);
  assert.deepEqual([e.state, e.home], ['ok', 'unlinked'], 'a real file is a legitimate state, not a failure');
  rmSync(root, { recursive: true, force: true });
});
