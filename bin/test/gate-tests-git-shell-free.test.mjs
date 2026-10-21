// The gate's git helper must not go through a shell: JSON.stringify emits double quotes, and a
// POSIX shell still expands $(…) and $VAR inside them — reachable through ordinary FILENAMES.
// The fix passes an argv array; these pin that it stays removed, here and tree-wide.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_SRC = readFileSync(join(REPO, 'bin', 'gate-tests.mjs'), 'utf8');

describe('the gate builds git commands as argv, never as a shell string', () => {
  // lifted from source, not restated — a copy would keep passing after the real line changed
  const gitLine = GATE_SRC.split('\n').find((l) => l.startsWith('const git ='));

  test('the helper is defined and takes rest args, not a command string', () => {
    assert.ok(gitLine, 'no `const git =` helper found in bin/gate-tests.mjs');
    assert.match(gitLine, /const git = \(\.\.\.args\)/,
      'the helper must take (...args) — a single `cmd` parameter is the shape that needs quoting');
  });

  test('it calls execFileSync with an argv array and no shell', () => {
    assert.match(gitLine, /execFileSync\('git', args/,
      "must be execFileSync('git', args, …) — the argv form has no shell to interpret metacharacters");
    assert.doesNotMatch(gitLine, /execSync/,
      'execSync spawns a shell; that is the whole defect');
    assert.doesNotMatch(gitLine, /`git /,
      'a `git …` template literal means a command string is being built again');
  });

  test('no argument is fenced with JSON.stringify — the quoting that never worked', () => {
    // with no shell the quotes would be literal characters in the argument
    const gitCalls = GATE_SRC.split('\n').filter((l) => /\bgit\(/.test(l) && !l.trim().startsWith('//'));
    assert.ok(gitCalls.length >= 8, `expected the gate's git() call sites, found ${gitCalls.length}`);
    for (const line of gitCalls) {
      assert.doesNotMatch(line, /JSON\.stringify/,
        `a git() call still fences an argument with JSON.stringify: ${line.trim()}`);
    }
  });

  test('the %h|%an|%s format lost its single quotes with the shell that needed them', () => {
    // with no shell, single quotes would print as part of the format. CODE LINES ONLY: the scan
    // must not fail on a comment that quotes the old form.
    const code = GATE_SRC.split('\n').filter((l) => !l.trim().startsWith('//'));
    assert.ok(code.some((l) => l.includes("'--format=%h|%an|%s'")),
      'the format argument must be a bare argv string');
    for (const l of code) {
      assert.ok(!l.includes("--format='%h"),
        `single quotes around the format would now be literal characters in git's output: ${l.trim()}`);
    }
  });
});

describe('the shipped source never interpolates into a git shell string', () => {
  test('no execSync(`git …${…}`) anywhere under the runtime directories', () => {
    const DIRS = ['bin', 'monitor', 'admin', 'lib', 'cra', 'mcp'];
    const offenders = [];
    const walk = (dir) => {
      let entries = [];
      try { entries = readdirSync(dir); } catch { return; }
      for (const e of entries) {
        const p = join(dir, e);
        let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'test') walk(p); continue; }
        if (!e.endsWith('.mjs')) continue;
        const src = readFileSync(p, 'utf8');
        // a git command assembled as a template literal carrying an interpolation
        if (/execSync\(\s*`git [^`]*\$\{/.test(src)) offenders.push(p.slice(REPO.length + 1));
      }
    };
    for (const d of DIRS) walk(join(REPO, d));
    assert.deepEqual(offenders, [],
      `these build a git command string with interpolated values — use execFileSync('git', [args]): ${offenders.join(', ')}`);
  });
});

describe('why argv and not better quoting — the mechanism this fix relies on', () => {
  // pins the PREMISE: JSON.stringify quoting is not a defence and argv is; scratch repo, nothing shared
  test('a command substitution in a FILENAME executes under the old form and is inert under argv', () => {
    const T = mkdtempSync(join(tmpdir(), 'cw-git-shell-'));
    const marker = join(T, 'EXECUTED');
    try {
      execFileSync('git', ['init', '-q', '.'], { cwd: T });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: T });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: T });
      writeFileSync(join(T, 'seed.txt'), 'x\n');
      execFileSync('git', ['add', '-A'], { cwd: T });
      execFileSync('git', ['commit', '-qm', 'seed'], { cwd: T });

      // the payload does not require the file to exist — it only has to reach the shell
      const hostile = `pwn$(touch ${marker}).txt`;

      // OLD: the exact form that shipped, JSON.stringify quoting and all.
      try {
        execSync(`git log -1 --format=%cI -- ${JSON.stringify(hostile)}`,
          { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { /* git's own exit status is irrelevant; the substitution already ran */ }
      assert.equal(existsSync(marker), true,
        'the old shell form should demonstrably execute the payload — if this fails the demonstration is broken, not the fix');

      rmSync(marker, { force: true });

      // NEW: the form the gate uses now.
      try {
        execFileSync('git', ['log', '-1', '--format=%cI', '--', hostile],
          { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { /* git exits nonzero for an unknown path — that is the correct, inert outcome */ }
      assert.equal(existsSync(marker), false,
        'the argv form must pass the filename to git as data, never to a shell as code');
    } finally {
      rmSync(T, { recursive: true, force: true });
    }
  });
});
