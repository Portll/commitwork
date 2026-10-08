// node --test bin/test/  — the forbidden-trailer gate, both halves.
//
// WHY THIS EXISTS. "No Co-Authored-By" was a house rule with nothing enforcing it, and it was broken
// NINE times on main between 2026-08-27 and 2026-08-29 before anyone measured. A `commit-msg` hook
// alone could not have caught them: `bin/commit-phase.mjs` — the commit path CLAUDE.md mandates —
// lands with `git commit-tree`, which runs NO hooks at all. So the sanctioned path was precisely the
// path a hook cannot see, and a hook-only gate would have looked complete while covering the
// minority of commits. That asymmetry is the whole reason there are two halves and two test groups.
//
// The third hole, which is the one that would have kept re-introducing the trailer forever:
// `replay()` (`--onto`) reads the original `%B` and pipes it into commit-tree verbatim, so every
// rebase carried historical trailers forward. Replay therefore STRIPS rather than refuses — it is a
// rewrite tool and stripping is its job — but it says so per commit, because a silent strip is the
// kind of quiet mutation this repo does not allow.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasForbiddenTrailer, stripForbiddenTrailers } from '../commit-phase.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRAILER = 'Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>';

describe('detection', () => {
  test('a real trailer is found; an ordinary message is not', () => {
    assert.equal(hasForbiddenTrailer(`subject\n\nbody\n\n${TRAILER}\n`), true);
    assert.equal(hasForbiddenTrailer('subject\n\nbody\n'), false);
    assert.equal(hasForbiddenTrailer(''), false);
    assert.equal(hasForbiddenTrailer(null), false);
  });

  test('case and leading whitespace do not evade it', () => {
    // The rule is about the trailer, not about one spelling of it. Anything a git client would
    // still parse as the trailer has to trip the gate.
    for (const line of ['co-authored-by: x', 'CO-AUTHORED-BY: x', '  Co-Authored-By : x', '\tco-Authored-By:x']) {
      assert.equal(hasForbiddenTrailer(`s\n\n${line}\n`), true, `missed: ${JSON.stringify(line)}`);
    }
  });

  test('the shared regex is stateful — repeated calls must not alternate', () => {
    // /g regexes carry lastIndex. A gate that answers true, false, true on identical input is worse
    // than no gate, because it passes the first time somebody tests it.
    const msg = `s\n\n${TRAILER}\n`;
    for (let i = 0; i < 5; i++) assert.equal(hasForbiddenTrailer(msg), true, `call ${i} disagreed`);
  });
});

describe('stripping (the replay path)', () => {
  test('one trailer is removed and the body survives intact', () => {
    const r = stripForbiddenTrailers(`subject\n\nbody line\n\n${TRAILER}\n`);
    assert.equal(r.removed, 1);
    assert.equal(r.text, 'subject\n\nbody line\n');
    assert.equal(hasForbiddenTrailer(r.text), false);
  });

  test('several trailers are all removed and counted', () => {
    const r = stripForbiddenTrailers(`s\n\nb\n\n${TRAILER}\nCo-Authored-By: Claude Fable 5 <x@y>\n`);
    assert.equal(r.removed, 2);
    assert.equal(hasForbiddenTrailer(r.text), false);
  });

  test('a clean message is returned unchanged and reports zero', () => {
    const src = 'subject\n\nbody\n';
    const r = stripForbiddenTrailers(src);
    assert.equal(r.removed, 0);
    assert.equal(r.text, src, 'a no-op must be byte-identical — determinism');
  });
});

describe('commit-phase refuses to AUTHOR one', () => {
  // End-to-end against a throwaway repo, because the property that matters is "nothing landed",
  // not "a function returned true". Asserting the commit count is the second witness.
  function repo() {
    const d = mkdtempSync(join(tmpdir(), 'cw-trailer-'));
    const g = (...a) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8' });
    g('init', '-q');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    writeFileSync(join(d, 'f'), 'a\n');
    // Every commit stamps package.json from its parent's, so the fixture carries one.
    writeFileSync(join(d, 'package.json'), '{\n  "name": "fixture",\n  "version": "0.1.0"\n}\n');
    g('add', 'f', 'package.json'); g('commit', '-q', '-m', 'base');
    // CW_TOUCH_LEDGER IS SET HERE, at the fixture, not in each test — the hermetic default
    // commit-phase-attribution.test.mjs adopted on 2026-08-30 and this file never got. A test
    // that LANDS a commit gets recorded, and this one lands one per run under a scratch tree-id:
    // 218 rows for a file named `f`, 217 distinct shas, all dated 2026-09-01.
    const run = (...args) => spawnSync(process.execPath, [join(CW, 'bin', 'commit-phase.mjs'), ...args], {
      cwd: d,
      encoding: 'utf8',
      // CW_ALLOW_UNSIGNED: this file asserts the trailer refusal, not signing. See
      // bin/test/commit-phase-signing.test.mjs for the signing coverage.
      env: { ...process.env, CW_TOUCH_LEDGER: join(d, '.cw-test-touches.jsonl'), CW_ALLOW_UNSIGNED: '1' },
    });
    return { d, g, run, count: () => Number(g('rev-list', '--count', 'HEAD').trim()) };
  }

  test('a message carrying the trailer is REFUSED and nothing lands', () => {
    const { d, run, count } = repo();
    try {
      writeFileSync(join(d, 'f'), 'b\n');
      const r = run('-m', `test: add a subject\n\n${TRAILER}`, '--', 'f');
      assert.notEqual(r.status, 0, 'must exit non-zero');
      assert.match(r.stderr, /REFUSED/);
      assert.match(r.stderr, /Co-Authored-By/);
      assert.equal(count(), 1, 'the refusal must leave HEAD where it was — fail closed');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the same commit lands once the trailer is gone (the gate is not just blocking everything)', () => {
    const { d, g, run, count } = repo();
    try {
      writeFileSync(join(d, 'f'), 'b\n');
      const r = run('-m', 'test: clean subject', '--', 'f');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(count(), 2);
      assert.equal(hasForbiddenTrailer(g('log', '-1', '--format=%B')), false);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// Where git runs hooks from, asked of git — never CW/.git/hooks. In a linked worktree `.git` is a
// FILE and the hooks live in the common dir; core.hooksPath can put them anywhere. This is the
// resolution monitor/install-git-hook.mjs installs into, so the two agree by construction.
const HOOKS = (() => {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: CW, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cannot resolve the hooks dir of ${CW}: ${String(r.stderr || r.error).trim()}`);
  return resolve(CW, r.stdout.trim());
})();
const readIfPresent = (p) => {
  try { return readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const INSTALLER_MARKER = 'commitwork self-monitor (installed by monitor/install-git-hook.mjs';
const hook = join(HOOKS, 'commit-msg');
const hookText = readIfPresent(hook);
// A clone carries no hooks, so a checkout nobody ran the installer in has neither of the two it
// writes. It writes commit-msg FIRST, so its post-commit standing without a commit-msg means the
// gate was removed after install — that is a failure below, not a skip.
const installerRan = hookText !== null || (readIfPresent(join(HOOKS, 'post-commit')) ?? '').includes(INSTALLER_MARKER);

describe('the installed commit-msg hook (the bare `git commit` half)', {
  skip: installerRan ? false
    : `no hook from the installer in ${HOOKS} — a clone carries none; run: node monitor/install-git-hook.mjs --write`,
}, () => {
  test('it is installed, executable, and is the one install-git-hook.mjs writes', () => {
    // If this fails the gate is half-present: commit-phase still refuses, but `git commit` does not.
    assert.ok(hookText !== null,
      `no commit-msg hook at ${hook}, though the installer's post-commit is there — run: node monitor/install-git-hook.mjs --write`);
    assert.match(hookText, /commitwork self-monitor|Co-Authored-By/);
  });

  test('it rejects a trailer message and accepts a clean one', (t) => {
    if (hookText === null) { t.skip('no hook to run — the test above fails on its absence'); return; }
    const d = mkdtempSync(join(tmpdir(), 'cw-hook-'));
    try {
      const bad = join(d, 'bad'); writeFileSync(bad, `subj\n\n${TRAILER}\n`);
      const good = join(d, 'good'); writeFileSync(good, 'fix(bin): refuse a forbidden trailer\n\nbody\n');
      assert.notEqual(spawnSync(hook, [bad], { encoding: 'utf8' }).status, 0, 'hook must reject the trailer');
      assert.equal(spawnSync(hook, [good], { encoding: 'utf8' }).status, 0, 'hook must pass a clean message');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
