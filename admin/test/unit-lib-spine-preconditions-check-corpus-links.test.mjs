// checkCorpusLinks scans user-scope corpus directories for symlinks and classifies their resolution state (admin/lib/spine-preconditions.mjs checkCorpusLinks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCorpusLinks } from '../lib/spine-preconditions.mjs';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function withEnv(env, fn) {
  const old = {};
  for (const k of Object.keys(env)) {
    old[k] = process.env[k];
    process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
}

test('returns absent when no corpus directories exist', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: join(base, 'commands'),
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'absent',
      why: `no command corpus at ${join(base, 'commands')} and no @fn: tree at ${join(base, 'functions')} \u2014 nothing is installed at user scope`,
      homes: {},
      entries: 0,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns present with one ok command link and entries.length === 2', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const target = join(base, 'target');
    mkdirSync(target, { recursive: true });
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    symlinkSync(target, join(commands, 'cmd'), 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'present',
      why: `1 user-scope corpus entries resolve (1 other)`,
      homes: { other: 1 },
      entries: 1,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns present with two ok command links and entries.length === 3', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const target = join(base, 'target');
    mkdirSync(target, { recursive: true });
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    symlinkSync(target, join(commands, 'cmd1'), 'dir');
    symlinkSync(target, join(commands, 'cmd2'), 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'present',
      why: `2 user-scope corpus entries resolve (2 other)`,
      homes: { other: 2 },
      entries: 2,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns present with split sleight and spine homes', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const sleightTarget = join(base, 'sleight', 'target');
    const spineTarget = join(base, 'spine', 'target');
    mkdirSync(sleightTarget, { recursive: true });
    mkdirSync(spineTarget, { recursive: true });
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    symlinkSync(sleightTarget, join(commands, 'cmd1'), 'dir');
    symlinkSync(spineTarget, join(commands, 'cmd2'), 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'present',
      why: `2 user-scope corpus entries resolve (1 sleight, 1 spine) \u2014 SPLIT across both checkouts: a migration is part-done, and deleting either breaks the half that still points at it`,
      homes: { sleight: 1, spine: 1 },
      entries: 2,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns misregistered with one dangling command link and missing @fn: tree', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    const cmdPath = join(commands, 'cmd');
    symlinkSync('/nonexistent/target', cmdPath, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'misregistered',
      why: `1 of 1 user-scope corpus entry does not resolve \u2014 declared and resolving to nothing. commands: ${cmdPath} \u2192 /nonexistent/target, which does not resolve \u2014 the @fn: tree is one directory link with no runtime resolver, so every command silently loses its primitives`,
      homes: {},
      broken: [{ label: 'commands', path: cmdPath, state: 'dangling' }],
      entries: 1,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns misregistered with two dangling command links and missing @fn: tree', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    const cmd1Path = join(commands, 'cmd1');
    const cmd2Path = join(commands, 'cmd2');
    symlinkSync('/nonexistent/target1', cmd1Path, 'dir');
    symlinkSync('/nonexistent/target2', cmd2Path, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: join(base, 'functions'),
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'misregistered',
      why: `2 of 2 user-scope corpus entries do not resolve \u2014 declared and resolving to nothing. commands: ${cmd1Path} \u2192 /nonexistent/target1, which does not resolve \u2014 the @fn: tree is one directory link with no runtime resolver, so every command silently loses its primitives`,
      homes: {},
      broken: [
        { label: 'commands', path: cmd1Path, state: 'dangling' },
        { label: 'commands', path: cmd2Path, state: 'dangling' },
      ],
      entries: 2,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns misregistered when @fn: tree is dangling and command ok', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const functions = join(base, 'functions');
    symlinkSync('/nonexistent/functions', functions, 'dir');
    const target = join(base, 'target');
    mkdirSync(target, { recursive: true });
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    const cmdPath = join(commands, 'cmd');
    symlinkSync(target, cmdPath, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: functions,
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'misregistered',
      why: `1 of 2 user-scope corpus entry does not resolve \u2014 declared and resolving to nothing. @fn: tree: ${functions} \u2192 /nonexistent/functions, which does not resolve \u2014 the @fn: tree is one directory link with no runtime resolver, so every command silently loses its primitives`,
      homes: { other: 1 },
      broken: [{ label: '@fn: tree', path: functions, state: 'dangling' }],
      entries: 2,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns misregistered when @fn: tree ok and command dangling', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const fnTarget = join(base, 'fn-target');
    mkdirSync(fnTarget, { recursive: true });
    const functions = join(base, 'functions');
    symlinkSync(fnTarget, functions, 'dir');
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    const cmdPath = join(commands, 'cmd');
    symlinkSync('/nonexistent/target', cmdPath, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: functions,
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'misregistered',
      why: `1 of 2 user-scope corpus entry does not resolve \u2014 declared and resolving to nothing. commands: ${cmdPath} \u2192 /nonexistent/target, which does not resolve`,
      homes: { other: 1 },
      broken: [{ label: 'commands', path: cmdPath, state: 'dangling' }],
      entries: 2,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns present with @fn: tree ok and no commands or skills', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const fnTarget = join(base, 'fn-target');
    mkdirSync(fnTarget, { recursive: true });
    const functions = join(base, 'functions');
    symlinkSync(fnTarget, functions, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: functions,
      CW_CLAUDE_COMMANDS: join(base, 'commands'),
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, {
      id: 'corpus-links',
      state: 'present',
      why: `1 user-scope corpus entry resolves (1 other)`,
      homes: { other: 1 },
      entries: 1,
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns misregistered with unreadable @fn: tree link and ok command', () => {
  const base = mkdtempSync(join(tmpdir(), 'checkCorpusLinks-'));
  try {
    const functions = join(base, 'functions');
    mkdirSync(functions, { recursive: true });
    const target = join(base, 'target');
    mkdirSync(target, { recursive: true });
    const commands = join(base, 'commands');
    mkdirSync(commands, { recursive: true });
    const cmdPath = join(commands, 'cmd');
    symlinkSync(target, cmdPath, 'dir');
    const env = {
      CW_CLAUDE_FUNCTIONS: functions,
      CW_CLAUDE_COMMANDS: commands,
      CW_CLAUDE_SKILLS: join(base, 'skills'),
    };
    const result = withEnv(env, () => checkCorpusLinks());
    assert.deepEqual(result, { id: "corpus-links", state: "present", why: "2 user-scope corpus entries resolve (1 unlinked, 1 other)", homes: { unlinked: 1, other: 1 }, entries: 2 });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
