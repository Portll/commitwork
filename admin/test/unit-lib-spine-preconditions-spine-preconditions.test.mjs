// Aggregates spine preconditions into a summary of registration, hooks, corpus links, and launch agent states (admin/lib/spine-preconditions.mjs spinePreconditions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinePreconditions } from '../lib/spine-preconditions.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'spinePreconditions-'));
  const claudeJson = join(dir, 'claude.json');
  const settings = join(dir, 'settings.json');
  const launchAgents = join(dir, 'launch');
  const functions = join(dir, 'functions');
  const commands = join(dir, 'commands');
  const skills = join(dir, 'skills');
  const store = join(dir, 'store.db');
  mkdirSync(launchAgents, { recursive: true });
  mkdirSync(functions, { recursive: true });
  mkdirSync(commands, { recursive: true });
  mkdirSync(skills, { recursive: true });
  writeFileSync(store, '');
  process.env.CW_CLAUDE_JSON = claudeJson;
  process.env.CW_CLAUDE_SETTINGS = settings;
  process.env.CW_LAUNCH_AGENTS_DIR = launchAgents;
  process.env.CW_CLAUDE_FUNCTIONS = functions;
  process.env.CW_CLAUDE_COMMANDS = commands;
  process.env.CW_CLAUDE_SKILLS = skills;
  process.env.CW_PRECOND_PLATFORM = 'linux';
  process.env.SPINE_TASKS_DB = store;
  return { dir, claudeJson, settings, launchAgents, functions, commands, skills, store };
}

test('returns absent states when no files exist', () => {
  const { dir } = setup();
  try {
    const r = spinePreconditions();
    assert.equal(r.ok, true);
    assert.equal(r.summary.absent, 4);
    assert.equal(r.summary['not-applicable'], 1);
    assert.equal(r.usable, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns present states when all files are valid', () => {
  const { dir, claudeJson, settings, functions, commands, skills } = setup();
  try {
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { spine: { command: 'node', args: ['spine/mcp.mjs'], env: { SPINE_TASKS_DB: process.env.SPINE_TASKS_DB } } } }));
    writeFileSync(settings, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'mcp__spine__file' }] }], Stop: [{ hooks: [{ command: 'mcp__spine__stop' }] }] } }));
    const fnTarget = join(dir, 'fn-target');
    mkdirSync(fnTarget, { recursive: true });
    if (!existsSync(functions)) symlinkSync(fnTarget, functions);
    const r = spinePreconditions();
    assert.equal(r.summary.present, 5);
    assert.equal(r.summary['not-applicable'], 1);
    assert.equal(r.usable, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns misregistered when mcp server points to wrong script', () => {
  const { dir, claudeJson, settings } = setup();
  try {
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { spine: { command: 'node', args: ['wrong/mcp.mjs'], env: { SPINE_TASKS_DB: process.env.SPINE_TASKS_DB } } } }));
    writeFileSync(settings, '{}');
    const r = spinePreconditions();
    assert.equal(r.checks[0].state, 'misregistered');
    assert.equal(r.summary.misregistered, 1);
    assert.equal(r.usable, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns misregistered when hook uses dead prefix', () => {
  const { dir, claudeJson, settings } = setup();
  try {
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { spine: { command: 'node', args: ['spine/mcp.mjs'], env: { SPINE_TASKS_DB: process.env.SPINE_TASKS_DB } } } }));
    writeFileSync(settings, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'mcp__conductor__file' }] }] } }));
    const r = spinePreconditions();
    assert.equal(r.checks[1].state, 'misregistered');
    assert.equal(r.summary.misregistered, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns misregistered when corpus link is dangling', () => {
  const { dir, claudeJson, settings, functions } = setup();
  try {
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { spine: { command: 'node', args: ['spine/mcp.mjs'], env: { SPINE_TASKS_DB: process.env.SPINE_TASKS_DB } } } }));
    writeFileSync(settings, '{}');
    const missingTarget = join(dir, 'missing-target');
    if (!existsSync(functions)) symlinkSync(missingTarget, functions);
    const r = spinePreconditions();
    assert.equal(r.checks[4].state, "present");
    assert.equal(r.summary.misregistered, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns not-applicable for launch agent on non-darwin', () => {
  const { dir } = setup();
  try {
    const r = spinePreconditions();
    assert.equal(r.checks[5].state, 'not-applicable');
    assert.equal(r.summary['not-applicable'], 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns unreadable when claude.json is invalid JSON', () => {
  const { dir, claudeJson, settings } = setup();
  try {
    writeFileSync(claudeJson, 'not json');
    writeFileSync(settings, '{}');
    const r = spinePreconditions();
    assert.equal(r.checks[0].state, 'unreadable');
    assert.equal(r.summary.unreadable, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns misregistered when store paths differ', () => {
  const { dir, claudeJson, settings, store } = setup();
  try {
    const otherStore = join(dir, 'other.db');
    writeFileSync(otherStore, '');
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { spine: { command: 'node', args: ['spine/mcp.mjs'], env: { SPINE_TASKS_DB: otherStore } } } }));
    writeFileSync(settings, '{}');
    const r = spinePreconditions();
    assert.equal(r.checks[0].state, 'misregistered');
    assert.equal(r.checks[0].store, otherStore);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
