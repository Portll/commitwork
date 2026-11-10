// Dry-run diff that pins npx MCP servers and bounds agent Bash permissions (monitor/agent-config-harden.mjs hardenAgentConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardenAgentConfig } from '../agent-config-harden.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const NOTE = 'DRY RUN \u2014 nothing written. Review the diff, `git apply` it, and commit: applying stays a human act.';
const diffOf = (path, a, b) => `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${a}\n\\ No newline at end of file\n+${b}\n\\ No newline at end of file\n`;

function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hardenAgentConfig-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Without a repoDir it refuses with ok false and the reason no repoDir', () => {
  assert.deepEqual(hardenAgentConfig(), { ok: false, reason: 'no repoDir' });
  assert.deepEqual(hardenAgentConfig({ repoDir: '' }), { ok: false, reason: 'no repoDir' });
});

test('An empty repository has nothing to change and says no agent configuration was found', () => {
  withDir({}, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir });
    assert.deepEqual(r, { ok: false, reason: 'nothing to change \u2014 no agent configuration found', pinned: [], narrowed: [], denied: [], skipped: [] });
  });
});

test('An unpinned npx server in .mcp.json is pinned with the given resolver as a dry-run diff', () => {
  const before = JSON.stringify({ mcpServers: { s1: { command: 'npx', args: ['@pkg/tool'] } } });
  const after = before.replace('"@pkg/tool"', '"@pkg/tool@1.2.3"');
  withDir({ '.mcp.json': before }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir, resolveVersion: () => '1.2.3', observed: [] });
    assert.deepEqual(r, {
      ok: true,
      applied: false,
      files: ['.mcp.json'],
      pinned: [{ file: '.mcp.json', server: 's1', package: '@pkg/tool', version: '1.2.3' }],
      narrowed: [],
      denied: [],
      skipped: [],
      diff: diffOf('.mcp.json', before, after),
      note: NOTE,
    });
    assert.equal(readFileSync(join(dir, '.mcp.json'), 'utf8'), before);
  });
});

test('Without a resolver the version comes from package-lock.json for a servers block in .vscode/mcp.json', () => {
  const before = JSON.stringify({ servers: { s2: { command: 'npx', args: ['@other/tool'] } } });
  const after = before.replace('"@other/tool"', '"@other/tool@0.1.0"');
  const lock = JSON.stringify({ packages: { 'node_modules/@other/tool': { version: '0.1.0' } } });
  withDir({ '.vscode/mcp.json': before, 'package-lock.json': lock }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir });
    assert.deepEqual(r, {
      ok: true,
      applied: false,
      files: ['.vscode/mcp.json'],
      pinned: [{ file: '.vscode/mcp.json', server: 's2', package: '@other/tool', version: '0.1.0' }],
      narrowed: [],
      denied: [],
      skipped: [],
      diff: diffOf('.vscode/mcp.json', before, after),
      note: NOTE,
    });
    assert.equal(readFileSync(join(dir, '.vscode/mcp.json'), 'utf8'), before);
  });
});

test('A resolved version that is not a full semver leaves the server unresolved and nothing to change', () => {
  const before = JSON.stringify({ mcpServers: { s1: { command: 'npx', args: ['@pkg/tool'] } } });
  withDir({ '.cursor/mcp.json': before }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir, resolveVersion: () => '1.2', observed: [] });
    assert.deepEqual(r, {
      ok: false,
      reason: 'nothing to change \u2014 .cursor/mcp.json (s1): unresolved',
      pinned: [],
      narrowed: [],
      denied: [],
      skipped: [{ file: '.cursor/mcp.json', server: 's1', package: '@pkg/tool', reason: 'unresolved' }],
    });
  });
});

test('Settings without any Bash grant are left alone and every skip reason is listed', () => {
  withDir({
    '.claude/settings.json': JSON.stringify({ permissions: { allow: [] } }),
    '.claude/settings.local.json': JSON.stringify({ model: 'x' }),
  }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir });
    assert.deepEqual(r, {
      ok: false,
      reason: 'nothing to change \u2014 .claude/settings.json: no unbounded Bash grant; .claude/settings.json: no Bash grant to bound; .claude/settings.local.json: no permissions.allow; .claude/settings.local.json: no permissions.allow',
      pinned: [],
      narrowed: [],
      denied: [],
      skipped: [
        { file: '.claude/settings.json', reason: 'no unbounded Bash grant' },
        { file: '.claude/settings.json', reason: 'no Bash grant to bound' },
        { file: '.claude/settings.local.json', reason: 'no permissions.allow' },
        { file: '.claude/settings.local.json', reason: 'no permissions.allow' },
      ],
    });
  });
});

test('An unbounded Bash grant is replaced with the observed Bash commands that were passed in', () => {
  const text = JSON.stringify({ permissions: { allow: ['Bash(*)'] } }, null, 2);
  withDir({ '.claude/settings.json': text }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir, observed: ['Bash(ls)', 'Read', 'Bash(ls)'] });
    assert.equal(r.ok, true);
    assert.equal(r.applied, false);
    assert.deepEqual(r.files, ['.claude/settings.json']);
    assert.deepEqual(r.pinned, []);
    assert.deepEqual(r.narrowed, [{ file: '.claude/settings.json', removed: 'Bash(*)', added: ['Bash(ls)'] }]);
    assert.equal(r.note, NOTE);
    assert.equal(readFileSync(join(dir, '.claude/settings.json'), 'utf8'), text);
  });
});

test('When no observed list is passed the Bash commands are collected from the settings files', () => {
  withDir({
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(*)', 'Read'] } }, null, 2),
    '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }),
  }, (dir) => {
    const r = hardenAgentConfig({ repoDir: dir });
    assert.equal(r.ok, true);
    assert.deepEqual(r.narrowed, [{ file: '.claude/settings.json', removed: 'Bash(*)', added: ['Bash(git status)'] }]);
  });
});

test('A read error other than a missing file is rethrown', () => {
  withDir({}, (dir) => {
    mkdirSync(join(dir, '.mcp.json'));
    assert.throws(() => hardenAgentConfig({ repoDir: dir, observed: [] }), { name: 'Error', code: 'EISDIR' });
  });
});
